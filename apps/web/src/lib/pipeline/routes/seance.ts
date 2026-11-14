import 'server-only';

// POST /api/seance: the Seance Chamber (Requirements 9, 10, and 11). For a signed-in Member who owns the corpse, the
// gates run in this order: stored row, cache copy, eligibility, configuration, quota, then generation. The provider
// is called only after every gate has passed, and at most twice per request. The route never updates or deletes a
// `seance_specs` row, and `approved_at` stays NULL because the approval control belongs to a later spec.
import { SeanceOutputSchema } from '@/lib/llm/schemas';
import { hashIsMatchable, pickSeance, visibleMatches } from '../cache-select';
import type { PipelineDeps } from '../deps';
import { checkEligibility } from '../eligibility';
import { jsonResponse, PipelineError } from '../errors';
import { runGeneration } from '../generation';
import { buildSeancePrompts, makeDelimiter } from '../prompts';
import { nextStatusAfterSeance, parseInvariantsDocument, seanceBody } from '../present';
import { reserveOrFail } from '../quota';
import { applyStatus, llmConfigOrFail, persisting, runPipelineRoute, type RouteContext } from '../run-route';
import { validateSeanceOutput } from '../seance-validate';
import type { NewSeance, ResultSource, SeanceRow } from '../types';

/** Inserts the row. On a unique violation another request won the race: read its row and return it as `stored`. */
async function insertOrReadStored(context: RouteContext, row: NewSeance, source: 'cache' | 'generated'): Promise<{ source: ResultSource; row: SeanceRow }> {
  const inserted = await persisting(() => context.store.insertSeance(row));
  if (inserted.kind === 'inserted') return { source, row: inserted.row };
  const existing = await persisting(() => context.store.getSeance(row.corpseId));
  if (existing === null) throw new PipelineError('PERSISTENCE_FAILED', { safeDetail: 'conflict-reread' });
  return { source: 'stored', row: existing };
}

async function respond(context: RouteContext, source: ResultSource, row: SeanceRow): Promise<Response> {
  const status = await applyStatus(context, nextStatusAfterSeance(source, context.corpse.status));
  const body = await persisting(async () => seanceBody(source, row, { id: context.corpse.id, status }));
  return jsonResponse(200, body);
}

export function handleSeance(request: Request, deps: PipelineDeps): Promise<Response> {
  return runPipelineRoute({
    route: 'seance',
    request,
    deps,
    async handle(context) {
      const { access, corpse, store, member } = context;

      // A Sample_Corpse returns its precomputed row for everyone. No config, no provider, no quota, no write.
      if (access === 'sample') {
        let row: SeanceRow | null;
        try {
          row = await store.getSeance(corpse.id);
        } catch {
          throw new PipelineError('INTERNAL_ERROR', { safeDetail: 'sample-read' });
        }
        if (row === null) throw new PipelineError('NOT_PRECOMPUTED');
        const body = await persisting(async () => seanceBody('precomputed', row, { id: corpse.id, status: corpse.status }));
        return jsonResponse(200, body);
      }
      if (member === null) throw new PipelineError('INTERNAL_ERROR', { safeDetail: 'no-member' });

      // 1. The corpse's own row.
      const own = await persisting(() => store.getSeance(corpse.id));
      if (own !== null) return respond(context, 'stored', own);

      // 2. A row of another visible corpse with the same code_hash. Private rows of other users never take part.
      if (hashIsMatchable(corpse.codeHash)) {
        const matches = visibleMatches(await persisting(() => store.listHashMatches(corpse.codeHash, corpse.id)), member.id);
        if (matches.length > 0) {
          const candidates = await persisting(() => store.seancesFor(matches.map((match) => match.corpseId)));
          const picked = pickSeance(candidates, matches);
          if (picked !== null) {
            const copy = await persisting(async () => ({
              corpseId: corpse.id,
              requirementsMd: picked.requirementsMd,
              designMd: picked.designMd,
              invariantsJson: parseInvariantsDocument(picked.invariantsJson),
              approvedAt: null,
            }));
            const result = await insertOrReadStored(context, copy, 'cache');
            return respond(context, result.source, result.row);
          }
        }
      }

      // 3. Eligibility: size, scan, entry candidate. No quota is spent on code that cannot be processed.
      const eligibility = checkEligibility(corpse.originalCode, corpse.sourceLanguage);
      if (!eligibility.ok) throw eligibility.error;

      // 4. Configuration, then 5. quota. A missing key never spends a reservation.
      const config = llmConfigOrFail(deps);
      await reserveOrFail(store, 'seance');

      // 6. The delimiter. If every candidate collides with the code, no provider call is made.
      const delimiter = makeDelimiter(deps.randomBytes, [corpse.originalCode], deps.limits.delimiterAttempts);
      if (delimiter === null) throw new PipelineError('INTERNAL_ERROR', { safeDetail: 'delimiter' });

      // 7. Generation: at most two provider calls for the one reservation.
      const output = await runGeneration({
        gateway: deps.createGateway(config),
        schema: SeanceOutputSchema,
        validate(value) {
          const verdict = validateSeanceOutput(value, eligibility.candidates);
          return verdict.ok ? { ok: true } : { ok: false, failedRules: verdict.failedRules };
        },
        buildPrompts: (retry) =>
          buildSeancePrompts(
            {
              sourceLanguage: corpse.sourceLanguage,
              originalCode: corpse.originalCode,
              candidates: eligibility.candidates,
              findings: eligibility.findings.map((finding) => ({ curseType: finding.curseType, severity: finding.severity, lineNumber: finding.lineNumber })),
            },
            delimiter,
            retry,
          ),
        maxOutputTokens: deps.limits.seanceMaxOutputTokens,
        deadline: context.deadline,
        deadlineAt: context.deadlineAt,
        now: deps.now,
        limits: deps.limits,
      });

      // 8. Insert exactly one row. The model strings are stored as they are.
      const result = await insertOrReadStored(
        context,
        { corpseId: corpse.id, requirementsMd: output.requirementsMd, designMd: output.designMd, invariantsJson: output.invariants, approvedAt: null },
        'generated',
      );
      return respond(context, result.source, result.row);
    },
  });
}

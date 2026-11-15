import 'server-only';

// POST /api/reincarnate: the generation half of the Laboratory (Requirements 12, 13, and 14). It writes modern
// TypeScript and a property-based test body from the stored Seance spec, checks both statically, and stores them.
// It never executes, evaluates, or transpiles for execution any generated code, and it never imports the verifier
// package. A reincarnation of a user corpse is stored with `pbt_passed`, `total_runs`, and `execution_time_ms` NULL,
// so it never claims a verification that did not happen.
import { ReincarnationOutputSchema } from '@/lib/llm/schemas';
import { hashIsMatchable, pickReincarnation, sameSeanceContent, visibleMatches } from '../cache-select';
import type { PipelineDeps } from '../deps';
import { checkEligibility } from '../eligibility';
import { jsonResponse, PipelineError } from '../errors';
import { runGeneration } from '../generation';
import { TARGET_STACK } from '../limits';
import { entryFunctionOf, nextStatusAfterReincarnation, reincarnationBody } from '../present';
import { buildReincarnatePrompts, cursesJsonText, makeDelimiter } from '../prompts';
import { reserveOrFail } from '../quota';
import { applyStatus, llmConfigOrFail, persisting, runPipelineRoute, type RouteContext } from '../run-route';
import { runStaticGate } from '../static-gate';
import type { NewReincarnation, ReincarnationRow, ResultSource } from '../types';

/** Inserts the row. On a unique violation another request won the race: read its row and return it as `stored`. */
async function insertOrReadStored(
  context: RouteContext,
  row: NewReincarnation,
  source: 'cache' | 'generated',
): Promise<{ source: ResultSource; row: ReincarnationRow }> {
  const inserted = await persisting(() => context.store.insertReincarnation(row));
  if (inserted.kind === 'inserted') return { source, row: inserted.row };
  const existing = await persisting(() => context.store.getReincarnation(row.corpseId));
  if (existing === null) throw new PipelineError('PERSISTENCE_FAILED', { safeDetail: 'conflict-reread' });
  return { source: 'stored', row: existing };
}

async function respond(context: RouteContext, source: ResultSource, row: ReincarnationRow): Promise<Response> {
  const status = await applyStatus(context, nextStatusAfterReincarnation(row, context.corpse.status));
  return jsonResponse(200, reincarnationBody(source, row, { id: context.corpse.id, status }));
}

export function handleReincarnate(request: Request, deps: PipelineDeps): Promise<Response> {
  return runPipelineRoute({
    route: 'reincarnate',
    request,
    deps,
    async handle(context) {
      const { access, corpse, store, member } = context;

      // A Sample_Corpse returns its precomputed row for everyone. No config, no provider, no quota, no write.
      if (access === 'sample') {
        let row: ReincarnationRow | null;
        try {
          row = await store.getReincarnation(corpse.id);
        } catch {
          throw new PipelineError('INTERNAL_ERROR', { safeDetail: 'sample-read' });
        }
        if (row === null) throw new PipelineError('NOT_PRECOMPUTED');
        return jsonResponse(200, reincarnationBody('precomputed', row, { id: corpse.id, status: corpse.status }));
      }
      if (member === null) throw new PipelineError('INTERNAL_ERROR', { safeDetail: 'no-member' });

      // 0. A reincarnation needs the stored Seance spec, approved or not.
      const seance = await persisting(() => store.getSeance(corpse.id));
      if (seance === null) throw new PipelineError('SEANCE_REQUIRED');

      // 1. The corpse's own row.
      const own = await persisting(() => store.getReincarnation(corpse.id));
      if (own !== null) return respond(context, 'stored', own);

      // 2. A row of another visible corpse with the same code_hash and the same Seance content.
      if (hashIsMatchable(corpse.codeHash)) {
        const matches = visibleMatches(await persisting(() => store.listHashMatches(corpse.codeHash, corpse.id)), member.id);
        if (matches.length > 0) {
          const seances = await persisting(() => store.seancesFor(matches.map((match) => match.corpseId)));
          const eligible = new Set(seances.filter((row) => sameSeanceContent(row, seance)).map((row) => row.corpseId));
          if (eligible.size > 0) {
            const rows = await persisting(() => store.reincarnationsFor([...eligible]));
            const picked = pickReincarnation(rows, matches, eligible);
            if (picked !== null) {
              const result = await insertOrReadStored(
                context,
                {
                  corpseId: corpse.id,
                  targetStack: picked.targetStack,
                  modernCode: picked.modernCode,
                  pbtTestCode: picked.pbtTestCode,
                  pbtPassed: picked.pbtPassed,
                  totalRuns: picked.totalRuns,
                  executionTimeMs: picked.executionTimeMs,
                },
                'cache',
              );
              return respond(context, result.source, result.row);
            }
          }
        }
      }

      // 3. Eligibility, then the stored curses that the prompt includes.
      const eligibility = checkEligibility(corpse.originalCode, corpse.sourceLanguage);
      if (!eligibility.ok) throw eligibility.error;
      const curses = await persisting(() => store.getCurses(corpse.id));

      // 4. Configuration, then 5. quota.
      const config = llmConfigOrFail(deps);
      await reserveOrFail(store, 'reincarnate');

      // 6. One delimiter for every untrusted block. If every candidate collides, no provider call is made.
      const invariantsJsonText = JSON.stringify(seance.invariantsJson);
      const delimiter = makeDelimiter(
        deps.randomBytes,
        [corpse.originalCode, seance.requirementsMd, seance.designMd, invariantsJsonText, cursesJsonText(curses)],
        deps.limits.delimiterAttempts,
      );
      if (delimiter === null) throw new PipelineError('INTERNAL_ERROR', { safeDetail: 'delimiter' });

      // 7. Generation: at most two provider calls. The static gate parses and type-checks in memory and runs nothing.
      const entryFunction = entryFunctionOf(seance.invariantsJson);
      const output = await runGeneration({
        gateway: deps.createGateway(config),
        schema: ReincarnationOutputSchema,
        validate(value) {
          const verdict = runStaticGate(value, entryFunction, {
            now: deps.now,
            typecheckTimeoutMs: deps.limits.typecheckTimeoutMs,
            maxDiagnostics: deps.limits.maxDiagnostics,
          });
          return verdict.ok ? { ok: true } : { ok: false, failedRules: verdict.failedRules, diagnostics: verdict.diagnostics };
        },
        buildPrompts: (retry) =>
          buildReincarnatePrompts(
            {
              sourceLanguage: corpse.sourceLanguage,
              originalCode: corpse.originalCode,
              requirementsMd: seance.requirementsMd,
              designMd: seance.designMd,
              invariantsJsonText,
              curses,
            },
            delimiter,
            retry,
          ),
        maxOutputTokens: deps.limits.reincarnateMaxOutputTokens,
        deadline: context.deadline,
        deadlineAt: context.deadlineAt,
        now: deps.now,
        limits: deps.limits,
      });

      // 8. Insert exactly one row with a null verification.
      const result = await insertOrReadStored(
        context,
        {
          corpseId: corpse.id,
          targetStack: TARGET_STACK,
          modernCode: output.modernCode,
          pbtTestCode: output.pbtTestCode,
          pbtPassed: null,
          totalRuns: null,
          executionTimeMs: null,
        },
        'generated',
      );
      return respond(context, result.source, result.row);
    },
  });
}

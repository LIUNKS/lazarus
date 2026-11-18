import 'server-only';

// POST /api/verify (Requirements 3 to 7). The handler is a flat sequence of guards in the order of Requirement 3
// criterion 8. Each guard that fails returns before the next one can have an effect, so the quota and the CPU of a
// sandbox run are spent only after every cheap check has passed.
import type { Member } from '@/lib/auth/member';
import { jsonResponse, StoreError } from '@/lib/pipeline/errors';
import { entryFunctionOf } from '@/lib/pipeline/present';
import type { CorpseRow, ReincarnationRow } from '@/lib/pipeline/types';
import { classifySandboxResult, type Classification } from './classify';
import type { VerifyDeps, VerifyLogLine } from './deps';
import { VerifyError } from './errors';
import { VERIFICATION_LIMITS } from './limits';
import { verifyBody, type VerifySource } from './present';
import { runVerifyRoute, type VerifyContext } from './run-verify-route';
import type { LiveRequest, SandboxResult } from './sandbox';
import type { RecordResult, VerificationStore } from './store';

/**
 * The run request, built only from rows read under Row Level Security and from verified claims (Requirement 6
 * criteria 1 to 3). No value comes from the body, the query string, or a header. `allowDynamicCode` and `limits` are
 * left out, so the Sandbox_Runner defaults apply.
 */
export function liveRequest(corpse: CorpseRow, row: ReincarnationRow, entryFunction: string, seed: number, member: Member): LiveRequest {
  return {
    origin: 'user',
    caller: { kind: 'member', userId: member.id },
    corpusOwnerId: corpse.userId,
    legacyCode: corpse.originalCode,
    modernCode: row.modernCode,
    testCode: row.pbtTestCode,
    entryFunction,
    numRuns: VERIFICATION_LIMITS.numRuns,
    seed,
  };
}

/**
 * The run request of a Sample_Corpse (Requirement 13). Sample code is written and reviewed in the migrations, so
 * `origin` is `sample` and the Gate runs it in-process through the Verifier. The caller is always a Member: the Gate is
 * created with `allowAnonymousSampleRuns` false, and the route never builds this request for a Visitor.
 */
export function sampleLiveRequest(corpse: CorpseRow, row: ReincarnationRow, entryFunction: string, seed: number, member: Member): LiveRequest {
  return {
    origin: 'sample',
    caller: { kind: 'member', userId: member.id },
    corpusOwnerId: corpse.userId,
    legacyCode: corpse.originalCode,
    modernCode: row.modernCode,
    testCode: row.pbtTestCode,
    entryFunction,
    numRuns: VERIFICATION_LIMITS.numRuns,
    seed,
  };
}

const ok = (source: VerifySource, row: Parameters<typeof verifyBody>[1], corpse: Parameters<typeof verifyBody>[2]): Response =>
  jsonResponse(200, verifyBody(source, row, corpse));

const RESULT_STATUSES = new Set(['PASSED', 'FAILED', 'ERROR']);
const SAFE_CODE = /^[A-Z][A-Z_]{0,63}$/;

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/** The fields of the run log line, read defensively: the result is not trusted to have the documented shape. */
function runLogLine(result: SandboxResult, corpse: CorpseRow, member: Member, seed: number): VerifyLogLine {
  let status: unknown;
  let code: unknown;
  let totalRuns: unknown;
  let executionTimeMs: unknown;
  try {
    const record = result as unknown as Record<string, unknown>;
    ({ status, code, totalRuns, executionTimeMs } = record);
  } catch {
    // An unreadable result is logged with unknown fields.
  }
  return {
    event: 'verification_run',
    route: 'verify',
    corpseId: corpse.id,
    userId: member.id,
    status: typeof status === 'string' && RESULT_STATUSES.has(status) ? (status as 'PASSED' | 'FAILED' | 'ERROR') : 'unknown',
    code: typeof code === 'string' && SAFE_CODE.test(code) ? code : null,
    totalRuns: safeInteger(totalRuns),
    executionTimeMs: safeInteger(executionTimeMs),
    seed,
  };
}

/** Calls the quota function once. Only a well-formed allow lets the request continue (fail closed). */
async function reserveOrFail(store: VerificationStore): Promise<void> {
  let verdict: unknown;
  try {
    verdict = await store.reserveVerificationRun();
  } catch {
    throw new VerifyError('QUOTA_UNAVAILABLE', { safeDetail: 'quota' });
  }
  if (typeof verdict === 'object' && verdict !== null) {
    const { allowed, deniedBy, retryAfterSeconds } = verdict as Record<string, unknown>;
    if (allowed === true) return;
    if (allowed === false && (deniedBy === 'user' || deniedBy === 'global') && typeof retryAfterSeconds === 'number' && Number.isInteger(retryAfterSeconds)) {
      throw new VerifyError('RATE_LIMITED', { deniedBy, retryAfterSeconds, safeDetail: deniedBy });
    }
  }
  throw new VerifyError('QUOTA_UNAVAILABLE', { safeDetail: 'verdict-shape' });
}

/** A store failure in the record step or the re-read becomes PERSISTENCE_FAILED. */
async function persisting<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new VerifyError('PERSISTENCE_FAILED', { safeDetail: error instanceof StoreError ? error.detail : 'store' });
  }
}

type Conclusive = Extract<Classification, { kind: 'conclusive' }>;

/** One run through the Gate, its log line, and the classification. Every result without a verdict throws its code. */
async function runOnce(deps: VerifyDeps, request: LiveRequest, corpse: CorpseRow, member: Member, seed: number): Promise<Conclusive> {
  const result = await deps.sandbox.run(request);
  try {
    deps.log(runLogLine(result, corpse, member, seed));
  } catch {
    // A failing logger must not change the response.
  }

  const classification = classifySandboxResult(result);
  switch (classification.kind) {
    case 'denied-disabled':
      throw new VerifyError('VERIFICATION_DISABLED', { safeDetail: 'USER_EXECUTION_DISABLED' });
    case 'denied-busy':
      throw new VerifyError('VERIFICATION_BUSY', { retryAfterSeconds: VERIFICATION_LIMITS.busyRetryAfterSeconds, safeDetail: 'CONCURRENCY_LIMIT' });
    case 'unavailable':
      throw new VerifyError('SANDBOX_UNAVAILABLE', { safeDetail: 'SANDBOX_UNAVAILABLE' });
    case 'inconclusive':
      throw new VerifyError('VERIFICATION_INCONCLUSIVE', { safeDetail: classification.detail });
    case 'internal':
      throw new VerifyError('INTERNAL_ERROR', { safeDetail: classification.detail });
    case 'conclusive':
      return classification;
  }
}

/** The entry function of the stored Seance spec, or SEANCE_REQUIRED. */
async function entryFunctionOrFail(store: VerificationStore, corpseId: string): Promise<string> {
  const seance = await store.getSeance(corpseId);
  const entryFunction = seance === null ? null : entryFunctionOf(seance.invariantsJson);
  if (entryFunction === null) throw new VerifyError('SEANCE_REQUIRED');
  return entryFunction;
}

/**
 * A live run of a Sample_Corpse by a Member (Requirement 13). The order mirrors the owned path: the kill switch, the
 * entry function, one quota reservation, one run. Nothing is written: the precomputed row stays as the migrations
 * stored it, and the result of this run is returned with `source` set to `live`.
 */
async function liveSampleRun(deps: VerifyDeps, store: VerificationStore, member: Member, corpse: CorpseRow, row: ReincarnationRow): Promise<Response> {
  const decision = deps.sampleExecution();
  if (!decision.enabled) throw new VerifyError('VERIFICATION_DISABLED', { safeDetail: decision.reason.replaceAll('-', '_') });

  const entryFunction = await entryFunctionOrFail(store, corpse.id);
  await reserveOrFail(store);

  const seed = deps.randomSeed();
  const run = await runOnce(deps, sampleLiveRequest(corpse, row, entryFunction, seed, member), corpse, member, seed);
  const live = { id: row.id, targetStack: row.targetStack, pbtPassed: run.passed, totalRuns: run.totalRuns, executionTimeMs: run.executionTimeMs };
  return ok('live', live, corpse);
}

async function handle({ deps, store, member, corpse, access }: VerifyContext): Promise<Response> {
  const row = await store.getReincarnation(corpse.id);

  // Samples: a Visitor gets the stored result with no execution, quota, kill switch read, or write. A Member gets a
  // live run that is never stored (Requirement 13).
  if (access === 'sample') {
    if (row === null) throw new VerifyError('NOT_PRECOMPUTED');
    if (member === null) return ok('precomputed', row, corpse);
    return liveSampleRun(deps, store, member, corpse, row);
  }

  // (c) and (d): a reincarnation must exist, and a stored verdict is final.
  if (row === null) throw new VerifyError('REINCARNATION_REQUIRED');
  if (row.pbtPassed !== null) return ok('stored', row, corpse);

  // (e) The kill switch is read only here, after no stored verdict was found.
  const decision = deps.execution();
  if (!decision.enabled) throw new VerifyError('VERIFICATION_DISABLED', { safeDetail: decision.reason.replaceAll('-', '_') });

  // (f) The entry function of the stored Seance spec. An owned corpse is only ever resolved for a Member.
  if (member === null) throw new VerifyError('SEANCE_REQUIRED');
  const entryFunction = await entryFunctionOrFail(store, corpse.id);

  // (g) One quota reservation. From here on, no failure removes or changes it.
  await reserveOrFail(store);

  // (h) One run through the Gate. A client disconnect does not abort it: the Sandbox_Runner bounds the run.
  const seed = deps.randomSeed();
  const classification = await runOnce(deps, liveRequest(corpse, row, entryFunction, seed, member), corpse, member, seed);

  // (i) One record call. It writes only where no verdict is stored yet.
  const recorded: RecordResult = await persisting(() =>
    store.recordVerification({
      reincarnationId: row.id,
      passed: classification.passed,
      totalRuns: classification.totalRuns,
      executionTimeMs: classification.executionTimeMs,
    }),
  );
  if (recorded.wasUpdated) {
    const stored = { ...row, pbtPassed: recorded.passed, totalRuns: recorded.totalRuns, executionTimeMs: recorded.executionTimeMs };
    return ok('executed', stored, { id: corpse.id, status: recorded.corpseStatus });
  }

  // Another run recorded a verdict first, or the row is not writable. This run's result is discarded.
  const again = await persisting(() => store.getReincarnation(corpse.id));
  if (again === null || again.pbtPassed === null) throw new VerifyError('PERSISTENCE_FAILED', { safeDetail: 'not-recorded' });
  const current = await persisting(() => store.loadCorpse(corpse.id));
  if (current === null) throw new VerifyError('PERSISTENCE_FAILED', { safeDetail: 'not-recorded' });
  return ok('stored', again, current);
}

export function handleVerify(request: Request, deps: VerifyDeps): Promise<Response> {
  return runVerifyRoute(request, deps, handle);
}

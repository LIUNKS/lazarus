// Shared setup and fast-check generators for the tests of POST /api/verify. Test-only: no production module imports
// this file. The setup builds a VerifyDeps from the in-memory store and the scripted sandbox, and counts every call
// that has a cost or an effect: sandbox runs, quota reservations, kill switch reads, sessions, and writes.
import fc from 'fast-check';
import { expect } from 'vitest';
import type { MemoryCorpse, QuotaScript } from './memory-store';
import { makeCorpse, MEMBER_ID, OWNED_ID, reincarnationRow, sampleCorpse, foreignCorpse, seanceRow, APP_ORIGIN, SAMPLE_ID, FOREIGN_ID, MISSING_ID } from './harness';
import { MemoryVerificationStore } from './memory-verification-store';
import { MockSandbox, passed } from './mock-sandbox';
import type { ReincarnationRow, SeanceRow } from '@/lib/pipeline/types';
import type { VerifyDeps, VerifyLogLine } from '@/lib/verification/deps';
import { VERIFY_ERROR_CODES, VERIFY_ERROR_TABLE, type VerifyErrorCode } from '@/lib/verification/errors';
import type { ExecutionDecision } from '@/lib/verification/execution';

export { APP_ORIGIN, FOREIGN_ID, MEMBER_ID, MISSING_ID, OWNED_ID, SAMPLE_ID };

export const ENABLED: ExecutionDecision = { enabled: true };
export const DISABLED: ExecutionDecision = { enabled: false, reason: 'flag-off' };
export const SEED = 123_456_789;

/** A request to POST /api/verify. Every part can be overridden to build a rejected one. */
export function verifyRequest(body: unknown, overrides: { origin?: string | null; contentType?: string | null; raw?: string; method?: string } = {}): Request {
  const headers = new Headers();
  const origin = overrides.origin === undefined ? APP_ORIGIN : overrides.origin;
  const contentType = overrides.contentType === undefined ? 'application/json' : overrides.contentType;
  if (origin !== null) headers.set('origin', origin);
  if (contentType !== null) headers.set('content-type', contentType);
  return new Request(`${APP_ORIGIN}/api/verify`, { method: overrides.method ?? 'POST', headers, body: overrides.raw ?? JSON.stringify(body) });
}

export interface VerifyHarnessOptions {
  /** null is a Visitor. */
  memberId?: string | null;
  corpses?: MemoryCorpse[];
  seances?: SeanceRow[];
  reincarnations?: ReincarnationRow[];
  quota?: QuotaScript[];
  /** Scripted sandbox results, one per run (the last one repeats). */
  results?: unknown[];
  execution?: ExecutionDecision | (() => ExecutionDecision);
  /** The kill switch decision for a live run of a Sample_Corpse. */
  sampleExecution?: ExecutionDecision;
  sessionThrows?: boolean;
}

/** The owned corpse with a reincarnation and a Seance spec whose entry function is `calc`. */
export function readyOwned(overrides: { corpse?: Partial<MemoryCorpse>; reincarnation?: Partial<ReincarnationRow>; seance?: Partial<SeanceRow> } = {}) {
  return {
    corpses: [makeCorpse({ status: 'IN_SEANCE', ...overrides.corpse }), sampleCorpse(), foreignCorpse()],
    reincarnations: [reincarnationRow(OWNED_ID, overrides.reincarnation), reincarnationRow(SAMPLE_ID, { pbtPassed: true, totalRuns: 1_000, executionTimeMs: 50 })],
    seances: [seanceRow(OWNED_ID, overrides.seance), seanceRow(SAMPLE_ID)],
  };
}

export function buildVerifyHarness(options: VerifyHarnessOptions = {}) {
  const memberId = options.memberId === undefined ? MEMBER_ID : options.memberId;
  const base = readyOwned();
  const store = new MemoryVerificationStore({
    memberId,
    corpses: options.corpses ?? base.corpses,
    seances: options.seances ?? base.seances,
    reincarnations: options.reincarnations ?? base.reincarnations,
    quota: options.quota ?? [{ allowed: true }],
  });
  const sandbox = new MockSandbox(options.results ?? [passed()]);
  const logs: VerifyLogLine[] = [];
  const counters = { executionReads: 0, sessions: 0, seeds: 0 };
  /** The number of store calls made before each sandbox run, to check that the quota call came first. */
  const storeCallsAtRun: number[] = [];
  const execution = options.execution ?? ENABLED;
  const sampleExecution = options.sampleExecution ?? ENABLED;

  const deps: VerifyDeps = {
    async session() {
      counters.sessions += 1;
      if (options.sessionThrows) throw new Error('sentinel-session-error-1f7a');
      return { member: memberId === null ? null : { id: memberId, email: 'member@example.test' }, store };
    },
    sandbox: {
      run(request) {
        storeCallsAtRun.push(store.calls.length);
        return sandbox.run(request);
      },
    },
    execution() {
      counters.executionReads += 1;
      return typeof execution === 'function' ? execution() : execution;
    },
    // Both decisions read the kill switch, so both count as one execution read.
    sampleExecution() {
      counters.executionReads += 1;
      return sampleExecution;
    },
    randomSeed() {
      counters.seeds += 1;
      return SEED;
    },
    now: () => 1_000_000,
    log: (line) => logs.push(line),
    appOrigin: () => APP_ORIGIN,
  };
  return { deps, store, sandbox, logs, counters, storeCallsAtRun };
}

export type VerifyHarness = ReturnType<typeof buildVerifyHarness>;

export interface CheckedVerifyResponse {
  status: number;
  body: Record<string, unknown>;
  text: string;
  headers: Headers;
  code: VerifyErrorCode | null;
}

/**
 * Checks what every response of the route must satisfy (Requirements 2, 9, and 11 criterion 8): the two headers, the
 * success shape or an envelope whose status and code are in the closed list, and no sentinel anywhere in the body.
 */
export async function checkVerifyResponse(response: Response, sentinels: readonly string[] = []): Promise<CheckedVerifyResponse> {
  const text = await response.text();
  expect(response.headers.get('cache-control'), 'Cache-Control').toBe('private, no-store');
  expect(response.headers.get('content-type'), 'Content-Type').toBe('application/json; charset=utf-8');
  const body = JSON.parse(text) as Record<string, unknown>;
  let code: VerifyErrorCode | null = null;
  if (response.status === 200) {
    expect(body['ok']).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['corpse', 'ok', 'reincarnation', 'source']);
  } else {
    const error = body['error'] as { code?: string; message?: string } | undefined;
    expect((VERIFY_ERROR_CODES as readonly string[]).includes(String(error?.code)), `code ${String(error?.code)} is in the closed list`).toBe(true);
    code = error?.code as VerifyErrorCode;
    expect(response.status, `status for ${code}`).toBe(VERIFY_ERROR_TABLE[code].status);
    expect(Object.keys(body).sort()).toEqual(['error', 'ok']);
    expect(Object.keys(error ?? {}).sort()).toEqual(['code', 'message']);
    const retryAfter = response.headers.get('retry-after');
    if (code === 'RATE_LIMITED' || code === 'VERIFICATION_BUSY') {
      expect(retryAfter).toMatch(/^\d+$/);
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
      expect(Number(retryAfter)).toBeLessThanOrEqual(86_400);
    } else {
      expect(retryAfter).toBeNull();
    }
  }
  for (const sentinel of sentinels) expect(text.includes(sentinel), `the body contains the sentinel ${sentinel.slice(0, 30)}`).toBe(false);
  return { status: response.status, body, text, headers: response.headers, code };
}

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

export type CallerKind = 'visitor' | 'member';
export type CorpseKind = 'sample' | 'owned' | 'foreign' | 'missing';
export type SeanceState = 'valid' | 'missing' | 'empty-entry' | 'no-entry';
export type QuotaStep = 'allow' | 'deny-user' | 'deny-global' | 'error';
export type BodyCase = 'valid' | 'extra-key' | 'bad-uuid' | 'array' | 'not-json' | 'too-large' | 'wrong-type' | 'no-origin' | 'other-origin';

export const callerArb = fc.constantFrom<CallerKind>('visitor', 'member');
export const corpseKindArb = fc.constantFrom<CorpseKind>('sample', 'owned', 'foreign', 'missing');
export const seanceStateArb = fc.constantFrom<SeanceState>('valid', 'missing', 'empty-entry', 'no-entry');
export const quotaStepArb = fc.constantFrom<QuotaStep>('allow', 'deny-user', 'deny-global', 'error');
export const bodyCaseArb = fc.oneof(
  { weight: 4, arbitrary: fc.constant<BodyCase>('valid') },
  { weight: 1, arbitrary: fc.constantFrom<BodyCase>('extra-key', 'bad-uuid', 'array', 'not-json', 'too-large', 'wrong-type', 'no-origin', 'other-origin') },
);
export const verdictArb = fc.constantFrom<boolean | null>(null, true, false);
export const executionArb = fc.constantFrom<ExecutionDecision>(
  { enabled: true },
  { enabled: false, reason: 'flag-off' },
  { enabled: false, reason: 'kill-switch' },
  { enabled: false, reason: 'kill-switch-invalid' },
);

export const corpseIdOf = (kind: CorpseKind): string => ({ sample: SAMPLE_ID, owned: OWNED_ID, foreign: FOREIGN_ID, missing: MISSING_ID })[kind];

/** The first failing pre-check of a body case, or null for a valid body. */
export const PRECHECK_CODE: Record<BodyCase, VerifyErrorCode | null> = {
  valid: null,
  'extra-key': 'INVALID_REQUEST',
  'bad-uuid': 'INVALID_REQUEST',
  array: 'INVALID_REQUEST',
  'not-json': 'INVALID_REQUEST',
  'too-large': 'REQUEST_TOO_LARGE',
  'wrong-type': 'UNSUPPORTED_MEDIA_TYPE',
  'no-origin': 'FORBIDDEN_ORIGIN',
  'other-origin': 'FORBIDDEN_ORIGIN',
};

export function requestForCase(bodyCase: BodyCase, corpseId: string): Request {
  switch (bodyCase) {
    case 'valid':
      return verifyRequest({ corpseId });
    case 'extra-key':
      return verifyRequest({ corpseId, numRuns: 5 });
    case 'bad-uuid':
      return verifyRequest({ corpseId: 'not-a-uuid' });
    case 'array':
      return verifyRequest([{ corpseId }]);
    case 'not-json':
      return verifyRequest(null, { raw: '{"corpseId":' });
    case 'too-large':
      return verifyRequest(null, { raw: JSON.stringify({ corpseId, padding: 'x'.repeat(1_100) }) });
    case 'wrong-type':
      return verifyRequest({ corpseId }, { contentType: 'text/plain' });
    case 'no-origin':
      return verifyRequest({ corpseId }, { origin: null });
    case 'other-origin':
      return verifyRequest({ corpseId }, { origin: 'https://evil.example' });
  }
}

export function quotaScriptFor(step: QuotaStep, retryAfterSeconds = 120): QuotaScript {
  switch (step) {
    case 'allow':
      return { allowed: true };
    case 'deny-user':
      return { allowed: false, deniedBy: 'user', retryAfterSeconds };
    case 'deny-global':
      return { allowed: false, deniedBy: 'global', retryAfterSeconds };
    case 'error':
      return { throws: new Error('sentinel-quota-error-3b8d') };
  }
}

export function seanceFor(state: SeanceState): SeanceRow[] {
  switch (state) {
    case 'valid':
      return [seanceRow(OWNED_ID)];
    case 'missing':
      return [];
    case 'empty-entry':
      return [seanceRow(OWNED_ID, { invariantsJson: { entry_function: '', input: 'a', output: 'b', invariants: [] } })];
    case 'no-entry':
      return [seanceRow(OWNED_ID, { invariantsJson: { input: 'a', output: 'b', invariants: [] } })];
  }
}

/** A store state for one scenario of the route. */
export function storeState(options: { reincarnation: boolean; verdict: boolean | null; seance: SeanceState; status?: MemoryCorpse['status'] }) {
  const owned = makeCorpse({ status: options.status ?? 'IN_SEANCE' });
  const reincarnations = [reincarnationRow(SAMPLE_ID, { pbtPassed: true, totalRuns: 1_000, executionTimeMs: 50 })];
  if (options.reincarnation) {
    const stored = options.verdict === null ? {} : { pbtPassed: options.verdict, totalRuns: options.verdict ? 1_000 : 12, executionTimeMs: 77 };
    reincarnations.push(reincarnationRow(OWNED_ID, stored));
  }
  // The sample always has its seeded Seance spec, as the migrations store it. `seance` varies the owned corpse only.
  return { corpses: [owned, sampleCorpse(), foreignCorpse()], reincarnations, seances: [...seanceFor(options.seance), seanceRow(SAMPLE_ID)] };
}

/** Sandbox_Runner codes that end a run without a verdict, and the other ERROR codes it can return. */
export const INCONCLUSIVE_SANDBOX_CODES = [
  'SANDBOX_TIMEOUT',
  'SANDBOX_OUT_OF_MEMORY',
  'SANDBOX_FORBIDDEN_CAPABILITY',
  'SANDBOX_CRASH',
  'OUTPUT_LIMIT_EXCEEDED',
  'UNSUPPORTED_VALUE',
  'MODERN_COMPILE_ERROR',
  'LEGACY_LOAD_ERROR',
  'ENTRY_FUNCTION_NOT_FOUND',
  'MODERN_LOAD_ERROR',
  'TEST_CODE_ERROR',
] as const;
export const DENIAL_REASONS = ['INVALID_REQUEST', 'ANONYMOUS_NOT_ALLOWED', 'AUTH_REQUIRED', 'USER_EXECUTION_DISABLED', 'NOT_OWNER', 'USER_CONCURRENCY_LIMIT', 'GLOBAL_CONCURRENCY_LIMIT'] as const;

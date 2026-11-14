import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVerificationGate } from './gate';
import { createGate, createSandboxPort, type LiveRequest } from './sandbox';

afterEach(() => {
  vi.unstubAllEnvs();
});

const OWNER = '11111111-1111-4111-8111-111111111111';

// Every code string is broken. A result of LEGACY_LOAD_ERROR or MODERN_COMPILE_ERROR would reveal that the code was
// read, so a denial with executor `none` shows that nothing was parsed and no Worker was started.
const broken = (overrides: Partial<LiveRequest> = {}): LiveRequest => ({
  origin: 'user',
  caller: { kind: 'member', userId: OWNER },
  corpusOwnerId: OWNER,
  legacyCode: 'function f( {',
  modernCode: 'export const f: = ;',
  entryFunction: 'f',
  testCode: 'return (',
  numRuns: 1_000,
  seed: 1,
  ...overrides,
});

describe('verification gate', () => {
  it('R4.6 the production Gate is built with execution off and denies a user corpus without reading its code (Requirement 4)', async () => {
    vi.stubEnv('LAZARUS_SANDBOX_KILL_SWITCH', '0');
    const result = await createSandboxPort(getVerificationGate()).run(broken());
    expect(result).toMatchObject({ status: 'ERROR', code: 'LIVE_EXECUTION_DENIED', reason: 'USER_EXECUTION_DISABLED', executor: 'none' });
    // The same per-process Gate is returned on every call.
    expect(getVerificationGate()).toBe(getVerificationGate());
  });

  it('R6.4 an anonymous caller and a non-owner are denied before any code is read (Requirement 6)', async () => {
    const port = createSandboxPort(createGate({ userExecutionEnabled: true, perUserConcurrency: 1, globalConcurrency: 4 }));
    expect(await port.run(broken({ caller: { kind: 'anonymous' } }))).toMatchObject({ code: 'LIVE_EXECUTION_DENIED', reason: 'AUTH_REQUIRED', executor: 'none' });
    expect(await port.run(broken({ corpusOwnerId: '22222222-2222-4222-8222-222222222222' }))).toMatchObject({
      code: 'LIVE_EXECUTION_DENIED',
      reason: 'NOT_OWNER',
      executor: 'none',
    });
  });

  it('R6.6 a second concurrent run of the same user is denied with USER_CONCURRENCY_LIMIT (Requirement 6)', async () => {
    // A test-only Gate with execution on. The production Gate is never enabled in tests.
    const port = createSandboxPort(createGate({ userExecutionEnabled: true, allowAnonymousSampleRuns: false, perUserConcurrency: 1, globalConcurrency: 4 }));
    const busy: LiveRequest = {
      ...broken(),
      legacyCode: 'function f(a) { for (;;) {} }',
      modernCode: 'export function f(a: number): number { return a; }',
      testCode: 'return fc.property(fc.integer(), function (n) { assertEquivalent(n); });',
      numRuns: 100,
      limits: { wallClockTimeoutMs: 400, maxOldGenerationSizeMb: 32 },
    };
    const first = port.run(busy);
    const second = await port.run(busy);
    expect(second).toMatchObject({ code: 'LIVE_EXECUTION_DENIED', reason: 'USER_CONCURRENCY_LIMIT' });
    expect(await first).toMatchObject({ status: 'ERROR', code: 'SANDBOX_TIMEOUT', executor: 'sandbox-worker' });
  }, 30_000);
});

import { afterEach, describe, expect, it } from 'vitest';
import { createLiveExecutionGate, type LiveExecutionGate } from '../src/gate/gate.ts';
import { createdWorkerCount } from '../src/host/supervisor.ts';
import { setWorkerDirectoryForTests } from '../src/host/worker-files.ts';
import * as api from '../src/index.ts';
import { verifyLive } from '../src/live.ts';
import type { LiveRequest } from '../src/types.ts';
import { DOUBLE_DIFFERENT, expectHygienic, options, QUICK, settledWorkerCount } from './support/samples.ts';

const builtWorkers = new URL('../dist/worker/', import.meta.url);
afterEach(() => setWorkerDirectoryForTests(builtWorkers));

const member = (userId: string) => ({ kind: 'member', userId }) as const;
const userRequest = (overrides: Partial<LiveRequest> = {}): LiveRequest => ({
  ...options(),
  origin: 'user',
  caller: member('u1'),
  corpusOwnerId: 'u1',
  ...overrides,
});
const enabledGate = (): LiveExecutionGate => createLiveExecutionGate({ userExecutionEnabled: true });

describe('verifyLive', () => {
  it('R2.1 the package exports the public API', () => {
    expect(Object.keys(api).sort()).toEqual(['createLiveExecutionGate', 'runSandboxedCases', 'runSandboxedVerification', 'verifyLive']);
  });

  it('R3.13 a denied request creates no Worker and evaluates none of the submitted code', async () => {
    const before = createdWorkerCount();
    // Every code string is broken. A run that touched them would report a load or compile error.
    const broken = { legacyCode: 'function f( {', modernCode: 'export const f: = ;', testCode: 'return (' };
    const denied: [LiveRequest, LiveExecutionGate, string][] = [
      [userRequest(broken), createLiveExecutionGate(), 'USER_EXECUTION_DISABLED'],
      [userRequest({ ...broken, caller: { kind: 'anonymous' } }), enabledGate(), 'AUTH_REQUIRED'],
      [userRequest({ ...broken, corpusOwnerId: 'someone-else' }), enabledGate(), 'NOT_OWNER'],
      [userRequest({ ...broken, origin: 'sample', caller: { kind: 'anonymous' }, corpusOwnerId: null }), enabledGate(), 'ANONYMOUS_NOT_ALLOWED'],
      [userRequest({ ...broken, origin: 'other' as never }), enabledGate(), 'INVALID_REQUEST'],
    ];
    for (const [request, gate, reason] of denied) {
      const result = await verifyLive(request, gate);
      expect(result).toMatchObject({ status: 'ERROR', code: 'LIVE_EXECUTION_DENIED', executor: 'none', reason });
      expectHygienic(result);
      expect(gate.activeLeases()).toBe(0);
    }
    expect(createdWorkerCount()).toBe(before);
  });

  it('R3.7 a user corpus runs in the Sandbox and the Lease is released after success', async () => {
    const gate = enabledGate();
    const result = await verifyLive(userRequest(), gate);
    expect(result).toMatchObject({ status: 'PASSED', executor: 'sandbox-worker', totalRuns: 100 });
    expect(gate.activeLeases()).toBe(0);
  });

  it('R3.3 a sample corpus runs in-process through the Verifier and creates no Worker', async () => {
    const before = createdWorkerCount();
    const gate = enabledGate();
    const request = userRequest({ ...DOUBLE_DIFFERENT, origin: 'sample', corpusOwnerId: null });
    const result = await verifyLive(request, gate);
    expect(result).toMatchObject({ status: 'FAILED', executor: 'in-process', counterexample: { input: '101' } });
    expectHygienic(result);
    expect(createdWorkerCount()).toBe(before);
    expect(gate.activeLeases()).toBe(0);
  });

  it('R3.10 the Lease is released after a timeout', async () => {
    const gate = enabledGate();
    const result = await verifyLive(userRequest({ legacyCode: 'function f(a) { for (;;) {} }', limits: QUICK }), gate);
    expect(result).toMatchObject({ status: 'ERROR', code: 'SANDBOX_TIMEOUT', executor: 'sandbox-worker' });
    expect(gate.activeLeases()).toBe(0);
  });

  it('R3.10 the Lease is released after the Worker runs out of memory', async () => {
    const gate = enabledGate();
    const result = await verifyLive(
      userRequest({ legacyCode: 'var keep = []; function f(a) { for (;;) keep.push(new Array(100000).fill(a)); }', limits: { wallClockTimeoutMs: 10_000, maxOldGenerationSizeMb: 32 } }),
      gate,
    );
    expect(result).toMatchObject({ status: 'ERROR', code: 'SANDBOX_OUT_OF_MEMORY' });
    expect(gate.activeLeases()).toBe(0);
    expect(await settledWorkerCount(0)).toBe(0);
  });

  it('R3.10 the Lease is released after an error in the options and after an internal error', async () => {
    const gate = enabledGate();
    expect(await verifyLive(userRequest({ numRuns: 5 }), gate)).toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(gate.activeLeases()).toBe(0);

    // A gate that fails is an internal error of the facade. It must still resolve, never reject.
    const failing: LiveExecutionGate = { activeLeases: () => 0, acquire: () => { throw new Error('gate failed at /host/path.js'); } };
    const result = await verifyLive(userRequest(), failing);
    expect(result).toMatchObject({ status: 'ERROR', code: 'INTERNAL_ERROR', executor: 'none' });
    expectHygienic(result);
  });

  it('R3.9 a second run of the same user is denied while the first one holds its Lease', async () => {
    const gate = enabledGate();
    const first = verifyLive(userRequest({ legacyCode: 'function f(a) { for (;;) {} }', limits: QUICK }), gate);
    const second = await verifyLive(userRequest(), gate);
    expect(second).toMatchObject({ code: 'LIVE_EXECUTION_DENIED', reason: 'USER_CONCURRENCY_LIMIT' });
    await first;
    expect(gate.activeLeases()).toBe(0);
    expect(await verifyLive(userRequest(), gate)).toMatchObject({ status: 'PASSED' });
  });

  it('R3.14 missing worker files give SANDBOX_UNAVAILABLE, with no fallback to in-process execution', async () => {
    setWorkerDirectoryForTests(new URL('./no-such-directory/', import.meta.url));
    const before = createdWorkerCount();
    const gate = enabledGate();
    const result = await verifyLive(userRequest(), gate);
    expect(result).toMatchObject({ status: 'ERROR', code: 'SANDBOX_UNAVAILABLE', executor: 'sandbox-worker' });
    expect(createdWorkerCount()).toBe(before);
    expect(gate.activeLeases()).toBe(0);
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createLiveExecutionGate } from '../src/gate/gate.ts';
import { KILL_GRACE_MS } from '../src/host/run-shared.ts';
import { verifyLive } from '../src/live.ts';
import { runSandboxedVerification } from '../src/property-mode.ts';
import type { LiveRequest, SandboxResult } from '../src/types.ts';
import { HOSTILE_CORPUS, POLLUTION_PAIR, type HostileEntry } from './corpus/hostile.ts';
import { expectHygienic, INTEGER_TEST, MODERN_STUB, QUICK, settledWorkerCount } from './support/samples.ts';

const MARGIN_MS = 3_000;
/** Endings that would mean the harness itself broke. No hostile entry may end in one of them. */
const BROKEN = ['SANDBOX_CRASH', 'INTERNAL_ERROR', 'SANDBOX_UNAVAILABLE', 'INVALID_OPTIONS', 'LIVE_EXECUTION_DENIED'];

function requestFor(entry: HostileEntry, allowDynamicCode: boolean): LiveRequest {
  return {
    legacyCode: entry.legacyCode ?? 'function f(a) { return a; }',
    modernCode: entry.modernCode ?? MODERN_STUB,
    testCode: entry.testCode ?? INTEGER_TEST,
    entryFunction: 'f',
    numRuns: 100,
    seed: 7,
    allowDynamicCode,
    limits: entry.limits ?? QUICK,
    origin: 'user',
    caller: { kind: 'member', userId: 'attacker' },
    corpusOwnerId: 'attacker',
  };
}

const endingOf = (result: SandboxResult): string => (result.status === 'ERROR' ? result.code : result.status);

/** A snapshot of what a hostile run must not change on the host (Requirement 12, criterion 4). */
function hostSnapshot(): string {
  return JSON.stringify({
    env: process.env,
    objectPrototype: Object.getOwnPropertyNames(Object.prototype).sort(),
    arrayPrototype: Object.getOwnPropertyNames(Array.prototype).sort(),
    globals: Object.keys(globalThis).sort(),
  });
}

/** Runs one entry through the gate and checks everything that must hold whatever the code does. */
async function attack(entry: HostileEntry, allowDynamicCode: boolean): Promise<SandboxResult> {
  const gate = createLiveExecutionGate({ userExecutionEnabled: true });
  const request = requestFor(entry, allowDynamicCode);
  const liveBefore = await settledWorkerCount(0);
  const before = hostSnapshot();

  // A timer due in 50 ms: the host event loop must stay responsive while the hostile code runs.
  const due = performance.now() + 50;
  const fired = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now()), 50));

  const started = performance.now();
  const result = await verifyLive(request, gate);
  const elapsed = performance.now() - started;

  expect((await fired) - due, 'the host timer fired late').toBeLessThan(250);
  expect(elapsed, 'the run took too long').toBeLessThan(request.limits!.wallClockTimeoutMs! + KILL_GRACE_MS + MARGIN_MS + 10_000);
  expect(gate.activeLeases(), 'the Lease was not released').toBe(0);
  expect(await settledWorkerCount(liveBefore), 'a Worker stayed alive').toBe(liveBefore);
  expect(hostSnapshot(), 'the host changed').toBe(before);
  expect(BROKEN).not.toContain(endingOf(result));
  expectHygienic(result);
  return result;
}

describe('adversarial corpus', () => {
  for (const allowDynamicCode of [false, true]) {
    describe(`allowDynamicCode: ${allowDynamicCode}`, () => {
      it.each(HOSTILE_CORPUS)('R12.3 $id $title', async (entry) => {
        const result = await attack(entry, allowDynamicCode);
        const allowed = allowDynamicCode ? entry.expected.on : entry.expected.off;
        expect(allowed, `${entry.id} ended in ${endingOf(result)}${result.status === 'ERROR' ? `: ${result.message}` : ''}`).toContain(endingOf(result));
      });
    });
  }

  it('R6.3 a Forbidden_Capability message names the capability and the side', async () => {
    const byId = (id: string): HostileEntry => HOSTILE_CORPUS.find((entry) => entry.id === id)!;
    const cases: [string, RegExp][] = [
      ['H10/process/legacy', /legacy code used a denied capability: process/],
      ['H10/require/test', /test code used a denied capability: require/],
      ['H14/legacy', /legacy code used a denied capability: dynamic code generation/],
      ['H13/load', /legacy code used a denied capability: dynamic import\(\)/],
      ['H15/timeout', /legacy code used a denied capability: setTimeout/],
    ];
    for (const [id, pattern] of cases) {
      const result = await attack(byId(id), false);
      expect(result.status === 'ERROR' ? result.message : result.status).toMatch(pattern);
    }
  });

  it('R5.3 a timeout names the side that was running', async () => {
    const byId = (id: string): HostileEntry => HOSTILE_CORPUS.find((entry) => entry.id === id)!;
    for (const [id, side] of [['H2/legacy', 'legacy'], ['H2/modern', 'modern'], ['H21/test', 'test'], ['H1/legacy', 'legacy']] as const) {
      const result = await attack(byId(id), false);
      expect(result.status === 'ERROR' ? result.message : '').toContain(side);
    }
  });

  it('R4.1 H23 a prototype write in one run is not visible in the next run', async () => {
    const base: HostileEntry = { id: 'H23', title: 'prototype pollution across runs', role: 'legacy', expected: { off: ['PASSED'], on: ['PASSED'] } };
    const first = await attack({ ...base, legacyCode: POLLUTION_PAIR.first, modernCode: 'export function f(a: unknown): unknown { return 0; }', limits: { wallClockTimeoutMs: 5000, maxOldGenerationSizeMb: 32 } }, false);
    expect(first.status).toBe('PASSED');
    const second = await attack({ ...base, legacyCode: POLLUTION_PAIR.second, modernCode: POLLUTION_PAIR.modernSecond, limits: { wallClockTimeoutMs: 5000, maxOldGenerationSizeMb: 32 } }, false);
    expect(second.status).toBe('PASSED');
    expect(({} as Record<string, unknown>).lzPolluted).toBeUndefined();
  });

  it('R12.3 every hostile entry terminates, releases its Lease, and leaves no Worker', async () => {
    // Feature: 07-sandboxed-execution, Property 9: Termination and cleanup
    const quick = HOSTILE_CORPUS.filter((entry) => (entry.limits?.wallClockTimeoutMs ?? 0) <= 5000);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...quick), fc.boolean(), async (entry, allowDynamicCode) => {
        await attack(entry, allowDynamicCode); // every assertion of `attack` applies
        return true;
      }),
      { numRuns: 8 },
    );
  });

  it('R2.5 any options object and any hostile entry give a clean, serializable result', async () => {
    // Feature: 07-sandboxed-execution, Property 7: Result hygiene
    const quick = HOSTILE_CORPUS.filter((entry) => (entry.limits?.wallClockTimeoutMs ?? 0) <= 5000);
    const junk = fc.oneof(fc.anything(), fc.record({ legacyCode: fc.anything(), modernCode: fc.anything(), entryFunction: fc.anything(), testCode: fc.anything(), numRuns: fc.anything(), seed: fc.anything(), limits: fc.anything() }, { requiredKeys: [] }));
    const input = fc.oneof(
      junk,
      fc.tuple(fc.constantFrom(...quick), fc.boolean(), fc.constantFrom('guaranteed', 'a mathematical proof', '100%')).map(([entry, allowDynamicCode, phrase]) => {
        // A banned phrase in the code and in an error it throws must never reach a result.
        const request = requestFor(entry, allowDynamicCode);
        return { ...request, legacyCode: `// ${phrase}\n${request.legacyCode}\nif (false) throw new Error(${JSON.stringify(phrase)});` };
      }),
    );
    await fc.assert(
      fc.asyncProperty(input, async (options) => {
        const result = await runSandboxedVerification(options as never);
        expectHygienic(result);
        return ['PASSED', 'FAILED', 'ERROR'].includes(result.status);
      }),
      { numRuns: 25 },
    );
  });
});

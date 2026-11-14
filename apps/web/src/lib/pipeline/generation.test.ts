import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LlmGateway, ProviderCall, ProviderOutcome } from '@/lib/llm/generate';
import { outcomeStepArb, type OutcomeStep } from '@/lib/testing/arbitraries';
import { MockGateway, outcomeFor } from '@/lib/testing/mock-gateway';
import { PipelineError, type ErrorCode } from './errors';
import { runGeneration } from './generation';
import type { Diagnostic } from './static-gate';

const REJECTED_TEXT = 'REJECTED-OUTPUT-TEXT-6c2f';
const DEADLINE_MS = 100_000;
const schema = z.object({ valid: z.boolean() }).passthrough();
type Value = { valid: boolean; rules?: string[]; diagnostics?: Diagnostic[]; secret?: string };

const diagnostic = (n: number): Diagnostic => ({ line: n, column: 1, code: 2322, message: `compiler message ${n}` });

interface Scenario {
  first: OutcomeStep;
  firstValid: boolean;
  second: OutcomeStep;
  secondValid: boolean;
  fallbackAvailable: boolean;
  /** Milliseconds that pass during the first call. */
  elapsedAfterFirst: number;
  diagnosticCount: number;
}

const scenarios: fc.Arbitrary<Scenario> = fc.record({
  first: outcomeStepArb,
  firstValid: fc.boolean(),
  second: outcomeStepArb,
  secondValid: fc.boolean(),
  fallbackAvailable: fc.boolean(),
  elapsedAfterFirst: fc.oneof(fc.integer({ min: 0, max: 99_999 }), fc.integer({ min: 100_000, max: 150_000 }), fc.constantFrom(0, 55_000, 99_999, 100_000)),
  diagnosticCount: fc.integer({ min: 0, max: 15 }),
});

function valueFor(valid: boolean, diagnosticCount: number): Value {
  return valid ? { valid: true } : { valid: false, rules: ['RULE_A', 'RULE_B'], diagnostics: Array.from({ length: diagnosticCount }, (_, i) => diagnostic(i + 1)), secret: REJECTED_TEXT };
}

/** Wraps a gateway so that the clock moves while each call runs. */
function withClock(inner: MockGateway, clock: { t: number }, elapsed: number[]): LlmGateway {
  let call = 0;
  return {
    fallbackAvailable: inner.fallbackAvailable,
    async generate<T>(request: ProviderCall<T>): Promise<ProviderOutcome<T>> {
      const result = await inner.generate(request);
      clock.t += elapsed[call] ?? 1_000;
      call += 1;
      return result;
    },
  };
}

type Expected = { kind: 'value'; value: Value } | { kind: 'error'; code: ErrorCode };

// A reference model written separately from call-policy.ts and generation.ts.
function model(s: Scenario, calls: { count: number; targets: string[] }): Expected {
  const category = (step: OutcomeStep, valid: boolean): 'valid' | 'invalid' | 'provider-error' | 'timeout' | 'auth' | 'deadline' => {
    if (step === 'ok') return valid ? 'valid' : 'invalid';
    if (step === 'invalid-output') return 'invalid';
    if (step === 'disconnect') return 'deadline';
    return step;
  };
  const first = category(s.first, s.firstValid);
  calls.count = 1;
  calls.targets.push('primary');
  if (first === 'valid') return { kind: 'value', value: valueFor(true, 0) };
  if (first === 'auth') return { kind: 'error', code: 'LLM_NOT_CONFIGURED' };
  if (first === 'deadline') return { kind: 'error', code: 'LLM_TIMEOUT' };
  if (first === 'provider-error' && !s.fallbackAvailable) return { kind: 'error', code: 'LLM_PROVIDER_ERROR' };
  if (first === 'timeout' && !s.fallbackAvailable) return { kind: 'error', code: 'LLM_TIMEOUT' };

  const target = first === 'invalid' ? 'primary' : 'fallback';
  // The deadline passed while the first call ran: no second call is made.
  if (DEADLINE_MS - s.elapsedAfterFirst <= 0) return { kind: 'error', code: 'LLM_TIMEOUT' };
  calls.count = 2;
  calls.targets.push(target);
  const second = category(s.second, s.secondValid);
  if (second === 'valid') return { kind: 'value', value: valueFor(true, 0) };
  const codes = { invalid: 'LLM_OUTPUT_INVALID', 'provider-error': 'LLM_PROVIDER_ERROR', timeout: 'LLM_TIMEOUT', deadline: 'LLM_TIMEOUT', auth: 'LLM_NOT_CONFIGURED' } as const;
  return { kind: 'error', code: codes[second] };
}

async function run(s: Scenario) {
  const script = [
    outcomeFor(s.first, valueFor(s.firstValid, s.diagnosticCount)),
    outcomeFor(s.second, valueFor(s.secondValid, 0)),
    outcomeFor('ok', valueFor(true, 0)), // a third call would receive this, and the test would see the extra call
  ];
  const inner = new MockGateway(script, { fallbackAvailable: s.fallbackAvailable });
  const clock = { t: 0 };
  const retries: Array<{ failedRules: readonly string[]; diagnostics: readonly Diagnostic[] } | null> = [];
  try {
    const value = await runGeneration<Value>({
      gateway: withClock(inner, clock, [s.elapsedAfterFirst, 1_000]),
      schema: schema as unknown as z.ZodType<Value>,
      validate: (v) => (v.valid ? { ok: true } : { ok: false, failedRules: v.rules ?? [], diagnostics: v.diagnostics ?? [] }),
      buildPrompts: (retry) => {
        retries.push(retry);
        return { instructions: 'fixed instructions', prompt: retry ? `RETRY ${retry.failedRules.join(',')} ${retry.diagnostics.length}` : 'FIRST' };
      },
      maxOutputTokens: 4_000,
      deadline: new AbortController().signal,
      deadlineAt: DEADLINE_MS,
      now: () => clock.t,
      limits: { providerCallTimeoutMs: 45_000, maxDiagnostics: 10 },
    });
    return { result: { kind: 'value', value } as Expected, inner, retries };
  } catch (error) {
    if (!(error instanceof PipelineError)) throw error;
    return { result: { kind: 'error', code: error.code } as Expected, inner, retries };
  }
}

describe('R15 generation runner (Requirements 10, 13, and 15)', () => {
  it('R10.6 R12.11 R13.11 R15.3 R15.4 R15.5 R15.6 R15.8 R15.9 follows the policy for any pair of outcomes (Requirement 15)', async () => {
    // Feature: 05-llm-pipeline-api, Property 10: Provider call policy
    await fc.assert(
      fc.asyncProperty(scenarios, async (s) => {
        const calls = { count: 0, targets: [] as string[] };
        const expected = model(s, calls);
        const { result, inner } = await run(s);

        expect(result.kind).toBe(expected.kind);
        if (result.kind === 'error' && expected.kind === 'error') expect(result.code).toBe(expected.code);
        if (result.kind === 'value') expect(result.value).toEqual({ valid: true });

        // At most two provider calls, with the target the policy chooses for each.
        expect(inner.calls.length).toBe(calls.count);
        expect(inner.calls.length).toBeLessThanOrEqual(2);
        expect(inner.calls.map((c) => c.target)).toEqual(calls.targets);
      }),
      { numRuns: 200 },
    );
  });

  it('R15.2 gives the second call the smaller of 45,000 ms and the time left, and never calls after the deadline (Requirement 15)', async () => {
    // Feature: 05-llm-pipeline-api, Property 10: Provider call policy
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 150_000 }), async (elapsed) => {
        const s: Scenario = { first: 'invalid-output', firstValid: true, second: 'ok', secondValid: true, fallbackAvailable: false, elapsedAfterFirst: elapsed, diagnosticCount: 0 };
        const { inner } = await run(s);
        expect(inner.calls[0]!.timeoutMs).toBe(45_000);
        const remaining = DEADLINE_MS - elapsed;
        if (remaining <= 0) {
          expect(inner.calls).toHaveLength(1);
        } else {
          expect(inner.calls).toHaveLength(2);
          expect(inner.calls[1]!.timeoutMs).toBe(Math.min(45_000, remaining));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('R10.6 R13.11 puts only rule names and at most 10 diagnostics in a repair prompt, and no text of the rejected output (Requirement 10 and 13)', async () => {
    // Feature: 05-llm-pipeline-api, Property 10: Provider call policy
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 15 }), fc.boolean(), async (diagnosticCount, schemaFailure) => {
        const s: Scenario = {
          first: schemaFailure ? 'invalid-output' : 'ok',
          firstValid: false,
          second: 'ok',
          secondValid: true,
          fallbackAvailable: false,
          elapsedAfterFirst: 1_000,
          diagnosticCount,
        };
        const { inner, retries } = await run(s);
        expect(inner.calls).toHaveLength(2);
        const retry = retries[1];
        expect(retry).not.toBeNull();
        expect(retries[0]).toBeNull();
        expect(retry!.failedRules).toEqual(schemaFailure ? ['OUTPUT_SCHEMA'] : ['RULE_A', 'RULE_B']);
        expect(retry!.diagnostics.length).toBe(schemaFailure ? 0 : Math.min(10, diagnosticCount));
        for (const call of inner.calls) expect(`${call.instructions} ${call.prompt}`).not.toContain(REJECTED_TEXT);
      }),
      { numRuns: 100 },
    );
  });

  it('R15.4 sends the first prompt, not the repair prompt, to the fallback target (Requirement 15)', async () => {
    const s: Scenario = { first: 'provider-error', firstValid: true, second: 'ok', secondValid: true, fallbackAvailable: true, elapsedAfterFirst: 1_000, diagnosticCount: 0 };
    const { inner, retries } = await run(s);
    expect(inner.calls.map((c) => [c.target, c.prompt])).toEqual([['primary', 'FIRST'], ['fallback', 'FIRST']]);
    expect(retries).toEqual([null, null]);
  });

  it('R15.9 makes no call when the deadline has already passed or the signal is aborted (Requirement 15)', async () => {
    const gateway = new MockGateway([outcomeFor('ok', { valid: true })]);
    const base = {
      gateway,
      schema: schema as unknown as z.ZodType<Value>,
      validate: () => ({ ok: true as const }),
      buildPrompts: () => ({ instructions: 'i', prompt: 'p' }),
      maxOutputTokens: 100,
      limits: { providerCallTimeoutMs: 45_000, maxDiagnostics: 10 },
    };
    await expect(runGeneration({ ...base, deadline: new AbortController().signal, deadlineAt: 0, now: () => 0 })).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    const controller = new AbortController();
    controller.abort();
    await expect(runGeneration({ ...base, deadline: controller.signal, deadlineAt: 100_000, now: () => 0 })).rejects.toMatchObject({ code: 'LLM_TIMEOUT', detail: { safeDetail: 'disconnect' } });
    expect(gateway.calls).toHaveLength(0);
  });
});

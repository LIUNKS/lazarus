import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { afterFirst, afterSecond, nextTimeoutMs, type Outcome, type Step } from './call-policy';

const OUTCOMES: Outcome[] = ['valid', 'invalid', 'provider-error', 'timeout', 'auth', 'deadline'];

// The transition tables of the design, written out as data and not as code.
const FIRST: Record<Outcome, { withoutFallback: Step; withFallback: Step }> = {
  valid: { withoutFallback: { done: 'accept' }, withFallback: { done: 'accept' } },
  invalid: { withoutFallback: { next: 'repair' }, withFallback: { next: 'repair' } },
  auth: { withoutFallback: { done: 'fail', code: 'LLM_NOT_CONFIGURED' }, withFallback: { done: 'fail', code: 'LLM_NOT_CONFIGURED' } },
  deadline: { withoutFallback: { done: 'fail', code: 'LLM_TIMEOUT' }, withFallback: { done: 'fail', code: 'LLM_TIMEOUT' } },
  'provider-error': { withoutFallback: { done: 'fail', code: 'LLM_PROVIDER_ERROR' }, withFallback: { next: 'fallback' } },
  timeout: { withoutFallback: { done: 'fail', code: 'LLM_TIMEOUT' }, withFallback: { next: 'fallback' } },
};
const SECOND: Record<Outcome, Step> = {
  valid: { done: 'accept' },
  invalid: { done: 'fail', code: 'LLM_OUTPUT_INVALID' },
  'provider-error': { done: 'fail', code: 'LLM_PROVIDER_ERROR' },
  timeout: { done: 'fail', code: 'LLM_TIMEOUT' },
  deadline: { done: 'fail', code: 'LLM_TIMEOUT' },
  auth: { done: 'fail', code: 'LLM_NOT_CONFIGURED' },
};

describe('R15 call policy (Requirements 10, 13, and 15)', () => {
  it('R15.4 R15.5 R15.6 R15.8 maps every first outcome with and without a fallback to the documented step (Requirement 15)', () => {
    // Feature: 05-llm-pipeline-api, Property 10: Provider call policy
    for (const outcome of OUTCOMES) {
      expect(afterFirst(outcome, { fallbackEnabled: false }), `${outcome} without fallback`).toEqual(FIRST[outcome].withoutFallback);
      expect(afterFirst(outcome, { fallbackEnabled: true }), `${outcome} with fallback`).toEqual(FIRST[outcome].withFallback);
    }
  });

  it('R15.3 maps every second outcome to a final step, so no state asks for a third call (Requirement 15)', () => {
    // Feature: 05-llm-pipeline-api, Property 10: Provider call policy
    for (const outcome of OUTCOMES) {
      const step = afterSecond(outcome);
      expect(step, outcome).toEqual(SECOND[outcome]);
      expect('next' in step, `${outcome} asks for another call`).toBe(false);
    }
  });

  it('R10.6 R15.4 R15.8 chooses a repair only after an invalid output and a fallback only after a provider error or timeout, never after auth or the deadline (Requirement 15)', () => {
    // Feature: 05-llm-pipeline-api, Property 10: Provider call policy
    fc.assert(
      fc.property(fc.constantFrom(...OUTCOMES), fc.boolean(), (outcome, fallbackEnabled) => {
        const step = afterFirst(outcome, { fallbackEnabled });
        expect('next' in step && step.next === 'repair').toBe(outcome === 'invalid');
        expect('next' in step && step.next === 'fallback').toBe(fallbackEnabled && (outcome === 'provider-error' || outcome === 'timeout'));
        if (outcome === 'auth' || outcome === 'deadline') expect('next' in step).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('R15.2 uses the smaller of the call timeout and the time left, as a non-negative whole number (Requirement 15)', () => {
    // Feature: 05-llm-pipeline-api, Property 10: Provider call policy
    fc.assert(
      fc.property(fc.double({ min: -50_000, max: 300_000, noNaN: true }), (remaining) => {
        const timeout = nextTimeoutMs(remaining, { providerCallTimeoutMs: 45_000 });
        expect(Number.isInteger(timeout)).toBe(true);
        expect(timeout).toBeGreaterThanOrEqual(0);
        expect(timeout).toBeLessThanOrEqual(45_000);
        expect(timeout).toBe(Math.max(0, Math.floor(Math.min(45_000, remaining))));
      }),
      { numRuns: 200 },
    );
    expect(nextTimeoutMs(100_000, { providerCallTimeoutMs: 45_000 })).toBe(45_000);
    expect(nextTimeoutMs(12_345, { providerCallTimeoutMs: 45_000 })).toBe(12_345);
    expect(nextTimeoutMs(0, { providerCallTimeoutMs: 45_000 })).toBe(0);
  });
});

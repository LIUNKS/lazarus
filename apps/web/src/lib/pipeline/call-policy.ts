// The repair/fallback policy for provider calls (Requirements 10, 13, and 15). Pure module.
// There is no state with a third call: one reservation covers at most two provider calls.
import type { ErrorCode } from './errors';
import type { PipelineLimits } from './limits';

export type Outcome = 'valid' | 'invalid' | 'provider-error' | 'timeout' | 'auth' | 'deadline';

export type Step = { done: 'accept' } | { done: 'fail'; code: ErrorCode } | { next: 'repair' | 'fallback' };

/** What to do after the first call. */
export function afterFirst(outcome: Outcome, context: { fallbackEnabled: boolean }): Step {
  switch (outcome) {
    case 'valid':
      return { done: 'accept' };
    case 'invalid':
      return { next: 'repair' };
    case 'auth':
      return { done: 'fail', code: 'LLM_NOT_CONFIGURED' };
    case 'deadline':
      return { done: 'fail', code: 'LLM_TIMEOUT' };
    case 'provider-error':
      return context.fallbackEnabled ? { next: 'fallback' } : { done: 'fail', code: 'LLM_PROVIDER_ERROR' };
    case 'timeout':
      return context.fallbackEnabled ? { next: 'fallback' } : { done: 'fail', code: 'LLM_TIMEOUT' };
  }
}

/** What to do after the second call. The answer is always final. */
export function afterSecond(outcome: Outcome): Step {
  switch (outcome) {
    case 'valid':
      return { done: 'accept' };
    case 'invalid':
      return { done: 'fail', code: 'LLM_OUTPUT_INVALID' };
    case 'provider-error':
      return { done: 'fail', code: 'LLM_PROVIDER_ERROR' };
    case 'timeout':
    case 'deadline':
      return { done: 'fail', code: 'LLM_TIMEOUT' };
    case 'auth':
      return { done: 'fail', code: 'LLM_NOT_CONFIGURED' };
  }
}

/** The timeout of a call: the smaller of the Provider_Call_Timeout and the time left until the Request_Deadline. */
export function nextTimeoutMs(remainingMs: number, limits: Pick<PipelineLimits, 'providerCallTimeoutMs'>): number {
  return Math.max(0, Math.floor(Math.min(limits.providerCallTimeoutMs, remainingMs)));
}

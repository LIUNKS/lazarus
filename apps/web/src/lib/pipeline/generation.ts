import 'server-only';

// Runs the generation of one LLM stage with at most two provider calls (Requirements 10, 13, 15, and 16).
// One quota reservation, taken before this function runs, covers both calls. The first call goes to the primary
// provider. The second call is a repair call (same target, rule names added) after an invalid output, or a fallback
// call (Google target, first prompt) after a provider error or timeout. There is no third call and no call after
// the Request_Deadline. A failure throws a PipelineError and returns nothing, so nothing derived from the rejected
// output can reach a response or the database.
import type { z } from 'zod';
import type { LlmGateway, ProviderOutcome } from '@/lib/llm/generate';
import { afterFirst, afterSecond, nextTimeoutMs, type Outcome, type Step } from './call-policy';
import { PipelineError } from './errors';
import type { PipelineLimits } from './limits';
import type { Prompts, RetryInfo } from './prompts';
import type { Diagnostic } from './static-gate';

export type Validation = { ok: true } | { ok: false; failedRules: string[]; diagnostics?: Diagnostic[] };

export interface GenerationArgs<T> {
  gateway: LlmGateway;
  schema: z.ZodType<T>;
  validate(value: T): Validation;
  buildPrompts(retry: RetryInfo | null): Prompts;
  maxOutputTokens: number;
  /** The Request_Deadline combined with the signal of the incoming request. */
  deadline: AbortSignal;
  /** The instant of the Request_Deadline, in the unit of `now()`. */
  deadlineAt: number;
  now(): number;
  limits: Pick<PipelineLimits, 'providerCallTimeoutMs' | 'maxDiagnostics'>;
}

/** The rule name used when the provider output does not even match the zod schema. */
export const OUTPUT_SCHEMA_RULE = 'OUTPUT_SCHEMA';

interface CallResult<T> {
  outcome: Outcome;
  value?: T;
  failedRules: string[];
  diagnostics: Diagnostic[];
  /** A constant for the log line when the call ended because the client went away. */
  disconnected: boolean;
}

function toOutcome<T>(raw: ProviderOutcome<T>, schema: z.ZodType<T>, validate: (value: T) => Validation, maxDiagnostics: number): CallResult<T> {
  const empty = { failedRules: [] as string[], diagnostics: [] as Diagnostic[], disconnected: false };
  switch (raw.kind) {
    case 'ok': {
      // The gateway already parsed the output with this schema. Checking again keeps the validators from ever
      // seeing a value of the wrong shape, whatever gateway is plugged in.
      if (!schema.safeParse(raw.value).success) return { ...empty, outcome: 'invalid', failedRules: [OUTPUT_SCHEMA_RULE] };
      const verdict = validate(raw.value);
      if (verdict.ok) return { ...empty, outcome: 'valid', value: raw.value };
      return { ...empty, outcome: 'invalid', failedRules: verdict.failedRules, diagnostics: (verdict.diagnostics ?? []).slice(0, maxDiagnostics) };
    }
    case 'invalid-output':
      return { ...empty, outcome: 'invalid', failedRules: [OUTPUT_SCHEMA_RULE] };
    case 'aborted':
      return { ...empty, outcome: 'deadline', disconnected: raw.reason === 'disconnect' };
    case 'provider-error':
    case 'timeout':
    case 'auth':
      return { ...empty, outcome: raw.kind };
  }
}

function fail(step: Extract<Step, { done: 'fail' }>, detail: string): never {
  throw new PipelineError(step.code, { safeDetail: detail });
}

export async function runGeneration<T>(args: GenerationArgs<T>): Promise<T> {
  let calls = 0;

  const callOnce = async (target: 'primary' | 'fallback', retry: RetryInfo | null): Promise<CallResult<T>> => {
    const remaining = args.deadlineAt - args.now();
    if (remaining <= 0 || args.deadline.aborted) {
      // No call is made once the deadline has passed or the client has gone away. A timeout signal aborts with a
      // TimeoutError, so any other reason of an aborted signal is a disconnect.
      const reason: unknown = args.deadline.reason;
      const timedOut = remaining <= 0 || (reason instanceof Error && reason.name === 'TimeoutError');
      return { outcome: 'deadline', failedRules: [], diagnostics: [], disconnected: args.deadline.aborted && !timedOut };
    }
    calls += 1;
    const prompts = args.buildPrompts(retry);
    const raw = await args.gateway.generate<T>({
      target,
      instructions: prompts.instructions,
      prompt: prompts.prompt,
      schema: args.schema,
      maxOutputTokens: args.maxOutputTokens,
      timeoutMs: nextTimeoutMs(remaining, args.limits),
      deadline: args.deadline,
    });
    return toOutcome(raw, args.schema, args.validate, args.limits.maxDiagnostics);
  };

  // First call.
  const first = await callOnce('primary', null);
  const firstStep = afterFirst(first.outcome, { fallbackEnabled: args.gateway.fallbackAvailable });
  if ('done' in firstStep) {
    if (firstStep.done === 'accept') return first.value as T;
    return fail(firstStep, first.disconnected ? 'disconnect' : first.outcome);
  }

  // Second call: a repair call keeps the target and adds the failed rule names, a fallback call uses the first prompt.
  const second =
    firstStep.next === 'repair'
      ? await callOnce('primary', { failedRules: first.failedRules, diagnostics: first.diagnostics })
      : await callOnce('fallback', null);
  if (calls > 2) throw new PipelineError('INTERNAL_ERROR', { safeDetail: 'call-budget' });
  const secondStep = afterSecond(second.outcome);
  if ('done' in secondStep) {
    if (secondStep.done === 'accept') return second.value as T;
    return fail(secondStep, second.disconnected ? 'disconnect' : second.outcome === 'invalid' ? second.failedRules.join(',') : second.outcome);
  }
  // afterSecond never asks for a third call.
  throw new PipelineError('INTERNAL_ERROR', { safeDetail: 'call-budget' });
}

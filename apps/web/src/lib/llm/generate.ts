import 'server-only';

// The gateway to the LLM_Provider (Requirement 15). This is the only module that imports `ai`,
// `@ai-sdk/groq`, or `@ai-sdk/google`, so tests replace the provider with a mock language model.
//
// Names confirmed against the installed versions (ai 7.x, @ai-sdk/groq 4.x, @ai-sdk/google 4.x):
// generateText with output: Output.object({ schema }), `instructions`, `abortSignal`, `maxRetries`,
// `maxOutputTokens`, `temperature`, APICallError.statusCode, NoObjectGeneratedError, MockLanguageModelV4
// from `ai/test`, and the Groq option `providerOptions.groq.reasoningEffort`. No name differs from the design.
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import {
  APICallError,
  generateText,
  JSONParseError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
  type LanguageModel,
} from 'ai';
import type { z } from 'zod';
import type { LlmConfig } from './config';

export type ProviderOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'invalid-output' }
  | { kind: 'provider-error' }
  | { kind: 'timeout' }
  | { kind: 'auth' }
  | { kind: 'aborted'; reason: 'deadline' | 'disconnect' };

export interface ProviderCall<T> {
  target: 'primary' | 'fallback';
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  timeoutMs: number;
  /** The Request_Deadline combined with the signal of the incoming request. */
  deadline: AbortSignal;
}

export interface LlmGateway {
  readonly fallbackAvailable: boolean;
  generate<T>(call: ProviderCall<T>): Promise<ProviderOutcome<T>>;
}

/** Provider options keyed by provider name, as `generateText` expects them. */
export type ProviderOptionsInput = Record<string, Record<string, string | number | boolean>>;

const GROQ_REASONING_MODEL_PREFIX = 'openai/gpt-oss-';

/**
 * The default model is a reasoning model, and reasoning tokens count against the output limit.
 * Low effort keeps room for the structured answer. Other model ids get no extra option.
 */
export function groqProviderOptions(modelId: string): ProviderOptionsInput | undefined {
  return modelId.startsWith(GROQ_REASONING_MODEL_PREFIX) ? { groq: { reasoningEffort: 'low' } } : undefined;
}

function isInvalidOutput(error: unknown): boolean {
  return (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error) ||
    TypeValidationError.isInstance(error) ||
    JSONParseError.isInstance(error)
  );
}

/**
 * Maps a thrown error to an outcome. It copies no error text, request id, header, raw response,
 * reasoning, or usage into the result: only the kind (and, for an abort, its cause) leaves this function.
 */
function classify(error: unknown, deadline: AbortSignal, timeout: AbortSignal): ProviderOutcome<never> {
  if (isInvalidOutput(error)) return { kind: 'invalid-output' };
  if (APICallError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) return { kind: 'auth' };
  if (deadline.aborted) {
    // A timeout signal aborts with a TimeoutError. Any other reason comes from the incoming request (client disconnect).
    const reason: unknown = deadline.reason;
    const isDeadline = reason instanceof Error && reason.name === 'TimeoutError';
    return { kind: 'aborted', reason: isDeadline ? 'deadline' : 'disconnect' };
  }
  if (timeout.aborted) return { kind: 'timeout' };
  return { kind: 'provider-error' };
}

export function createGatewayFromModels(models: {
  primary: LanguageModel;
  fallback: LanguageModel | null;
  primaryProviderOptions?: ProviderOptionsInput | undefined;
}): LlmGateway {
  return {
    fallbackAvailable: models.fallback !== null,
    async generate<T>(call: ProviderCall<T>): Promise<ProviderOutcome<T>> {
      const model = call.target === 'fallback' ? models.fallback : models.primary;
      if (model === null) return { kind: 'provider-error' };
      const providerOptions = call.target === 'primary' ? models.primaryProviderOptions : undefined;

      const timeout = AbortSignal.timeout(call.timeoutMs);
      const signal = AbortSignal.any([call.deadline, timeout]);
      try {
        const result = await generateText({
          model,
          instructions: call.instructions,
          prompt: call.prompt,
          output: Output.object({ schema: call.schema }),
          temperature: 0,
          maxOutputTokens: call.maxOutputTokens,
          // The call policy allows at most two calls per request, so the SDK must not retry on its own.
          maxRetries: 0,
          abortSignal: signal,
          // No `tools` key: the tool set is empty on every call (Requirement 16 criterion 4).
          ...(providerOptions ? { providerOptions } : {}),
        });
        // Only the parsed output leaves this module (Requirement 16 criterion 6).
        return { kind: 'ok', value: result.output };
      } catch (error) {
        return classify(error, call.deadline, timeout);
      }
    },
  };
}

export function createGateway(config: LlmConfig): LlmGateway {
  const groq = createGroq({ apiKey: config.groqApiKey });
  const fallback = config.fallback
    ? createGoogleGenerativeAI({ apiKey: config.fallback.googleApiKey })(config.fallback.model)
    : null;
  return createGatewayFromModels({
    primary: groq(config.model),
    fallback,
    primaryProviderOptions: groqProviderOptions(config.model),
  });
}

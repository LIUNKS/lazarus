import 'server-only';

// The only module that reads the four LLM_Config variables (Requirement 1 criterion 5 and Requirement 2).
// It returns names and reasons only. A value is never part of a problem, a message, or a log line.

export interface LlmConfig {
  groqApiKey: string;
  model: string;
  /** Present only when both Google variables are set and valid. */
  fallback: { googleApiKey: string; model: string } | null;
}

export type LlmVariable = 'GROQ_API_KEY' | 'LLM_MODEL' | 'GOOGLE_GENERATIVE_AI_API_KEY' | 'LLM_FALLBACK_MODEL';

export interface LlmProblem {
  variable: LlmVariable;
  reason: 'missing' | 'invalid';
}

export type LlmConfigResult = { ok: true; config: LlmConfig } | { ok: false; problems: LlmProblem[] };

export const DEFAULT_LLM_MODEL = 'openai/gpt-oss-120b';
const MAX_KEY_LENGTH = 512;
const MAX_MODEL_LENGTH = 200;
// Groq retired this model on 2026-08-16. It appears here only as the value to reject (Requirement 2 criterion 9),
// never as a default and never as a value sent to a provider.
const RETIRED_MODEL = 'llama-3.3-70b-versatile';

type Env = Record<string, string | undefined>;

/** Trims the value and treats a blank value as unset. */
function read(env: Env, name: LlmVariable): string | null {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? null : value;
}

const isRetired = (model: string): boolean => model.toLowerCase() === RETIRED_MODEL;

export function readLlmConfig(env: Env = process.env): LlmConfigResult {
  const problems: LlmProblem[] = [];
  const problem = (variable: LlmVariable, reason: LlmProblem['reason']) => problems.push({ variable, reason });

  const groqApiKey = read(env, 'GROQ_API_KEY');
  if (groqApiKey === null) problem('GROQ_API_KEY', 'missing');
  else if (groqApiKey.length > MAX_KEY_LENGTH) problem('GROQ_API_KEY', 'invalid');

  const configuredModel = read(env, 'LLM_MODEL');
  const model = configuredModel ?? DEFAULT_LLM_MODEL;
  if (model.length > MAX_MODEL_LENGTH || isRetired(model)) problem('LLM_MODEL', 'invalid');

  // The Google pair is optional. A blank half is not a problem, it only disables the fallback.
  const googleApiKey = read(env, 'GOOGLE_GENERATIVE_AI_API_KEY');
  const fallbackModel = read(env, 'LLM_FALLBACK_MODEL');
  if (googleApiKey !== null && googleApiKey.length > MAX_KEY_LENGTH) problem('GOOGLE_GENERATIVE_AI_API_KEY', 'invalid');
  if (fallbackModel !== null && (fallbackModel.length > MAX_MODEL_LENGTH || isRetired(fallbackModel))) {
    problem('LLM_FALLBACK_MODEL', 'invalid');
  }

  if (problems.length > 0 || groqApiKey === null) return { ok: false, problems };
  return {
    ok: true,
    config: {
      groqApiKey,
      model,
      fallback: googleApiKey !== null && fallbackModel !== null ? { googleApiKey, model: fallbackModel } : null,
    },
  };
}

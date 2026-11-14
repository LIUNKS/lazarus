import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LLM_MODEL, readLlmConfig, type LlmProblem, type LlmVariable } from './config';

type Env = Record<string, string | undefined>;

const NAMES: LlmVariable[] = ['GROQ_API_KEY', 'LLM_MODEL', 'GOOGLE_GENERATIVE_AI_API_KEY', 'LLM_FALLBACK_MODEL'];
const RETIRED = 'llama-3.3-70b-versatile';

const pad = fc.constantFrom('', ' ', '  ', '\t', '\n ');
const token = fc.stringMatching(/^[a-z0-9]{1,30}$/).map((text) => `val-${text}`);
const padded = (core: fc.Arbitrary<string>) => fc.tuple(pad, core, pad).map(([a, b, c]) => `${a}${b}${c}`);
const recase = fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }).map((mask) => (text: string) =>
  [...text].map((char, i) => (mask[i % mask.length] ? char.toUpperCase() : char.toLowerCase())).join(''),
);

const keyValue = fc.oneof(
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: padded(fc.constantFrom('', ' ', '   ')) },
  { weight: 4, arbitrary: padded(token) },
  { weight: 1, arbitrary: padded(fc.integer({ min: 513, max: 520 }).map((n) => `k${'x'.repeat(n)}`)) },
  { weight: 1, arbitrary: padded(fc.constant(`k${'x'.repeat(511)}`)) },
);
const modelValue = fc.oneof(
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: padded(fc.constant('')) },
  { weight: 4, arbitrary: padded(token) },
  { weight: 1, arbitrary: padded(fc.integer({ min: 201, max: 210 }).map((n) => `m${'y'.repeat(n)}`)) },
  { weight: 1, arbitrary: padded(fc.constant(`m${'y'.repeat(199)}`)) },
  { weight: 2, arbitrary: fc.tuple(recase, pad, pad).map(([fn, a, b]) => `${a}${fn(RETIRED)}${b}`) },
);

const envs: fc.Arbitrary<Env> = fc.record({
  GROQ_API_KEY: keyValue,
  LLM_MODEL: modelValue,
  GOOGLE_GENERATIVE_AI_API_KEY: keyValue,
  LLM_FALLBACK_MODEL: modelValue,
});

// Oracle written separately from the implementation.
function oracle(env: Env): { problems: LlmProblem[]; fallbackOn: boolean; model: string } {
  const get = (name: LlmVariable): string | undefined => {
    const text = (env[name] ?? '').trim();
    return text.length === 0 ? undefined : text;
  };
  const groq = get('GROQ_API_KEY');
  const model = get('LLM_MODEL');
  const gKey = get('GOOGLE_GENERATIVE_AI_API_KEY');
  const gModel = get('LLM_FALLBACK_MODEL');
  const problems: LlmProblem[] = [];
  if (groq === undefined) problems.push({ variable: 'GROQ_API_KEY', reason: 'missing' });
  else if (groq.length > 512) problems.push({ variable: 'GROQ_API_KEY', reason: 'invalid' });
  if (model !== undefined && (model.length > 200 || model.toLowerCase() === RETIRED)) problems.push({ variable: 'LLM_MODEL', reason: 'invalid' });
  if (gKey !== undefined && gKey.length > 512) problems.push({ variable: 'GOOGLE_GENERATIVE_AI_API_KEY', reason: 'invalid' });
  if (gModel !== undefined && (gModel.length > 200 || gModel.toLowerCase() === RETIRED)) problems.push({ variable: 'LLM_FALLBACK_MODEL', reason: 'invalid' });
  return { problems, fallbackOn: gKey !== undefined && gModel !== undefined, model: model ?? 'openai/gpt-oss-120b' };
}

describe('R2 LLM configuration (Requirement 2)', () => {
  it('R2.1 R2.2 R2.3 R2.4 R2.9 matches the reference for any map of the four variables (Requirement 2)', () => {
    // Feature: 05-llm-pipeline-api, Property 20: LLM configuration
    fc.assert(
      fc.property(envs, (env) => {
        const expected = oracle(env);
        const result = readLlmConfig(env);
        if (expected.problems.length > 0) {
          expect(result).toEqual({ ok: false, problems: expected.problems });
        } else {
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.config.groqApiKey).toBe((env['GROQ_API_KEY'] ?? '').trim());
          expect(result.config.model).toBe(expected.model);
          expect(result.config.fallback !== null).toBe(expected.fallbackOn);
          if (result.config.fallback) {
            expect(result.config.fallback.googleApiKey).toBe((env['GOOGLE_GENERATIVE_AI_API_KEY'] ?? '').trim());
            expect(result.config.fallback.model).toBe((env['LLM_FALLBACK_MODEL'] ?? '').trim());
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('R2.4 never puts a supplied value into a problem (Requirement 2)', () => {
    // Feature: 05-llm-pipeline-api, Property 20: LLM configuration
    fc.assert(
      fc.property(envs, (env) => {
        const result = readLlmConfig(env);
        if (result.ok) return;
        const text = JSON.stringify(result.problems);
        for (const name of NAMES) {
          const value = (env[name] ?? '').trim();
          if (value.length >= 4) expect(text.includes(value), `a problem contains the value of ${name}`).toBe(false);
        }
        for (const problem of result.problems) expect(Object.keys(problem).sort()).toEqual(['reason', 'variable']);
      }),
      { numRuns: 200 },
    );
  });

  it('R2.1 uses the default model when LLM_MODEL is unset or blank (Requirement 2)', () => {
    expect(DEFAULT_LLM_MODEL).toBe('openai/gpt-oss-120b');
    for (const model of [undefined, '', '   ']) {
      const result = readLlmConfig({ GROQ_API_KEY: 'key', LLM_MODEL: model });
      expect(result).toEqual({ ok: true, config: { groqApiKey: 'key', model: 'openai/gpt-oss-120b', fallback: null } });
    }
  });

  it('R2.3 does not report a problem when only one Google variable is set, and disables the fallback (Requirement 2)', () => {
    for (const env of [{ GOOGLE_GENERATIVE_AI_API_KEY: 'g' }, { LLM_FALLBACK_MODEL: 'gemini-x' }]) {
      const result = readLlmConfig({ GROQ_API_KEY: 'key', ...env });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.config.fallback).toBeNull();
    }
  });

  it('R2.2 enables the fallback when both Google variables are set (Requirement 2)', () => {
    const result = readLlmConfig({ GROQ_API_KEY: 'key', GOOGLE_GENERATIVE_AI_API_KEY: ' g ', LLM_FALLBACK_MODEL: ' gemini-x ' });
    expect(result.ok && result.config.fallback).toEqual({ googleApiKey: 'g', model: 'gemini-x' });
  });

  it('R2.9 flags the retired model id in either model variable, in any letter case, even without a Google key (Requirement 2)', () => {
    expect(readLlmConfig({ GROQ_API_KEY: 'k', LLM_MODEL: ` ${RETIRED.toUpperCase()} ` })).toEqual({
      ok: false,
      problems: [{ variable: 'LLM_MODEL', reason: 'invalid' }],
    });
    expect(readLlmConfig({ GROQ_API_KEY: 'k', LLM_FALLBACK_MODEL: RETIRED })).toEqual({
      ok: false,
      problems: [{ variable: 'LLM_FALLBACK_MODEL', reason: 'invalid' }],
    });
  });

  it('R2.4 lists every missing or invalid variable at once (Requirement 2)', () => {
    expect(readLlmConfig({ LLM_MODEL: RETIRED, GOOGLE_GENERATIVE_AI_API_KEY: 'x'.repeat(513) })).toEqual({
      ok: false,
      problems: [
        { variable: 'GROQ_API_KEY', reason: 'missing' },
        { variable: 'LLM_MODEL', reason: 'invalid' },
        { variable: 'GOOGLE_GENERATIVE_AI_API_KEY', reason: 'invalid' },
      ],
    });
  });
});

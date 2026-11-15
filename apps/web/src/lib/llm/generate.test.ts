import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGatewayFromModels, groqProviderOptions, type ProviderCall } from './generate';

const schema = z.object({ value: z.string() }).strict();
const SENTINEL = 'sentinel-provider-error-text-77c1';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const textResult = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage,
  warnings: [],
});

function apiError(statusCode: number | undefined): APICallError {
  return new APICallError({
    message: SENTINEL,
    url: 'https://provider.invalid/v1',
    requestBodyValues: { prompt: SENTINEL },
    ...(statusCode === undefined ? {} : { statusCode }),
    responseHeaders: { 'x-request-id': SENTINEL },
    responseBody: SENTINEL,
  });
}

function makeCall(overrides: Partial<ProviderCall<{ value: string }>> = {}): ProviderCall<{ value: string }> {
  return {
    target: 'primary',
    instructions: 'Instructions text.',
    prompt: 'Prompt text.',
    schema,
    maxOutputTokens: 4_000,
    timeoutMs: 5_000,
    deadline: new AbortController().signal,
    ...overrides,
  };
}

const failing = (error: unknown) => new MockLanguageModelV4({ doGenerate: async () => { throw error; } });

describe('R15 gateway (Requirement 15)', () => {
  it('R15.1 R16.4 returns the parsed output and sends temperature 0, the token limit, and no tools (Requirement 15 and 16)', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult('{"value":"hello"}') });
    const gateway = createGatewayFromModels({ primary: model, fallback: null });
    const outcome = await gateway.generate(makeCall({ maxOutputTokens: 4_000 }));
    expect(outcome).toEqual({ kind: 'ok', value: { value: 'hello' } });
    expect(model.doGenerateCalls).toHaveLength(1);
    const options = model.doGenerateCalls[0]!;
    expect(options.temperature).toBe(0);
    expect(options.maxOutputTokens).toBe(4_000);
    expect(options.tools ?? []).toHaveLength(0);
  });

  it('R15.3 sets the SDK retry count to 0, so a retryable error makes exactly one provider request (Requirement 15)', async () => {
    const model = failing(apiError(429));
    const gateway = createGatewayFromModels({ primary: model, fallback: null });
    expect(await gateway.generate(makeCall())).toEqual({ kind: 'provider-error' });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('R15.2 passes the reasoning option only for openai/gpt-oss model ids and only to the primary target (Requirement 15)', async () => {
    expect(groqProviderOptions('openai/gpt-oss-120b')).toEqual({ groq: { reasoningEffort: 'low' } });
    expect(groqProviderOptions('openai/gpt-oss-20b')).toEqual({ groq: { reasoningEffort: 'low' } });
    expect(groqProviderOptions('some-other/model')).toBeUndefined();

    const primary = new MockLanguageModelV4({ doGenerate: async () => textResult('{"value":"a"}') });
    const fallback = new MockLanguageModelV4({ doGenerate: async () => textResult('{"value":"b"}') });
    const gateway = createGatewayFromModels({ primary, fallback, primaryProviderOptions: groqProviderOptions('openai/gpt-oss-120b') });
    await gateway.generate(makeCall({ target: 'primary' }));
    await gateway.generate(makeCall({ target: 'fallback' }));
    expect(primary.doGenerateCalls[0]!.providerOptions).toEqual({ groq: { reasoningEffort: 'low' } });
    expect(fallback.doGenerateCalls[0]!.providerOptions?.['groq']).toBeUndefined();

    const plain = new MockLanguageModelV4({ doGenerate: async () => textResult('{"value":"c"}') });
    await createGatewayFromModels({ primary: plain, fallback: null, primaryProviderOptions: groqProviderOptions('other') }).generate(makeCall());
    expect(plain.doGenerateCalls[0]!.providerOptions?.['groq']).toBeUndefined();
  });

  it('R15.4 reports whether a fallback model exists and returns provider-error for a missing fallback target (Requirement 15)', async () => {
    const primary = new MockLanguageModelV4({ doGenerate: async () => textResult('{"value":"a"}') });
    const without = createGatewayFromModels({ primary, fallback: null });
    expect(without.fallbackAvailable).toBe(false);
    expect(await without.generate(makeCall({ target: 'fallback' }))).toEqual({ kind: 'provider-error' });
    expect(primary.doGenerateCalls).toHaveLength(0);
    expect(createGatewayFromModels({ primary, fallback: primary }).fallbackAvailable).toBe(true);
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'provider-error'],
    [500, 'provider-error'],
    [503, 'provider-error'],
    [undefined, 'provider-error'],
  ] as const)('R15.8 classifies an APICallError with status %s as %s (Requirement 15)', async (status, kind) => {
    const gateway = createGatewayFromModels({ primary: failing(apiError(status)), fallback: null });
    expect(await gateway.generate(makeCall())).toEqual({ kind });
  });

  it('R15.7 classifies a network-style error as a provider error (Requirement 15)', async () => {
    const gateway = createGatewayFromModels({ primary: failing(new TypeError('fetch failed')), fallback: null });
    expect(await gateway.generate(makeCall())).toEqual({ kind: 'provider-error' });
  });

  it('R16.7 classifies text that is not JSON and JSON with the wrong shape as invalid-output (Requirement 16)', async () => {
    for (const text of ['not json at all', '{"other":1}', '{"value":5}', '{"value":"x","extra":true}']) {
      const model = new MockLanguageModelV4({ doGenerate: async () => textResult(text) });
      const outcome = await createGatewayFromModels({ primary: model, fallback: null }).generate(makeCall());
      expect(outcome, text).toEqual({ kind: 'invalid-output' });
    }
  });

  it('R15.2 aborts a call that runs longer than its timeout and reports timeout (Requirement 15)', async () => {
    const slow = new MockLanguageModelV4({
      doGenerate: (options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
        }),
    });
    const outcome = await createGatewayFromModels({ primary: slow, fallback: null }).generate(makeCall({ timeoutMs: 25 }));
    expect(outcome).toEqual({ kind: 'timeout' });
  });

  it('R15.9 aborts a call in progress when the Request_Deadline passes (Requirement 15)', async () => {
    const slow = new MockLanguageModelV4({
      doGenerate: (options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
        }),
    });
    const outcome = await createGatewayFromModels({ primary: slow, fallback: null }).generate(
      makeCall({ deadline: AbortSignal.timeout(25), timeoutMs: 5_000 }),
    );
    expect(outcome).toEqual({ kind: 'aborted', reason: 'deadline' });
  });

  it('R15.9 reports a client disconnect as an abort with reason disconnect (Requirement 15)', async () => {
    const controller = new AbortController();
    const slow = new MockLanguageModelV4({
      doGenerate: (options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
          setTimeout(() => controller.abort(), 15);
        }),
    });
    const outcome = await createGatewayFromModels({ primary: slow, fallback: null }).generate(
      makeCall({ deadline: controller.signal, timeoutMs: 5_000 }),
    );
    expect(outcome).toEqual({ kind: 'aborted', reason: 'disconnect' });
  });

  it('R15.7 R16.6 never copies error text, headers, or a request id into any outcome (Requirements 15 and 16)', async () => {
    for (const status of [401, 403, 429, 500, undefined]) {
      const outcome = await createGatewayFromModels({ primary: failing(apiError(status)), fallback: null }).generate(makeCall());
      expect(JSON.stringify(outcome).includes(SENTINEL)).toBe(false);
      expect(Object.keys(outcome)).toEqual(['kind']);
    }
    const ok = new MockLanguageModelV4({ doGenerate: async () => textResult('{"value":"fine"}') });
    const outcome = await createGatewayFromModels({ primary: ok, fallback: null }).generate(makeCall());
    expect(Object.keys(outcome).sort()).toEqual(['kind', 'value']);
  });
});

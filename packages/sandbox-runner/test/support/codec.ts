import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = (name: string): string =>
  readFileSync(new URL(`../../src/worker/scripts/${name}`, import.meta.url), 'utf8');

export interface Codec {
  encode(value: unknown, maxBytes: number): string;
  decode(text: string): unknown;
  /** Runs script text in the context of this codec and returns its completion value. */
  evaluate(code: string): unknown;
}

export const DEFAULT_MAX_BYTES = 65_536;

/**
 * Evaluates the prelude and the codec in a fresh plain `vm` context and hands back their functions.
 * Only tests do this: in a real run nothing but strings leaves the context.
 */
export function loadCodec(): Codec {
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY, {
    microtaskMode: 'afterEvaluate',
    codeGeneration: { strings: false, wasm: false },
  });
  const body = `(function () { 'use strict';\n${script('prelude.js')}\n${script('codec.js')}\nreturn { encode: encode, decode: decode, isFailure: isFailure }; })()`;
  const api = vm.runInContext(body, context) as {
    encode: Codec['encode'];
    decode: Codec['decode'];
    isFailure(value: unknown): boolean;
  };

  // Failures are objects without a prototype. Turn them into Errors so tests can match on them.
  const guard = <T>(run: () => T): T => {
    try {
      return run();
    } catch (error) {
      if (api.isFailure(error)) {
        const failure = error as { code: string; message: string };
        throw new Error(`${failure.code}: ${failure.message}`);
      }
      throw error;
    }
  };

  return {
    encode: (value, maxBytes) => guard(() => api.encode(value, maxBytes)),
    decode: (text) => guard(() => api.decode(text)),
    evaluate: (code) => vm.runInContext(code, context),
  };
}

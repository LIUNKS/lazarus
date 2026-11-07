// Test_Code_Contract runner (see `database-and-exorcism.md`, section 3).
// Used by the seed generator and the Verification_Suite. It runs ONLY the trusted sample sources of this repository:
// node:vm is not a security boundary. `packages/pbt-verifier` is the runtime implementation for the web application.
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import * as fc from 'fast-check';
import { equivalentOutcomes, renderOutcome, type Outcome } from './deep-equivalent.ts';
import { transpileToCommonJs, typecheckStrict } from './typecheck.ts';

export interface PbtRunInput {
  legacyCode: string;
  modernCode: string;
  entryFunction: string;
  testCode: string;
  numRuns: number;
  seed?: number;
  callTimeoutMs?: number;
}

export interface PbtRunResult {
  passed: boolean;
  totalRuns: number;
  executionTimeMs: number;
  seed: number;
  message: string;
}

// Context-side deep copy so that `instanceof Array` and similar checks behave natively.
const CLONER_SOURCE = `(function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    var copy = new Array(value.length);
    for (var i = 0; i < value.length; i++) { if (i in value) copy[i] = clone(value[i]); }
    return copy;
  }
  var result = {};
  var keys = Object.keys(value);
  for (var j = 0; j < keys.length; j++) {
    Object.defineProperty(result, keys[j], {
      value: clone(value[keys[j]]), enumerable: true, writable: true, configurable: true
    });
  }
  return result;
})`;

interface Side {
  call(input: unknown): Outcome;
}

function makeSide(context: vm.Context, fn: unknown, timeoutMs: number): Side {
  const clone = vm.runInContext(CLONER_SOURCE, context) as (value: unknown) => unknown;
  return {
    call(input) {
      const sandbox = context as { __fn?: unknown; __in?: unknown };
      sandbox.__fn = fn;
      sandbox.__in = clone(input);
      try {
        const value = vm.runInContext('__fn(__in)', context, { timeout: timeoutMs });
        return { kind: 'returned', value };
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: unknown }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
        ) {
          throw new Error(`A call exceeded ${timeoutMs} ms.`);
        }
        const name =
          typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string'
            ? (error as { name: string }).name
            : 'non-error';
        return { kind: 'threw', name };
      } finally {
        delete sandbox.__fn;
        delete sandbox.__in;
      }
    },
  };
}

function loadEntry(context: vm.Context, name: string, side: string): unknown {
  const fn = vm.runInContext(`typeof ${name} === 'function' ? ${name} : undefined`, context);
  if (typeof fn !== 'function') throw new Error(`Entry function "${name}" not found in ${side} code.`);
  return fn;
}

function unwrap(outcome: Outcome): unknown {
  if (outcome.kind === 'returned') return outcome.value;
  const error = new Error(outcome.name);
  error.name = outcome.name;
  throw error;
}

export async function runPbtTestCode(input: PbtRunInput): Promise<PbtRunResult> {
  const started = performance.now();
  const timeoutMs = input.callTimeoutMs ?? 1000;
  const seed = input.seed ?? Date.now() | 0;

  // Legacy code: classic script, no host globals.
  const legacyContext = vm.createContext({});
  vm.runInContext(input.legacyCode, legacyContext, { timeout: timeoutMs, filename: 'legacy.js' });
  const legacy = makeSide(legacyContext, loadEntry(legacyContext, input.entryFunction, 'legacy'), timeoutMs);

  // Modern code: strict type-check, then CommonJS evaluation with an injected `exports`.
  const diagnostics = typecheckStrict(input.modernCode);
  if (diagnostics.length > 0) {
    throw new Error(`modern_code does not compile under strict mode:\n${diagnostics.slice(0, 10).join('\n')}`);
  }
  const modernContext = vm.createContext({ exports: {} });
  vm.runInContext(transpileToCommonJs(input.modernCode), modernContext, { timeout: timeoutMs, filename: 'modern.js' });
  const exported = (modernContext as { exports: Record<string, unknown> }).exports[input.entryFunction];
  if (typeof exported !== 'function') {
    throw new Error(`Entry function "${input.entryFunction}" not exported by modern code.`);
  }
  const modern = makeSide(modernContext, exported, timeoutMs);

  const assertEquivalent = (value: unknown): void => {
    const left = legacy.call(value);
    const right = modern.call(value);
    if (!equivalentOutcomes(left, right)) {
      throw new Error(`Outcomes differ. legacy: ${renderOutcome(left)}; modern: ${renderOutcome(right)}`);
    }
  };

  // Test code: body of a function with the contract parameters.
  const testContext = vm.createContext({});
  const factory = vm.runInContext(
    `(function (fc, legacyFn, modernFn, assertEquivalent, numRuns) {\n${input.testCode}\n})`,
    testContext,
    { filename: 'test-code.js' },
  ) as (...args: unknown[]) => unknown;
  const property = factory(
    fc,
    (value: unknown) => unwrap(legacy.call(value)),
    (value: unknown) => unwrap(modern.call(value)),
    assertEquivalent,
    input.numRuns,
  );
  if (typeof property !== 'object' || property === null || typeof (property as { run?: unknown }).run !== 'function') {
    throw new Error('Test code did not return a fast-check property.');
  }

  const details = await fc.check(property as fc.IRawProperty<unknown>, { numRuns: input.numRuns, seed });
  const executionTimeMs = Math.max(1, Math.round(performance.now() - started));
  return {
    passed: !details.failed,
    totalRuns: details.numRuns,
    executionTimeMs,
    seed,
    message: details.failed ? failureMessage(details) : `Passed ${details.numRuns} runs.`,
  };

}

function failureMessage(details: fc.RunDetails<unknown>): string {
  const cause = details.failed && details.errorInstance instanceof Error ? `\n${details.errorInstance.message}` : '';
  return `${fc.defaultReportMessage(details)}${cause}`;
}
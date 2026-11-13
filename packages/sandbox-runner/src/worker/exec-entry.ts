// Exec_Worker bootstrap. It runs inside a Worker thread and is the only code of the Worker's own
// realm that touches untrusted code.
//
// Rules this file keeps (Requirement 4):
// - It is an ES module, so it is strict-mode code: the stack trace API cannot expose the receiver or
//   the function of its frames to code running in a context.
// - It imports only `node:vm` and `node:worker_threads`.
// - No object, function, or array of this realm is placed into a context. Trusted helpers are script
//   text evaluated inside the contexts, and only strings, numbers, and booleans go in, as script text.
// - Values thrown by untrusted code are never inspected here. They are handed back to the context
//   they came from, where a Trusted_Script reads `name` and `message` under a vm timeout.
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';

// Trusted_Scripts and the fast-check bundle, embedded as text by scripts/build-worker.mjs.
declare const __LZ_PRELUDE__: string;
declare const __LZ_CODEC__: string;
declare const __LZ_SIDE__: string;
declare const __LZ_DRIVER__: string;
declare const __LZ_FAST_CHECK__: string;

type Side = 'legacy' | 'modern';
type Context = ReturnType<typeof vm.createContext>;

const data = workerData as Record<string, string | number | boolean>;
const text = (key: string): string => String(data[key]);
const number = (key: string): number => Number(data[key]);

const allowDynamicCode = data.allowDynamicCode === true;
const maxValueBytes = number('maxValueBytes');
const maxResultBytes = number('maxResultBytes');
const entryName = text('entryFunction');
const startedAt = performance.now();
const wallClockMs = number('wallClockTimeoutMs');

const DESCRIBE_TIMEOUT_MS = 1_000;
const PROGRESS_TIMEOUT_MS = 500;

/** Time left of the wall-clock budget, at least 1 ms (a vm timeout must be positive). */
const remaining = (): number => Math.max(1, Math.floor(wallClockMs - (performance.now() - startedAt)));

const errorText = (code: string, message: string): string =>
  JSON.stringify({ t: 'error', code, message: message.length > 500 ? `${message.slice(0, 497)}...` : message });

/** Ends the run with a result. Thrown through the bootstrap and caught once at the bottom. */
class Done {
  constructor(readonly result: string) {}
}
const finish = (result: string): never => {
  throw new Done(result);
};

// A dynamic import() in a context without a loader rejects with this code. The reason is inspected
// only when it is an Error of this realm, so a value rejected by untrusted code is never read.
let dynamicImportSeen = false;
process.on('unhandledRejection', (reason: unknown) => {
  if (reason instanceof Error && (reason as { code?: unknown }).code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING') {
    dynamicImportSeen = true;
  }
});

/** Lets pending rejection events fire, then reports a dynamic import() seen during `side`. */
async function checkDynamicImport(side: string): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (dynamicImportSeen) {
    finish(errorText('SANDBOX_FORBIDDEN_CAPABILITY', `The ${side} code used a denied capability: dynamic import().`));
  }
}

const randomName = (): string => `__lz_${crypto.randomUUID().replaceAll('-', '')}`;

function createContext(): Context {
  return vm.createContext(vm.constants.DONT_CONTEXTIFY, {
    microtaskMode: 'afterEvaluate',
    codeGeneration: { strings: allowDynamicCode, wasm: false },
  });
}

/** Evaluates Trusted_Script fragments inside one function body, with CONFIG as a literal. */
function runTrusted(context: Context, fragments: string[], config: Record<string, string | number | boolean>): void {
  const source = `(function (CONFIG) { 'use strict';\n${fragments.join('\n')}\n})(${JSON.stringify(config)});`;
  // No untrusted code has run in this context yet, so the only expected failure is the time budget
  // running out, for example on a busy host.
  const result = evaluate(context, source, remaining());
  if (!result.ok) {
    finish(
      result.kind === 'timeout'
        ? errorText('SANDBOX_TIMEOUT', 'The sandbox setup did not finish within the time limit (side: unknown).')
        : errorText('SANDBOX_CRASH', 'The sandbox setup could not be completed.'),
    );
  }
}

type Evaluation = { ok: true; value: unknown } | { ok: false; kind: 'timeout' } | { ok: false; kind: 'threw'; thrown: unknown };

/**
 * Evaluates script text under a vm timeout. A timeout is recognized by the elapsed time, not by
 * reading the thrown value, because untrusted code can throw a look-alike.
 */
function evaluate(context: Context, source: string, timeoutMs: number): Evaluation {
  const began = performance.now();
  try {
    return { ok: true, value: vm.runInContext(source, context, { timeout: timeoutMs }) };
  } catch (thrown) {
    // The vm timer can fire a fraction of a millisecond before the measured limit, so a small
    // tolerance is allowed. A throw that close to the limit is reported as a timeout, which is harmless.
    const tolerance = Math.max(2, timeoutMs * 0.05);
    if (performance.now() - began >= timeoutMs - tolerance) return { ok: false, kind: 'timeout' };
    return { ok: false, kind: 'threw', thrown };
  }
}

/** Asks a Trusted_Script for a string and accepts nothing else. */
function ask(context: Context, call: string, timeoutMs: number): string | null {
  const result = evaluate(context, call, timeoutMs);
  return result.ok && typeof result.value === 'string' ? result.value : null;
}

const literal = (value: string): string => JSON.stringify(value);

interface LoadedSide {
  context: Context;
  apiName: string;
}

/** "Name: message" of a value thrown at load time, read inside the context it came from. */
function describeInContext(side: LoadedSide, thrown: unknown): string {
  try {
    const api = vm.runInContext(side.apiName, side.context) as (operation: string, argument: unknown) => unknown;
    api('stash', thrown);
    return ask(side.context, `${side.apiName}("describe")`, Math.min(remaining(), DESCRIBE_TIMEOUT_MS)) ?? 'unknown error';
  } catch {
    return 'unknown error';
  }
}

function forbiddenOf(side: LoadedSide): string {
  return ask(side.context, `${side.apiName}("forbidden")`, Math.min(remaining(), DESCRIBE_TIMEOUT_MS)) ?? '';
}

function checkForbidden(side: LoadedSide, label: string): void {
  const capability = forbiddenOf(side);
  if (capability !== '') {
    finish(errorText('SANDBOX_FORBIDDEN_CAPABILITY', `The ${label} code used a denied capability: ${capability.slice(0, 100)}.`));
  }
}

/** A syntax error is raised by the engine in this realm, so reading its name and message runs no untrusted code. */
function syntaxDetail(source: string, filename: string): string | null {
  try {
    new vm.Script(source, { filename });
    return null;
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'SyntaxError';
    return detail.length > 300 ? `${detail.slice(0, 297)}...` : detail;
  }
}

async function loadSide(side: Side, code: string): Promise<LoadedSide> {
  const loaded: LoadedSide = { context: createContext(), apiName: randomName() };
  runTrusted(loaded.context, [__LZ_PRELUDE__, __LZ_CODEC__, __LZ_SIDE__], {
    side,
    apiName: loaded.apiName,
    allowDynamicCode,
    maxValueBytes,
  });

  const loadError = side === 'legacy' ? 'LEGACY_LOAD_ERROR' : 'MODERN_LOAD_ERROR';
  const syntax = syntaxDetail(code, `${side}.js`);
  if (syntax !== null) finish(errorText(loadError, `The ${side} code could not be loaded: ${syntax}`));

  // Legacy_Code runs unmodified as a classic script. Modern_Code is the transpiled CommonJS text.
  const result = evaluate(loaded.context, code, remaining());
  if (!result.ok) {
    if (result.kind === 'timeout') {
      finish(errorText('SANDBOX_TIMEOUT', `The ${side} code did not finish loading within the time limit.`));
    } else {
      const detail = describeInContext(loaded, result.thrown);
      checkForbidden(loaded, side);
      finish(errorText(loadError, `The ${side} code threw while loading: ${detail}`));
    }
  }
  await checkDynamicImport(side);

  // `entryName` was validated as an identifier on the host, so it can be placed in script text as it is.
  const lookup =
    side === 'legacy'
      ? `typeof ${entryName} === "function" ? ${entryName} : undefined`
      : `typeof exports === "object" && exports !== null && typeof exports.${entryName} === "function" ? exports.${entryName} : undefined`;
  const bound = evaluate(loaded.context, `${loaded.apiName}("bind", ${lookup})`, remaining());
  if (!bound.ok || bound.value !== true) {
    finish(
      errorText(
        'ENTRY_FUNCTION_NOT_FOUND',
        side === 'legacy'
          ? `The entry function "${entryName}" was not found in the legacy code. Declare it as a top-level function.`
          : `The entry function "${entryName}" was not found in the modern code. Export it with the same name.`,
      ),
    );
  }
  return loaded;
}

/** Hands a function of one context to the Driver_Context. Both belong to contexts, not to this realm. */
function shareFunction(target: Context, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: false, enumerable: false, configurable: false });
}

async function runProperty(legacy: LoadedSide, modern: LoadedSide): Promise<string> {
  const driver = createContext();
  const names = { api: randomName(), legacy: randomName(), modern: randomName(), test: randomName() };
  shareFunction(driver, names.legacy, vm.runInContext(legacy.apiName, legacy.context));
  shareFunction(driver, names.modern, vm.runInContext(modern.apiName, modern.context));

  runTrusted(driver, [__LZ_PRELUDE__, __LZ_CODEC__, __LZ_FAST_CHECK__, __LZ_DRIVER__], {
    apiName: names.api,
    legacyName: names.legacy,
    modernName: names.modern,
    testName: names.test,
    numRuns: number('numRuns'),
    seed: number('seed'),
    allowDynamicCode,
    maxValueBytes,
  });

  // The Test_Code is compiled as a function body with the vm API. That is not string evaluation, so
  // it works with dynamic code generation disabled, and the body cannot close the function early.
  const parameters = ['fc', 'legacyFn', 'modernFn', 'assertEquivalent', 'numRuns'];
  // Parsed once as a script in this realm, only to get the engine's message for a syntax error.
  const syntax = syntaxDetail(`(function (${parameters.join(', ')}) {\n${text('testCode')}\n})`, 'test-code.js');
  if (syntax !== null) return errorText('TEST_CODE_ERROR', `The test code does not compile: ${syntax}`);
  let build: unknown;
  try {
    build = vm.compileFunction(text('testCode'), parameters, { parsingContext: driver, filename: 'test-code.js' });
  } catch {
    return errorText('TEST_CODE_ERROR', 'The test code does not compile: it is not the body of one function.');
  }
  shareFunction(driver, names.test, build);

  const run = evaluate(driver, `${names.api}("run")`, remaining());
  await checkDynamicImport('legacy, modern, or test');
  if (!run.ok) {
    // Only a timeout or a failure of the harness itself ends up here: the driver catches what the
    // Test_Code and the Entry_Functions throw.
    const progress = ask(driver, `${names.api}("progress")`, PROGRESS_TIMEOUT_MS);
    let side = 'unknown';
    let failed: unknown;
    try {
      const parsed = JSON.parse(progress ?? '{}') as { side?: unknown; failed?: unknown };
      if (parsed.side === 'legacy' || parsed.side === 'modern' || parsed.side === 'test') side = parsed.side;
      failed = parsed.failed;
    } catch {
      // The marker only labels the message.
    }
    if (run.kind !== 'timeout') return errorText('SANDBOX_CRASH', 'The sandbox driver could not finish the run.');
    // A difference was already recorded: the check was shrinking, so report the smallest one seen.
    if (typeof failed === 'object' && failed !== null) return JSON.stringify(failed);
    return errorText('SANDBOX_TIMEOUT', `The run did not finish within the time limit (side: ${side}).`);
  }
  return ask(driver, `${names.api}("collect")`, Math.min(remaining(), DESCRIBE_TIMEOUT_MS)) ?? errorText('SANDBOX_CRASH', 'The sandbox driver returned no result.');
}

async function runCases(legacy: LoadedSide, modern: LoadedSide): Promise<string> {
  const inputs = JSON.parse(text('inputs')) as string[];
  const caseTimeoutMs = number('caseTimeoutMs');
  const cases: unknown[] = [];

  const outcomeOf = (side: LoadedSide, label: Side, input: string, index: number): string => {
    // Each side of each case runs in its own vm call (Requirement 10, criterion 4).
    const result = evaluate(side.context, `${side.apiName}("call", ${literal(input)})`, Math.min(caseTimeoutMs, remaining()));
    if (!result.ok || typeof result.value !== 'string') {
      const timedOut = !result.ok && result.kind === 'timeout';
      return finish(
        timedOut
          ? errorText('SANDBOX_TIMEOUT', `Case ${index} did not finish within the case time limit (side: ${label}).`)
          : errorText('SANDBOX_CRASH', `Case ${index} could not be run (side: ${label}).`),
      );
    }
    return result.value;
  };

  const render = (side: LoadedSide, outcome: string, index: number): unknown => {
    const parsed = JSON.parse(outcome) as { k?: unknown; n?: unknown; c?: unknown; m?: unknown };
    if (parsed.k === 't' && typeof parsed.n === 'string') return { k: 't', n: parsed.n };
    if (parsed.k === 'x') {
      return finish(errorText(typeof parsed.c === 'string' ? parsed.c : 'SANDBOX_CRASH', `Case ${index}: ${typeof parsed.m === 'string' ? parsed.m : 'unknown failure'}`));
    }
    // {"k":"r","v":<value text>}: the value text starts at offset 13 and ends before the last brace.
    const valueText = outcome.slice(13, -1);
    const rendered = ask(side.context, `${side.apiName}("render", ${literal(valueText)})`, Math.min(caseTimeoutMs, remaining()));
    return { k: 'r', r: (rendered ?? '[value that cannot be printed]').slice(0, 200) };
  };

  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index]!;
    const legacyOutcome = outcomeOf(legacy, 'legacy', input, index);
    const modernOutcome = outcomeOf(modern, 'modern', input, index);
    cases.push({
      e: legacyOutcome === modernOutcome,
      l: render(legacy, legacyOutcome, index),
      m: render(modern, modernOutcome, index),
    });
  }
  await checkDynamicImport('legacy or modern');
  checkForbidden(legacy, 'legacy');
  checkForbidden(modern, 'modern');
  return JSON.stringify({ t: 'cases', cases });
}

async function main(): Promise<string> {
  const legacy = await loadSide('legacy', text('legacyCode'));
  const modern = await loadSide('modern', text('modernJs'));
  return data.mode === 'cases' ? runCases(legacy, modern) : runProperty(legacy, modern);
}

let result: string;
try {
  result = await main();
} catch (thrown) {
  result = thrown instanceof Done ? thrown.result : errorText('SANDBOX_CRASH', 'The sandbox bootstrap could not finish the run.');
}
if (Buffer.byteLength(result, 'utf8') > maxResultBytes) {
  result = errorText('OUTPUT_LIMIT_EXCEEDED', 'The result is larger than the limit "maxResultBytes".');
}
parentPort?.postMessage(result);

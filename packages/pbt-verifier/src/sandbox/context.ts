import { Script, compileFunction, createContext, runInContext, type Context } from 'node:vm';
import { createCloner } from './cloner.js';

/**
 * Outcome of one call into a sandbox. `returned.value` was created by the sandbox realm.
 * `threw.name` follows Requirement 6, criterion 2.
 */
export type CallResult =
  | { kind: 'returned'; value: unknown }
  | { kind: 'threw'; name: string }
  | { kind: 'timeout' };

export type SandboxFunction = (input: unknown) => unknown;

export interface Sandbox {
  readonly context: Context;
  /**
   * Runs `source` as a classic script and returns its completion value. A syntax error or a throw
   * from the script propagates to the caller; so does the timeout error of `node:vm`.
   */
  evaluate(source: string, filename: string, timeoutMs: number): unknown;
  /** Calls `fn(input)` inside the sandbox. `input` must already belong to the sandbox realm. */
  invoke(fn: SandboxFunction, input: unknown, timeoutMs: number): CallResult;
  /** Deep-copies a host or foreign-realm value into the sandbox realm. */
  cloneInto(value: unknown): unknown;
  /**
   * Compiles `body` as the body of a function with the given parameters, in the sandbox realm. The text
   * cannot close the function early: `import`, `export`, and unbalanced braces are syntax errors.
   * Calling the returned function is not time-bounded.
   */
  compile(body: string, parameters: string[], filename: string): (...args: unknown[]) => unknown;
}

const TIMEOUT_CODE = 'ERR_SCRIPT_EXECUTION_TIMEOUT';
const FN_SLOT = '__lazarus_fn__';
const INPUT_SLOT = '__lazarus_in__';
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * The call wrapper. The try/catch lives inside the context on purpose: the `node:vm` timeout
 * terminates execution and cannot be caught by user code, so the only exception that reaches the host
 * from this script is a real timeout. A user script that throws an object imitating the timeout error
 * is caught here and reported as `threw`.
 */
const INVOKE_SCRIPT = new Script(
  `(function () {
  var fn = ${FN_SLOT}, input = ${INPUT_SLOT};
  try {
    return { k: 0, v: fn(input) };
  } catch (e) {
    var name = 'non-error';
    try {
      if (typeof e === 'object' && e !== null) {
        var candidate = e.name;
        if (typeof candidate === 'string') name = candidate;
      }
    } catch (ignored) {}
    return { k: 1, v: name };
  }
})()`,
  { filename: 'lazarus-invoke.js' },
);

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === TIMEOUT_CODE
  );
}

/**
 * Creates a fresh context that holds only the ECMAScript built-ins. V8 also installs `console` and
 * `WebAssembly` in every new context; neither is an ECMAScript built-in, so both are deleted here
 * (Requirement 3, criterion 5). `extraGlobals` are the only additional bindings.
 */
export function createSandbox(extraGlobals: Record<string, unknown> = {}): Sandbox {
  const base: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  Object.assign(base, extraGlobals);
  const context = createContext(base);
  runInContext('delete globalThis.console; delete globalThis.WebAssembly;', context);
  const cloneInto = createCloner(context);

  return {
    context,
    evaluate(source, filename, timeoutMs) {
      const script = new Script(source, { filename });
      return script.runInContext(context, { timeout: timeoutMs }) as unknown;
    },
    invoke(fn, input, timeoutMs) {
      base[FN_SLOT] = fn;
      base[INPUT_SLOT] = input;
      try {
        const result = INVOKE_SCRIPT.runInContext(context, { timeout: timeoutMs }) as {
          k: number;
          v: unknown;
        };
        return result.k === 0
          ? { kind: 'returned', value: result.v }
          : { kind: 'threw', name: result.v as string };
      } catch (error) {
        if (isTimeoutError(error)) return { kind: 'timeout' };
        throw error;
      } finally {
        delete base[FN_SLOT];
        delete base[INPUT_SLOT];
      }
    },
    cloneInto,
    compile(body, parameters, filename) {
      return compileFunction(body, parameters, { parsingContext: context, filename }) as (
        ...args: unknown[]
      ) => unknown;
    },
  };
}

/**
 * Creates a reader for the Entry_Function. Call it BEFORE the user code runs: the reader keeps its own
 * references to `Object.prototype.hasOwnProperty` and to the scope object, so later changes made by the
 * user code to built-ins cannot change what it finds. It reports a function only when it is an OWN
 * property of the scope, so inherited names such as `constructor` or `toString` are never taken for the
 * Entry_Function.
 *
 * `scope` is `globalThis` for a classic legacy script and `exports` for transpiled modern code (the
 * caller must have defined `exports` in the sandbox first).
 */
export function createEntryReader(
  sandbox: Sandbox,
  scope: 'globalThis' | 'exports',
  timeoutMs: number,
): (name: string, timeoutMs: number) => SandboxFunction | undefined {
  const reader = sandbox.evaluate(
    `(function () {
  var has = Object.prototype.hasOwnProperty;
  var scope = ${scope};
  return function (name) {
    return has.call(scope, name) && typeof scope[name] === 'function' ? scope[name] : undefined;
  };
})()`,
    'entry-reader.js',
    timeoutMs,
  ) as SandboxFunction;
  return (name, callTimeoutMs) => {
    const result = sandbox.invoke(reader, name, callTimeoutMs);
    return result.kind === 'returned' && typeof result.value === 'function'
      ? (result.value as SandboxFunction)
      : undefined;
  };
}

/**
 * Renders a thrown value as `Name: message` for error results. Never throws, even for hostile objects,
 * and never includes a stack trace.
 */
export function describeThrown(value: unknown): string {
  let text: string;
  try {
    if (typeof value === 'object' && value !== null) {
      const { name, message } = value as { name?: unknown; message?: unknown };
      const label = typeof name === 'string' && name.length > 0 ? name : 'Error';
      text = typeof message === 'string' && message.length > 0 ? `${label}: ${message}` : label;
    } else {
      text = `Non-error value thrown: ${String(value)}`;
    }
  } catch {
    text = 'A value that cannot be described was thrown.';
  }
  return text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH)}...` : text;
}

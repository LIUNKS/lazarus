import { describe, expect, it } from 'vitest';
import type { LoadResult, LoadedSide } from '../src/sandbox/load-result.ts';
import { loadLegacy } from '../src/sandbox/legacy-loader.ts';
import { loadModern } from '../src/sandbox/modern-loader.ts';

const TIMEOUT_MS = 1000;

function loaded(result: LoadResult): LoadedSide {
  if (!result.ok) throw new Error(`Expected a successful load, got ${result.code}: ${result.message}`);
  return result.value;
}

function failed(result: LoadResult): { code: string; message: string } {
  if (result.ok) throw new Error('Expected the load to fail.');
  return { code: result.code, message: result.message };
}

function call(side: LoadedSide, input: unknown): ReturnType<LoadedSide['sandbox']['invoke']> {
  return side.sandbox.invoke(side.fn, side.sandbox.cloneInto(input), TIMEOUT_MS);
}

describe('loadLegacy', () => {
  it('R4.1 loads an ES3 function declaration unmodified and calls it', () => {
    const side = loaded(loadLegacy('function add(x) { return x + 1; }', 'add', TIMEOUT_MS));
    expect(call(side, 41)).toEqual({ kind: 'returned', value: 42 });
  });

  it('R4.3 R12.5 reports a syntax error as LEGACY_LOAD_ERROR with the error name and message', () => {
    const result = failed(loadLegacy('function add(x { return x; }', 'add', TIMEOUT_MS));
    expect(result.code).toBe('LEGACY_LOAD_ERROR');
    expect(result.message).toMatch(/^SyntaxError: /);
  });

  it('R4.3 R12.5 reports a top-level throw as LEGACY_LOAD_ERROR with the error name and message', () => {
    const result = failed(
      loadLegacy('throw new RangeError("exploded at load"); function f() {}', 'f', TIMEOUT_MS),
    );
    expect(result.code).toBe('LEGACY_LOAD_ERROR');
    expect(result.message).toBe('RangeError: exploded at load');
  });

  it('R4.3 R7.9 bounds a top-level infinite loop with the timeout', () => {
    const result = failed(loadLegacy('while (true) {}', 'f', 30));
    expect(result.code).toBe('LEGACY_LOAD_ERROR');
    expect(result.message).toMatch(/timed out/);
  });

  it('R4.5 R12.5 reports ENTRY_FUNCTION_NOT_FOUND and says the legacy code is the side that lacks it', () => {
    const result = failed(loadLegacy('function other() {}', 'add', TIMEOUT_MS));
    expect(result.code).toBe('ENTRY_FUNCTION_NOT_FOUND');
    expect(result.message).toContain('"add"');
    expect(result.message).toContain('legacy');
    expect(result.message).not.toContain('modern');
  });

  it('R4.5 reports ENTRY_FUNCTION_NOT_FOUND when the binding is not a function', () => {
    const result = failed(loadLegacy('var add = 5;', 'add', TIMEOUT_MS));
    expect(result.code).toBe('ENTRY_FUNCTION_NOT_FOUND');
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', 'valueOf'])(
    'R4.5 does not take the inherited name "%s" for an entry function',
    (name) => {
      const result = failed(loadLegacy('function other() {}', name, TIMEOUT_MS));
      expect(result.code).toBe('ENTRY_FUNCTION_NOT_FOUND');
    },
  );

  it('R4.5 does not see a top-level let or const as a global binding (documented in the README)', () => {
    for (const declaration of ['let', 'const']) {
      const result = failed(
        loadLegacy(`${declaration} add = function (x) { return x; };`, 'add', TIMEOUT_MS),
      );
      expect(result.code, declaration).toBe('ENTRY_FUNCTION_NOT_FOUND');
    }
  });

  it('R4.5 finds a function assigned to a var, which is also a global binding', () => {
    const side = loaded(loadLegacy('var twice = function (x) { return x * 2; };', 'twice', TIMEOUT_MS));
    expect(call(side, 4)).toEqual({ kind: 'returned', value: 8 });
  });

  it('R4.6 evaluates the source once, however many times the function is called', () => {
    const side = loaded(
      loadLegacy(
        'var loads = (typeof loads === "undefined" ? 0 : loads) + 1; function count() { return loads; }',
        'count',
        TIMEOUT_MS,
      ),
    );
    for (let index = 0; index < 5; index++) call(side, undefined);
    expect(call(side, undefined)).toEqual({ kind: 'returned', value: 1 });
  });

  it('R4.2 R12.5 legacy code that needs $, jQuery, window, document, global, module, exports, or require fails at load', () => {
    for (const name of ['$', 'jQuery', 'window', 'document', 'global', 'module', 'exports', 'require']) {
      const result = failed(loadLegacy(`var dependency = ${name}; function f() {}`, 'f', TIMEOUT_MS));
      expect(result.code, name).toBe('LEGACY_LOAD_ERROR');
      expect(result.message, name).toMatch(/^ReferenceError: /);
    }
  });

  it('R4.2 R12.5 legacy code that needs them inside the function fails visibly when it is called', () => {
    for (const name of ['$', 'jQuery', 'window', 'document', 'global', 'module', 'exports', 'require']) {
      const side = loaded(loadLegacy(`function f() { return ${name}; }`, 'f', TIMEOUT_MS));
      expect(call(side, undefined), name).toEqual({ kind: 'threw', name: 'ReferenceError' });
    }
  });

  it('R3.5 R12.8 require, process, fetch, and console are unreachable from legacy code', () => {
    const side = loaded(
      loadLegacy(
        'function probe() { return [typeof require, typeof process, typeof fetch, typeof console].join(); }',
        'probe',
        TIMEOUT_MS,
      ),
    );
    expect(call(side, undefined)).toEqual({
      kind: 'returned',
      value: 'undefined,undefined,undefined,undefined',
    });
  });

  it('R4.1 legacy ES3 code with eval and a prototype assignment still loads (curses are not blocked)', () => {
    const side = loaded(
      loadLegacy(
        'Array.prototype.last = function () { return this[this.length - 1]; };' +
          'function evaluate(x) { return eval("x + 1"); }',
        'evaluate',
        TIMEOUT_MS,
      ),
    );
    expect(call(side, 1)).toEqual({ kind: 'returned', value: 2 });
  });
});

describe('loadModern', () => {
  it('R5.3 R5.4 type-checks, transpiles, and loads an exported function', () => {
    const side = loaded(
      loadModern(
        'export function add(x: number): number { return x + 1; }',
        'add',
        TIMEOUT_MS,
      ),
    );
    expect(call(side, 41)).toEqual({ kind: 'returned', value: 42 });
  });

  it('R5.1 accepts ES2022 library features (Map, Set, Math, spread, optional chaining)', () => {
    const side = loaded(
      loadModern(
        `export function f(a: number[]): number {
          const seen = new Set<number>(a);
          const lookup = new Map<string, { n: number }>([['k', { n: seen.size }]]);
          return Math.max(...a) + (lookup.get('k')?.n ?? 0);
        }`,
        'f',
        TIMEOUT_MS,
      ),
    );
    expect(call(side, [1, 2, 2, 5])).toEqual({ kind: 'returned', value: 8 });
  });

  it('R5.2 R12.5 reports a type error as MODERN_COMPILE_ERROR with line, column, and TypeScript code', () => {
    const result = failed(
      loadModern(
        'export function add(x: number): number {\n  return x.missing;\n}',
        'add',
        TIMEOUT_MS,
      ),
    );
    expect(result.code).toBe('MODERN_COMPILE_ERROR');
    expect(result.message).toMatch(/\b2:12 TS2339 Property 'missing' does not exist on type 'number'/);
  });

  it('R5.1 checks under strict: an implicit any is a compile error', () => {
    const result = failed(loadModern('export function add(x) { return x; }', 'add', TIMEOUT_MS));
    expect(result.code).toBe('MODERN_COMPILE_ERROR');
    expect(result.message).toMatch(/TS7006/);
  });

  it('R5.1 offers no DOM and no Node.js declarations', () => {
    for (const body of ['console.log(1)', 'document.title', 'process.exit(0)', 'setTimeout(() => 1, 1)']) {
      const result = failed(
        loadModern(`export function f(): void { ${body}; }`, 'f', TIMEOUT_MS),
      );
      expect(result.code, body).toBe('MODERN_COMPILE_ERROR');
      expect(result.message, body).toMatch(/TS2\d\d\d/);
    }
  });

  it('R5.2 reports a syntax error as MODERN_COMPILE_ERROR', () => {
    const result = failed(loadModern('export function f( {', 'f', TIMEOUT_MS));
    expect(result.code).toBe('MODERN_COMPILE_ERROR');
    expect(result.message).toMatch(/\d+:\d+ TS1005/);
  });

  it('R5.2 lists at most the first 10 diagnostics', () => {
    const lines = Array.from({ length: 15 }, (_unused, index) => `export const v${index}: number = 'text';`);
    const result = failed(loadModern(lines.join('\n'), 'v0', TIMEOUT_MS));
    expect(result.code).toBe('MODERN_COMPILE_ERROR');
    const entries = result.message.split('\n').filter((line) => /^\d+:\d+ TS\d+ /.test(line));
    expect(entries).toHaveLength(10);
    expect(result.message).toContain('15 type errors');
  });

  it.each([
    ['a static import', "import { x } from 'other'; export function f(): number { return x; }"],
    ['a default import', "import x from 'other'; export const f = (): number => x;"],
    ['a side-effect import', "import 'other'; export function f(): number { return 1; }"],
    ['an import-equals require', "import fs = require('fs'); export function f(): number { return 1; }"],
    ['a re-export', "export * from 'other'; export function f(): number { return 1; }"],
    ['a named re-export', "export { x } from 'other'; export function f(): number { return 1; }"],
    ['a dynamic import()', "export async function f(): Promise<unknown> { return import('other'); }"],
    ['a nested dynamic import()', "export function f(): void { void (() => import('other')); }"],
    ['an import type', "export function f(x: import('other').T): void { void x; }"],
  ])('R5.7 R12.5 rejects %s with a message that says imports are not supported', (_label, code) => {
    const result = failed(loadModern(code, 'f', TIMEOUT_MS));
    expect(result.code).toBe('MODERN_COMPILE_ERROR');
    expect(result.message).toMatch(/Imports are not supported/);
    expect(result.message).toMatch(/\d+:\d+/);
  });

  it('R5.7 does not mistake the word "import" in a string or a comment for an import', () => {
    const side = loaded(
      loadModern(
        "// import x from 'y'\nexport function f(): string { return \"import('z')\"; }",
        'f',
        TIMEOUT_MS,
      ),
    );
    expect(call(side, undefined)).toEqual({ kind: 'returned', value: "import('z')" });
  });

  it('R5.5 R12.5 reports a top-level throw as MODERN_LOAD_ERROR with the error name and message', () => {
    const result = failed(
      loadModern(
        "const failure: unknown = new RangeError('exploded at load');\nif (failure) throw failure;\nexport function f(): number { return 1; }",
        'f',
        TIMEOUT_MS,
      ),
    );
    expect(result.code).toBe('MODERN_LOAD_ERROR');
    expect(result.message).toBe('RangeError: exploded at load');
  });

  it('R5.5 R7.9 bounds a top-level infinite loop with the timeout', () => {
    const result = failed(
      loadModern('for (;;) {}\nexport function f(): number { return 1; }', 'f', 30),
    );
    expect(result.code).toBe('MODERN_LOAD_ERROR');
    expect(result.message).toMatch(/timed out/);
  });

  it('R5.6 R12.5 reports ENTRY_FUNCTION_NOT_FOUND and says the modern code is the side that lacks it', () => {
    const result = failed(loadModern('export function other(): number { return 1; }', 'add', TIMEOUT_MS));
    expect(result.code).toBe('ENTRY_FUNCTION_NOT_FOUND');
    expect(result.message).toContain('"add"');
    expect(result.message).toContain('modern');
    expect(result.message).not.toContain('legacy');
  });

  it('R5.6 reports ENTRY_FUNCTION_NOT_FOUND when the export is not a function or is not exported', () => {
    expect(failed(loadModern('export const add = 5;', 'add', TIMEOUT_MS)).code).toBe(
      'ENTRY_FUNCTION_NOT_FOUND',
    );
    expect(failed(loadModern('function add(): number { return 1; }', 'add', TIMEOUT_MS)).code).toBe(
      'ENTRY_FUNCTION_NOT_FOUND',
    );
  });

  it.each(['toString', 'constructor', 'hasOwnProperty'])(
    'R5.6 does not take the inherited name "%s" for an entry function',
    (name) => {
      const result = failed(
        loadModern('export function other(): number { return 1; }', name, TIMEOUT_MS),
      );
      expect(result.code).toBe('ENTRY_FUNCTION_NOT_FOUND');
    },
  );

  it('R5.3 loads modern code in a context separate from the legacy context', () => {
    const legacy = loaded(loadLegacy('var leaked = 1; function f() { return 1; }', 'f', TIMEOUT_MS));
    const modern = loaded(
      loadModern(
        "export function f(): string { return typeof (globalThis as unknown as Record<string, unknown>)['leaked']; }",
        'f',
        TIMEOUT_MS,
      ),
    );
    expect(call(legacy, undefined)).toEqual({ kind: 'returned', value: 1 });
    expect(call(modern, undefined)).toEqual({ kind: 'returned', value: 'undefined' });
    expect(legacy.sandbox.context).not.toBe(modern.sandbox.context);
  });

  it('R3.5 R12.8 require, process, fetch, and console are unreachable from modern code', () => {
    const side = loaded(
      loadModern(
        `export function probe(): string {
          const scope = globalThis as unknown as Record<string, unknown>;
          return ['require', 'process', 'fetch', 'console', 'module'].map((name) => typeof scope[name]).join();
        }`,
        'probe',
        TIMEOUT_MS,
      ),
    );
    expect(call(side, undefined)).toEqual({
      kind: 'returned',
      value: 'undefined,undefined,undefined,undefined,undefined',
    });
  });

  it('R3.5 the exports object belongs to the sandbox and cannot be used to reach the host', () => {
    const side = loaded(
      loadModern(
        `type Reach = { constructor: { constructor: (code: string) => () => string } };
        export function probe(): string {
          const scope = globalThis as unknown as { exports: Reach };
          return scope.exports.constructor.constructor('return typeof process')();
        }`,
        'probe',
        TIMEOUT_MS,
      ),
    );
    expect(call(side, undefined)).toEqual({ kind: 'returned', value: 'undefined' });
  });
});

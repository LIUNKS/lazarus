import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runSandboxedCases } from '../src/cases-mode.ts';
import { SMALL } from './support/samples.ts';

const DENIED_NAMES = [
  'process', 'require', 'module', 'global', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Buffer', 'console',
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
];
const MODERN = 'export function probe(name: unknown): unknown { return name; }';

/** Runs `body` as the legacy `probe(name)` for each input and returns what the legacy side showed. */
async function probe(body: string, inputs: unknown[], allowDynamicCode = false) {
  const result = await runSandboxedCases({
    legacyCode: `function probe(name) { ${body} }`,
    modernCode: MODERN,
    entryFunction: 'probe',
    inputs,
    allowDynamicCode,
    limits: SMALL,
  });
  if (result.status !== 'COMPLETED') return { error: result };
  return { shown: result.cases.map((entry) => (entry.legacy.kind === 'returned' ? entry.legacy.rendered : `threw ${entry.legacy.name}`)) };
}

describe('context globals', () => {
  for (const allowDynamicCode of [false, true]) {
    it(`R6.1 no Denied_Name, SharedArrayBuffer, or Atomics is defined (allowDynamicCode: ${allowDynamicCode})`, async () => {
      const names = [...DENIED_NAMES, 'SharedArrayBuffer', 'Atomics'];
      // A free identifier and a property of the global object can differ, so both are checked.
      const table = names.map((name) => `${name}: typeof ${name}`).join(', ');
      const result = await probe(`var direct = { ${table} }; return direct[name] + '|' + typeof globalThis[name];`, names, allowDynamicCode);
      expect(result.shown).toEqual(names.map(() => '"undefined|undefined"'));
    });
  }

  it('R4.5 the global object is an ordinary object of the context', async () => {
    const result = await probe(
      "return [globalThis instanceof Object, typeof globalThis, globalThis === this, typeof exports].join(',');",
      [0],
    );
    expect(result.shown).toEqual(['"true,object,true,undefined"']);
  });

  it('R4.6 no value reachable from the globals has a prototype of another realm', async () => {
    // An object or function of the Worker realm would not inherit from this context's Object.prototype.
    const body = `
      var foreign = [];
      var names = Object.getOwnPropertyNames(globalThis);
      for (var i = 0; i < names.length; i++) {
        var value = globalThis[names[i]];
        var isObject = (typeof value === 'object' && value !== null) || typeof value === 'function';
        if (isObject && Object.getPrototypeOf(value) !== null && !(value instanceof Object)) foreign.push(names[i]);
      }
      return foreign.length + ' foreign of ' + (names.length > 40 ? 'many' : 'few');`;
    expect((await probe(body, [0])).shown).toEqual(['"0 foreign of many"']);
  });

  it('R4.8 Error.prepareStackTrace is locked and a stack stays a string', async () => {
    const body = `
      Error.prepareStackTrace = function () { return { hacked: true }; };
      var redefined = 'no error';
      try { Object.defineProperty(Error, 'prepareStackTrace', { value: function () {} }); } catch (error) { redefined = error.name; }
      var d = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
      return [d.writable, d.configurable, typeof d.value, redefined, typeof new Error('x').stack].join(',');`;
    expect((await probe(body, [0])).shown).toEqual(['"false,false,undefined,TypeError,string"']);
  });

  it('R4.8 a call-site attack obtains no function and no receiver of the bootstrap', async () => {
    const body = `
      var seen = 'none';
      try {
        Error.prepareStackTrace = function (error, frames) { seen = frames.map(function (f) { return typeof f.getFunction() + '/' + typeof f.getThis(); }).join(';'); return ''; };
        var holder = {};
        Error.captureStackTrace(holder);
        String(holder.stack);
      } catch (ignored) {}
      return seen;`;
    expect((await probe(body, [0])).shown).toEqual(['"none"']);
  });

  it('R6.2 eval and Function are denied by default and work when allowDynamicCode is true', async () => {
    const body = "return name === 'eval' ? eval('1 + 1') : new Function('return 3')();";
    const denied = await probe(body, ['eval']);
    expect(denied.error).toMatchObject({ status: 'ERROR', code: 'SANDBOX_FORBIDDEN_CAPABILITY' });
    expect(denied.error?.message).toContain('legacy');
    expect((await probe(body, ['Function'])).error).toMatchObject({ code: 'SANDBOX_FORBIDDEN_CAPABILITY' });
    expect((await probe(body, ['eval', 'Function'], true)).shown).toEqual(['2', '3']);
  });

  for (const allowDynamicCode of [false, true]) {
    it(`R6.3 WebAssembly compilation and import() are denied (allowDynamicCode: ${allowDynamicCode})`, async () => {
      const wasm = await probe('return new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));', [0], allowDynamicCode);
      expect(wasm.error).toMatchObject({ code: 'SANDBOX_FORBIDDEN_CAPABILITY' });
      expect(wasm.error?.message).toContain('WebAssembly');
      const dynamicImport = await probe("import('node:fs'); return 1;", [0], allowDynamicCode);
      expect(dynamicImport.error).toMatchObject({ code: 'SANDBOX_FORBIDDEN_CAPABILITY' });
      expect(dynamicImport.error?.message).toContain('import()');
    });
  }
});

describe('source scans', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const walk = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const sources = walk(join(root, 'src'));

  it('R4.4 the Exec_Worker entry is an ES module that imports only node:vm and node:worker_threads', () => {
    const entry = readFileSync(join(root, 'src', 'worker', 'exec-entry.ts'), 'utf8');
    const imports = [...entry.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    expect(imports.sort()).toEqual(['node:vm', 'node:worker_threads']);
    // A call with a module name. The text "import()" in a message or a comment is not one.
    expect(entry).not.toMatch(/\brequire\(|\bimport\(\s*['"`]/);
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).type).toBe('module');

    const built = readFileSync(join(root, 'dist', 'worker', 'exec-entry.js'), 'utf8');
    const builtImports = [...built.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    expect([...new Set(builtImports)].sort()).toEqual(['node:vm', 'node:worker_threads']);
  });

  it('R1.7 the code that runs inside an Exec_Worker imports no file, network, or process module', () => {
    const inWorker = [join(root, 'src', 'worker', 'exec-entry.ts'), ...walk(join(root, 'src', 'worker', 'scripts'))];
    expect(inWorker.length).toBe(5);
    for (const file of inWorker) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/node:(fs|net|http|https|child_process)|['"](fs|net|http|https|child_process)['"]/);
    }
  });

  it('R1.7 the package reads no environment variable and writes nothing to the console', () => {
    for (const file of sources) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/process\.env/);
      expect(code, file).not.toMatch(/\bconsole\s*\.\s*\w+\s*\(/);
      expect(code, file).not.toMatch(/process\.(stdout|stderr)\.write/);
    }
  });

  it('R1.4 the sources contain no explicit any', () => {
    for (const file of sources.filter((path) => path.endsWith('.ts'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    }
  });
});

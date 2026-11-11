// Bundles the Exec_Worker entry into dist/worker/exec-entry.js. The Trusted_Scripts and a bundled
// copy of fast-check are embedded as text constants, so the Worker reads no file at run time.
// The Compile_Worker entry is emitted by tsc and needs no bundling: it loads the Verifier and the
// TypeScript compiler from node_modules, where the compiler finds its library files.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const trusted = (name) => readFileSync(new URL(`../src/worker/scripts/${name}.js`, import.meta.url), 'utf8');

const fastCheck = await build({
  stdin: { contents: "export * from 'fast-check';", resolveDir: root },
  bundle: true,
  format: 'iife',
  globalName: '__lz_fast_check',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  write: false,
  logLevel: 'error',
});

// fast-check reads the free names setTimeout and clearTimeout when it loads. They are declared here
// as locals of the wrapper, so the context itself still defines no timer.
const fastCheckFragment = [
  'var fc = (function () {',
  "  var setTimeout = function () { throw new Error('Timers are not available in the sandbox.'); };",
  '  var clearTimeout = function () {};',
  fastCheck.outputFiles[0].text,
  '  return __lz_fast_check;',
  '})();',
].join('\n');

await build({
  entryPoints: [fileURLToPath(new URL('../src/worker/exec-entry.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/worker/exec-entry.js', import.meta.url)),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  allowOverwrite: true,
  logLevel: 'error',
  define: {
    __LZ_PRELUDE__: JSON.stringify(trusted('prelude')),
    __LZ_CODEC__: JSON.stringify(trusted('codec')),
    __LZ_SIDE__: JSON.stringify(trusted('side')),
    __LZ_DRIVER__: JSON.stringify(trusted('driver')),
    __LZ_FAST_CHECK__: JSON.stringify(fastCheckFragment),
  },
});

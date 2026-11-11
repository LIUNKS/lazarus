// Compile_Worker entry. It type-checks and transpiles Modern_Code with the Verifier's compile step.
// It runs only the TypeScript compiler on text and never executes the code it is given.
import { parentPort, workerData } from 'node:worker_threads';
import { compileModernCode } from '@lazarus/pbt-verifier/shared';

const data = workerData as Record<string, string | number | boolean>;

let result: string;
try {
  const compiled = compileModernCode(String(data.modernCode), String(data.entryFunction));
  result = JSON.stringify(
    compiled.ok ? { ok: true, js: compiled.js } : { ok: false, code: compiled.code, message: compiled.message },
  );
} catch {
  result = JSON.stringify({ ok: false, code: 'MODERN_COMPILE_ERROR', message: 'The modern code could not be compiled.' });
}
parentPort?.postMessage(result);

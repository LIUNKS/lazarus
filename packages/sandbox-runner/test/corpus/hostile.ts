// Adversarial corpus (Requirement 12, criterion 2). Each entry is hostile code in one role (legacy,
// modern, or test) with the results it may end in, for `allowDynamicCode` off and on.
//
// WHAT THIS CORPUS DOES NOT COVER. A passing run shows that the attacks listed here fail on the
// Node.js version and the operating system the tests ran on. It does not show that no escape exists.
// Not covered:
// - engine-level vulnerabilities in V8 or Node.js, including escapes that depend on one patch version;
// - native addons loaded by the hosting process;
// - WebAssembly-based attacks (compilation is disabled and checked, but nothing is fuzzed);
// - side channels (timing, CPU contention, cache effects);
// - rapid external-memory exhaustion that outpaces the 100 ms polling of the host;
// - behavior under many concurrent Workers;
// - operating systems other than the one the tests ran on;
// - attacks on the build or on the bundled copy of fast-check.
import type { SandboxLimits } from '../../src/types.ts';

export type Role = 'legacy' | 'modern' | 'test';

/** A result code of an ERROR result, or the status of a verdict. */
export type Ending = string;

export interface HostileEntry {
  id: string;
  title: string;
  role: Role;
  legacyCode?: string;
  modernCode?: string;
  testCode?: string;
  limits?: SandboxLimits;
  /** Allowed endings with dynamic code generation disabled, then enabled. */
  expected: { off: Ending[]; on: Ending[] };
}

const both = (...endings: Ending[]): HostileEntry['expected'] => ({ off: endings, on: endings });

const TIMEOUT = both('SANDBOX_TIMEOUT');
const FORBIDDEN = both('SANDBOX_FORBIDDEN_CAPABILITY');
const OUTPUT = both('OUTPUT_LIMIT_EXCEEDED');

/** Enough time for a normal run on a busy host. Entries that must time out use the default limits. */
const ROOMY: SandboxLimits = { wallClockTimeoutMs: 5000, maxOldGenerationSizeMb: 32 };

const modern = (body: string, top = ''): string => `${top}\nexport function f(a: unknown): unknown { ${body} }`;
const legacy = (body: string, top = ''): string => `${top}\nfunction f(a) { ${body} }`;
const property = (predicate: string): string => `return fc.property(fc.integer(), function (n) { ${predicate} });`;

const TAMPER = `
  Object.keys = function () { return ['forged']; };
  JSON.stringify = function () { return '"forged"'; };
  Array.prototype.push = function () { throw new Error('push'); };
  Function.prototype.call = function () { throw new Error('call'); };
  Object.prototype.toJSON = function () { return 'forged'; };
  Array.prototype[Symbol.iterator] = function () { throw new Error('iterator'); };`;

const CALL_SITE = `
  var got;
  try {
    Error.prepareStackTrace = function (error, frames) { got = frames[frames.length - 1].getFunction() || frames[frames.length - 1].getThis(); return ''; };
    String(new Error('x').stack);
    var holder = {};
    Error.captureStackTrace(holder);
    String(holder.stack);
  } catch (ignored) {}
  return typeof got;`;

const denied = (id: string, title: string, expression: string): HostileEntry[] => [
  { id: `${id}/legacy`, title, role: 'legacy', legacyCode: legacy(`return ${expression};`), limits: ROOMY, expected: FORBIDDEN },
  { id: `${id}/test`, title, role: 'test', testCode: property(`${expression}; assertEquivalent(n);`), limits: ROOMY, expected: FORBIDDEN },
];

export const HOSTILE_CORPUS: HostileEntry[] = [
  // H1: an infinite loop at load time.
  { id: 'H1/legacy', title: 'infinite loop at load time', role: 'legacy', legacyCode: legacy('return a;', 'for (;;) {}'), expected: TIMEOUT },
  { id: 'H1/modern', title: 'infinite loop at load time', role: 'modern', modernCode: modern('return a;', 'for (;;) {}'), expected: TIMEOUT },
  // H2: an infinite loop inside the Entry_Function.
  { id: 'H2/legacy', title: 'infinite loop at call time', role: 'legacy', legacyCode: legacy('for (;;) {}'), expected: TIMEOUT },
  { id: 'H2/modern', title: 'infinite loop at call time', role: 'modern', modernCode: modern('for (;;) {}'), expected: TIMEOUT },
  // H3: a loop inside a callback of a built-in.
  { id: 'H3/legacy', title: 'while(true) inside an Array.prototype.map callback', role: 'legacy', legacyCode: legacy('return [1].map(function () { while (true) {} });'), expected: TIMEOUT },
  // H4: a promise callback that loops. At load time the microtask runs before the evaluation ends and
  // is interrupted. Inside the Entry_Function the callback is queued in a context whose queue is never
  // drained again, so it never runs and the verdict is a normal one.
  { id: 'H4/load', title: 'promise-callback infinite loop at load time', role: 'legacy', legacyCode: legacy('return a;', 'Promise.resolve().then(function () { for (;;) {} });'), expected: TIMEOUT },
  { id: 'H4/call', title: 'promise-callback infinite loop queued by the Entry_Function', role: 'legacy', legacyCode: legacy('Promise.resolve().then(function () { for (;;) {} }); return a;'), limits: ROOMY, expected: both('PASSED') },
  { id: 'H4/test', title: 'promise-callback infinite loop in an async property', role: 'test', testCode: 'return fc.asyncProperty(fc.integer(), function (n) { return Promise.resolve().then(function () { for (;;) {} }); });', expected: TIMEOUT },
  // H5: a retained heap allocation loop (the heap limit is 32 MB).
  { id: 'H5/legacy', title: 'heap allocation bomb', role: 'legacy', legacyCode: legacy('for (;;) keep.push(new Array(100000).fill(a));', 'var keep = [];'), limits: { wallClockTimeoutMs: 20_000, maxOldGenerationSizeMb: 32 }, expected: both('SANDBOX_OUT_OF_MEMORY') },
  { id: 'H5/modern', title: 'heap allocation bomb', role: 'modern', modernCode: modern('for (;;) keep.push(new Array(100000).fill(a));', 'const keep: unknown[] = [];'), limits: { wallClockTimeoutMs: 20_000, maxOldGenerationSizeMb: 32 }, expected: both('SANDBOX_OUT_OF_MEMORY') },
  // H6: string doubling. The engine throws RangeError (a difference from the other side), or the heap limit is reached.
  { id: 'H6/legacy', title: 'string-doubling bomb', role: 'legacy', legacyCode: legacy("var s = 'x'; for (;;) s += s;"), limits: ROOMY, expected: both('FAILED', 'SANDBOX_OUT_OF_MEMORY', 'SANDBOX_TIMEOUT') },
  // H7: an ArrayBuffer too large for the engine: a RangeError outcome, or the memory limit.
  { id: 'H7/legacy', title: 'ArrayBuffer of 2^40 bytes', role: 'legacy', legacyCode: legacy('return new ArrayBuffer(Math.pow(2, 40)).byteLength;'), limits: ROOMY, expected: both('FAILED', 'SANDBOX_OUT_OF_MEMORY') },
  // H8: retained 8 MB ArrayBuffers with a 16 MB external limit. Best effort: no claim about peak memory.
  { id: 'H8/legacy', title: 'external-memory allocation loop', role: 'legacy', legacyCode: legacy('for (;;) keep.push(new ArrayBuffer(8 * 1024 * 1024));', 'var keep = [];'), limits: { wallClockTimeoutMs: 3000, maxOldGenerationSizeMb: 32, maxExternalMemoryMb: 16 }, expected: both('SANDBOX_OUT_OF_MEMORY', 'SANDBOX_TIMEOUT') },
  // H9: oversized and hostile return values.
  { id: 'H9/string', title: 'returns a 2 MB string', role: 'legacy', legacyCode: legacy("return new Array(2000001).join('x');"), limits: ROOMY, expected: OUTPUT },
  { id: 'H9/deep', title: 'returns a value nested 10,000 deep', role: 'legacy', legacyCode: legacy('var v = 0; for (var i = 0; i < 10000; i++) v = [v]; return v;'), limits: ROOMY, expected: OUTPUT },
  { id: 'H9/getter', title: 'returns an object with a getter that loops forever', role: 'legacy', legacyCode: legacy('return { get x() { for (;;) {} } };'), expected: TIMEOUT },
  // H10: Denied_Names.
  ...denied('H10/process', 'uses process', 'process.pid'),
  ...denied('H10/require', "uses require('fs')", "require('fs')"),
  ...denied('H10/module', 'uses module', 'module.exports'),
  ...denied('H10/fetch', 'uses fetch', "fetch('http://example.test/')"),
  ...denied('H10/console', 'uses console.log', "console.log('x')"),
  // H11: the classic vm escape. With dynamic code off it is an EvalError. With it on, the built
  // function runs in the context, where `process` does not exist.
  { id: 'H11/legacy', title: "this.constructor.constructor('return process')()", role: 'legacy', legacyCode: legacy("return this.constructor.constructor('return process')();"), limits: ROOMY, expected: FORBIDDEN },
  { id: 'H11/function', title: "Function('return process')() through a function's constructor", role: 'legacy', legacyCode: legacy("return (function () {}).constructor('return process')();"), limits: ROOMY, expected: FORBIDDEN },
  { id: 'H11/test', title: "constructor.constructor('return process')() in the Test_Code", role: 'test', testCode: property("fc.constructor.constructor('return process')(); assertEquivalent(n);"), limits: ROOMY, expected: FORBIDDEN },
  // H12: the global object holds no host object.
  { id: 'H12/legacy', title: 'globalThis.process and the sloppy-mode this', role: 'legacy', legacyCode: legacy('return [typeof globalThis.process, typeof (function () { return this; })().process, typeof this.process];'), modernCode: modern("return ['undefined', 'undefined', 'undefined'];"), limits: ROOMY, expected: both('PASSED') },
  // H13: dynamic import.
  { id: 'H13/legacy', title: "import('node:fs')", role: 'legacy', legacyCode: legacy("import('node:fs'); return a;"), limits: ROOMY, expected: FORBIDDEN },
  { id: 'H13/load', title: "import('node:fs') at load time", role: 'legacy', legacyCode: legacy('return a;', "import('node:child_process');"), limits: ROOMY, expected: FORBIDDEN },
  // H14: eval is a Forbidden_Capability when off and an ordinary call when on.
  { id: 'H14/legacy', title: "eval('1+1')", role: 'legacy', legacyCode: legacy("return eval('1 + 1');"), modernCode: modern('return 2;'), limits: ROOMY, expected: { off: ['SANDBOX_FORBIDDEN_CAPABILITY'], on: ['PASSED'] } },
  // H15: timers do not exist, so no callback can outlive the run.
  { id: 'H15/timeout', title: 'setTimeout with a looping callback', role: 'legacy', legacyCode: legacy('setTimeout(function () { for (;;) {} }, 0); return a;'), limits: ROOMY, expected: FORBIDDEN },
  { id: 'H15/interval', title: 'setInterval with a looping callback', role: 'legacy', legacyCode: legacy('setInterval(function () { for (;;) {} }, 0); return a;'), limits: ROOMY, expected: FORBIDDEN },
  // H16: tampering with intrinsics. The Trusted_Scripts captured what they use before this code ran.
  { id: 'H16/legacy', title: 'overwrites Object, Array, Function, and JSON intrinsics', role: 'legacy', legacyCode: legacy('return { a: [a, 2] };', TAMPER), modernCode: modern('return { a: [a, 2] };'), limits: ROOMY, expected: both('PASSED') },
  { id: 'H16/modern', title: 'overwrites Object, Array, Function, and JSON intrinsics', role: 'modern', legacyCode: legacy('return { a: [a, 2] };'), modernCode: modern('return { a: [a, 2] };', TAMPER.replace("Array.prototype[Symbol.iterator] = function () { throw new Error('iterator'); };", '')), limits: ROOMY, expected: both('PASSED', 'MODERN_COMPILE_ERROR') },
  { id: 'H16/test', title: 'overwrites intrinsics in the context that runs fast-check', role: 'test', testCode: `${TAMPER}\n${property('assertEquivalent(n);')}`, limits: ROOMY, expected: both('PASSED', 'FAILED', 'TEST_CODE_ERROR') },
  // H17: the stack trace API gives no function and no receiver of the bootstrap.
  { id: 'H17/legacy', title: 'Error.prepareStackTrace and Error.captureStackTrace call-site attack', role: 'legacy', legacyCode: legacy(CALL_SITE), modernCode: modern("return 'undefined';"), limits: ROOMY, expected: both('PASSED') },
  // H18: a mutation of the input does not reach the other side.
  { id: 'H18/legacy', title: 'mutates its input', role: 'legacy', legacyCode: legacy('a.push(1); a.length = 0; return 0;'), modernCode: modern('return (a as unknown[]).length === (a as unknown[]).length ? 0 : 1;'), testCode: 'return fc.property(fc.array(fc.integer()), function (a) { assertEquivalent(a); });', limits: ROOMY, expected: both('PASSED') },
  // H19: unbounded recursion is a RangeError on both sides, compared by name.
  { id: 'H19/legacy', title: 'unbounded recursion', role: 'legacy', legacyCode: legacy('return f(a);'), modernCode: modern('return f(a);'), limits: { wallClockTimeoutMs: 30_000, maxOldGenerationSizeMb: 32 }, expected: both('PASSED') },
  // H20: catastrophic backtracking.
  { id: 'H20/legacy', title: 'catastrophic regular expression', role: 'legacy', legacyCode: legacy("return /(a+)+$/.test(new Array(41).join('a') + '!');"), expected: TIMEOUT },
  // H21: the Test_Code itself hangs.
  { id: 'H21/test', title: 'Test_Code with an infinite loop at the top level', role: 'test', testCode: 'for (;;) {}', expected: TIMEOUT },
  // H22: verdict forging. Hostile Test_Code shares a context with fast-check, so it can make its own
  // run pass. This is the documented limit on verdict integrity; the host is not affected.
  { id: 'H22/check', title: 'Test_Code that replaces fc.check', role: 'test', modernCode: modern('return 0;'), testCode: 'fc.check = function () { return { failed: false, numRuns: numRuns }; }; return fc.property(fc.integer(), function (n) { assertEquivalent(n); });', limits: ROOMY, expected: both('PASSED', 'FAILED', 'TEST_CODE_ERROR') },
  { id: 'H22/forged', title: 'Test_Code whose property never compares the two functions', role: 'test', modernCode: modern('return 0;'), testCode: 'return fc.property(fc.integer(), function () { return true; });', limits: ROOMY, expected: both('PASSED') },
];

/** H23: a prototype write in one run is not visible in the next run (fresh Worker and contexts). */
export const POLLUTION_PAIR = {
  first: legacy('return 0;', "Object.prototype.lzPolluted = 'yes'; Array.prototype.lzPolluted = 'yes';"),
  second: legacy('return [typeof ({}).lzPolluted, typeof [].lzPolluted];'),
  modernSecond: modern("return ['undefined', 'undefined'];"),
};

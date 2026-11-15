# @lazarus/pbt-verifier

## Overview

This package is the Laboratory engine of Lazarus. Given a legacy JavaScript module and its resurrected TypeScript module, it loads both, calls the same entry function on each with generated inputs, and reports whether the outcomes agreed. It uses `fast-check` for the generation and for the shrinking of failing inputs.

The result is **empirical evidence**: the legacy and the modern function agreed (or disagreed) on an exact number of generated inputs for a given seed. It is a test result, not a formal proof of equivalence. Inputs that were not generated can still behave differently.

The package is an in-process library. It has no HTTP surface, no database access, and no environment variables, and it writes nothing to standard output or standard error.

## Safety: read this first

- **`node:vm` is not a security boundary.** The legacy code, the modern code, and the stored test code run in `node:vm` contexts of the same process as the caller. Hostile code can escape such a context.
- **Only `origin: 'sample'` is supported.** The code of a Sample_Corpse is trusted because the project ships it. Both functions return `UNSUPPORTED_ORIGIN` for `origin: 'user'` before they parse, compile, or run anything.
- The spec `07-sandboxed-execution` is the one that will lift this restriction, by running user code in an isolated runner. Until it is implemented and enabled, do not pass user-imported code to this package.

## Build and test

Run these commands from the repository root:

```sh
pnpm install
pnpm exec turbo run build lint test --filter=@lazarus/pbt-verifier
```

The root scripts `pnpm build`, `pnpm lint`, and `pnpm test` also include this package.

## Usage

Both functions are asynchronous. They never throw and never reject: every problem is returned as a result with `status: 'ERROR'`.

### Programmatic mode: `verifyEquivalence`

```ts
import * as fc from 'fast-check';
import { verifyEquivalence } from '@lazarus/pbt-verifier';

const result = await verifyEquivalence({
  origin: 'sample',
  legacyCode: 'function double(n) { return n * 2; }',
  modernCode: 'export function double(n: number): number { return n * 2; }',
  entryFunction: 'double',
  inputArbitrary: fc.integer(),
  numRuns: 1000,
  seed: 42,
});
```

The property calls `double(input)` on both sides, each with its own copy of every generated input. An entry function takes exactly one argument; to pass several values, generate one object or array and read the values from it.

### Stored-test mode: `verifyTestCode`

```ts
import { verifyTestCode } from '@lazarus/pbt-verifier';

const result = await verifyTestCode({
  origin: 'sample',
  legacyCode,
  modernCode,
  entryFunction: 'computeInvoiceTotal',
  testCode, // the value of reincarnations.pbt_test_code
});
```

The test code follows the Test_Code_Contract. The contract is defined in `.kiro/steering/database-and-exorcism.md`, section 3, and this package does not restate or extend it. In short, the text is the body of a function with the parameters `fc`, `legacyFn`, `modernFn`, `assertEquivalent`, and `numRuns`, and it ends with `return fc.property(...)`. The Verifier, not the test code, calls `fc.check` with its own `numRuns` and `seed`. The fixtures under `test/fixtures/` show the format by example.

### Source format

- **Legacy code** is a classic script (not a module) that declares the entry function at the top level, as a `function` declaration or a `var` assigned a function. It must not use `module`, `exports`, `require`, `$`, `jQuery`, `window`, `document`, or `global`; code that does fails visibly with a `ReferenceError`. A top-level `let` or `const` is not visible as a global binding, so such a function is reported as not found.
- **Modern code** is one self-contained TypeScript module that exports the entry function under the same name. It is type-checked with `strict`, target `ES2022`, and only the ES2022 library (no DOM, no Node.js types). `import` declarations, re-exports from other modules, and dynamic `import()` are rejected.

## Options

| Option | Type | Default | Rule |
| --- | --- | --- | --- |
| `origin` | `'sample' \| 'user'` | none | Required. Checked first. |
| `legacyCode` | `string` | none | Required. |
| `modernCode` | `string` | none | Required. |
| `entryFunction` | `string` | none | Required. An ASCII identifier that is not a reserved word. |
| `inputArbitrary` | `fc.Arbitrary<unknown>` | none | Required for `verifyEquivalence`. |
| `testCode` | `string` | none | Required for `verifyTestCode`. |
| `numRuns` | integer | `1000` | 100 to 1000. |
| `seed` | integer | `Date.now() \| 0` | 32-bit signed. The seed used is always returned. |
| `callTimeoutMs` | integer | `1000` | 1 to 60000. Limit for one call of one function. |
| `totalTimeoutMs` | integer | `60000` | 1 to 600000. Limit for the whole verification, including loading. |

## Result shape

The result is a union on `status`. It contains only strings, finite numbers, booleans, `null`, arrays, and plain objects, so it can be serialized as JSON.

| `status` | Fields |
| --- | --- |
| `PASSED` | `totalRuns`, `seed`, `executionTimeMs`, `evidence` |
| `FAILED` | `totalRuns`, `seed`, `executionTimeMs`, `counterexample`, `evidence` |
| `ERROR` | `code`, `message`, `executionTimeMs` |

- `executionTimeMs` is the wall-clock time of the call, an integer from 1 to 600000.
- On `PASSED`, `totalRuns` equals the requested `numRuns`. On `FAILED`, `totalRuns` is the number of runs up to and including the first failing run, not counting the calls used for shrinking.
- `counterexample` has `input` (the shrunk failing input, at most 2000 characters), `legacyOutcome` and `modernOutcome` (at most 500 characters each, or `"unavailable"` when a stored test failed without `assertEquivalent`), and `shrunk`.
- `evidence` is produced by `formatEvidence(result)`: `Verified behavioral equivalence across 1,000 generated inputs (seed 42).` or `Found a behavioral difference after 7 generated inputs (seed 42).`
- The same seed, the same code, and the same arbitrary give the same inputs, so a `FAILED` result can be reproduced with its `seed`.
- Results carry no stack traces, host paths, or the submitted source code. Text that user code can inject into a message is scrubbed of overclaiming phrases.

The `status`, `totalRuns`, and `executionTimeMs` fields map without conversion to the columns `pbt_passed`, `total_runs`, and `execution_time_ms` of `reincarnations`.

### Outcome comparison

Two returned values are equivalent when they are structurally deeply equal, whatever realm created them: `NaN` equals `NaN`, `+0` differs from `-0`, and prototypes are not compared. Two thrown values are equivalent when their `name` is equal; messages and stacks are ignored. A returned value and a thrown value are never equivalent. Functions and symbols are compared by type only. Each function receives its own deep copy of the input, created in its own context.

## Error codes

| Code | Condition |
| --- | --- |
| `INVALID_OPTIONS` | An option is missing, has the wrong type or range, or a generated input cannot be deep-copied. |
| `UNSUPPORTED_ORIGIN` | `origin` is `'user'`. No code was touched. |
| `LEGACY_LOAD_ERROR` | The legacy code has a syntax error, throws, or runs longer than `callTimeoutMs` while loading. |
| `ENTRY_FUNCTION_NOT_FOUND` | The entry function is not defined as a function on the side named in the message. |
| `MODERN_COMPILE_ERROR` | The modern code has a syntax or type error, or contains an import. The message lists up to 10 diagnostics. |
| `MODERN_LOAD_ERROR` | The compiled modern code throws or runs longer than `callTimeoutMs` while loading. |
| `TEST_CODE_ERROR` | The test code does not compile, throws, returns no property, or throws an error that is not a comparison result. |
| `CALL_TIMEOUT` | One call exceeded `callTimeoutMs` before any difference was found. The message names the function. |
| `TOTAL_TIMEOUT` | The verification exceeded `totalTimeoutMs` before any difference was found. |
| `INTERNAL_ERROR` | The Verifier failed unexpectedly. The message holds the error name and message, without a stack. |

A timeout that happens after a difference was found, while `fast-check` is shrinking, does not become an error. The result is `FAILED` with the smallest counterexample found so far.

## Known limitations

- Entry functions must be synchronous. A returned `Promise` is compared as an ordinary object and is never awaited.
- Modern code cannot import other modules.
- Inputs must be deep-copyable: primitives, plain objects, arrays, `Date`, `RegExp`, `Map`, `Set`, and typed arrays. Functions, symbols, and class instances are rejected.
- The call timeout interrupts only the entry functions. Code in the stored test code itself, outside `legacyFn`, `modernFn`, and `assertEquivalent`, runs on the caller's stack and is not time-bounded.
- Calling `legacyFn` or `modernFn` directly from the test code turns a thrown error into `TEST_CODE_ERROR`. Compare outcomes through `assertEquivalent`, which treats a thrown error as part of the comparison.
- The first verification in a process spends a few hundred milliseconds loading the TypeScript library declarations. That time counts toward `totalTimeoutMs`.
- The result describes the generated inputs only. A larger `numRuns` or another `seed` can reveal a difference that an earlier run did not.

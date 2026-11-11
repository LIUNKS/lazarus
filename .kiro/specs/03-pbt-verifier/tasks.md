# Implementation Plan

## Preconditions

- `01-lazarus-foundation` is implemented: the root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, the root ESLint config, and the shared Vitest config `vitest.shared.ts` exist, and the root declares `typescript@^6` (Foundation Requirement 4, criterion 8).
- Work only inside `packages/pbt-verifier/`. The only allowed change outside it is the lockfile update that `pnpm install` produces.
- Before using an API of `fast-check` or `typescript`, check the docs for the version in `pnpm-lock.yaml` (see `tech.md`).
- All code, comments, error messages, and docs are in English. No explicit `any`.

## Tasks

- [x] 1. Scaffold the package and confirm the toolchain
  - [x] 1.1 Create `packages/pbt-verifier/package.json`, `tsconfig.json`, `vitest.config.ts`, and an empty `src/index.ts`
    - `name` `@lazarus/pbt-verifier`, `private: true`, `type: module`, `engines.node` `>=24`, scripts `build`, `test` (`vitest run`), `lint` (`tsc --noEmit` plus the root ESLint config)
    - `exports`/`main`/`types` pointing at `dist/`
    - Dependencies `fast-check@^4` and `typescript@^6`; devDependency `vitest`
    - `tsconfig.json` extends the root `tsconfig.base.json`; the Vitest config extends the root `vitest.shared.ts` with `mergeConfig`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_
  - [x] 1.2 Run `pnpm install` and confirm the toolchain
    - Confirm the lockfile resolves `typescript` to a 6.x version for this package and for the root
    - Run a one-line smoke check that `typeof ts.createProgram === 'function'` and `typeof ts.transpileModule === 'function'` with the installed version
    - Run `pnpm build`, `pnpm lint`, and `pnpm test` at the root and confirm the package takes part in all three (the empty test run may use `--passWithNoTests`)
    - _Requirements: 1.2, 1.5, 1.7_

- [x] 2. Define types, options validation, and the origin guard
  - [x] 2.1 Write `src/types.ts`
    - `Origin`, `ErrorCode` (including `INTERNAL_ERROR`), `VerifyEquivalenceOptions`, `VerifyTestCodeOptions`, `Counterexample`, `VerificationResult` as the discriminated union from the design
    - _Requirements: 2.1, 2.2, 2.4, 2.9_
  - [x] 2.2 Write `src/options.ts`
    - Validate `origin` first (missing or invalid → `INVALID_OPTIONS`; `user` → `UNSUPPORTED_ORIGIN`), then the remaining fields
    - Defaults: `numRuns` 1000, `seed` `Date.now() | 0`, `callTimeoutMs` 1000, `totalTimeoutMs` 60000; ranges as in Requirement 7
    - `entryFunction` must be an ECMAScript identifier and not a reserved word
    - Return a result or a normalized options object; never throw
    - _Requirements: 3.1, 3.2, 3.3, 4.4, 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 2.3 Write tests for options validation and the guard
    - Example tests for each invalid field and for the defaults
    - Property test (design property 6, options part): for any option set with `origin: 'user'` the guard result is `UNSUPPORTED_ORIGIN` and no other validation error can pre-empt it
    - _Requirements: 3.2, 3.3, 7.3, 12.4_

- [x] 3. Implement the sandbox
  - [x] 3.1 Write `src/sandbox/context.ts`
    - `createSandbox(extraGlobals?)` using `vm.createContext(Object.create(null))`
    - `evaluate(source, filename, timeoutMs)` as a classic `vm.Script` with `runInContext` and `timeout`
    - `invoke(fn, input, timeoutMs)` using two private global names, deleted after each call, returning `returned | threw | timeout`; thrown-value `name` rule from Requirement 6.2
    - Only `node:vm` and `node:perf_hooks` imports
    - _Requirements: 1.8, 3.4, 3.5, 6.1, 6.2, 7.9_
  - [x] 3.2 Write `src/sandbox/cloner.ts`
    - Context-side cloner script supporting primitives, `NaN`, `-0`, bigint, plain objects, arrays with holes, `Date`, `RegExp`, `Map`, `Set`, typed arrays, shared references and cycles
    - Throw a marker error for functions, symbols, and unsupported prototypes; the host helper converts it to a typed failure
    - Do not bind the cloner to any global name inside the context
    - _Requirements: 6.7, 6.8_
  - [x] 3.3 Write sandbox tests
    - Property test (design property 5): mutating the copy delivered to one sandbox never changes the original or the other copy
    - Property test (design property 9): `typeof require`, `process`, `fetch`, `console` are `'undefined'` in every sandbox kind
    - Example test: legacy `x instanceof Array` check returns the same result as in a native runtime
    - Example test: a function with an infinite loop yields `timeout` within the limit
    - _Requirements: 3.5, 6.7, 6.8, 12.7, 12.8_

- [x] 4. Implement outcomes and deep comparison
  - [x] 4.1 Write `src/equivalence/deep-equivalent.ts` and `src/equivalence/outcome.ts`
    - `deepEquivalent` per the comparison table in the design, with cycle protection and no use of prototypes
    - `equivalentOutcomes` and `renderOutcome` (max 500 characters; uses `fc.stringify` for values)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x] 4.2 Write comparison tests
    - Property test (design property 4): reflexive, symmetric, and true for `deepEquivalent(v, cloneInto(sandbox, v))` over supported value types
    - Example tests: `NaN` vs `NaN` equal, `+0` vs `-0` different, a returned value vs a thrown value different, two throws with the same `name` and different messages equal, functions compared by `typeof` only
    - _Requirements: 6.3, 6.4, 6.5, 6.6_

- [x] 5. Implement the code loaders
  - [x] 5.1 Write `src/sandbox/legacy-loader.ts`
    - Evaluate unmodified as a classic script; read the entry function through the fixed `typeof NAME === 'function'` script
    - Map syntax errors and top-level throws to `LEGACY_LOAD_ERROR`; missing function to `ENTRY_FUNCTION_NOT_FOUND` ("legacy")
    - Evaluate once per verification
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_
  - [x] 5.2 Write `src/sandbox/modern-loader.ts`
    - Import scan with `ts.createSourceFile` (static imports, `import x = require`, `export ... from`, dynamic `import()`)
    - In-memory `CompilerHost` with `strict`, `ES2022`, `module: CommonJS`, `lib: ['lib.es2022.d.ts']`, `types: []`, `noEmit`; library files read through `ts.sys` and cached in a module-level `Map` of parsed `SourceFile`s; `writeFile` throws
    - Collect syntactic, semantic, global, and options diagnostics; render the first 10 as `line:column TS<code> text`
    - `ts.transpileModule` to CommonJS, evaluate in a second sandbox with an injected `exports`, read the entry function
    - Map errors to `MODERN_COMPILE_ERROR`, `MODERN_LOAD_ERROR`, `ENTRY_FUNCTION_NOT_FOUND` ("modern")
    - _Requirements: 1.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 5.3 Write loader tests
    - Example tests: `LEGACY_LOAD_ERROR` (syntax error and top-level throw), `ENTRY_FUNCTION_NOT_FOUND` on each side, `MODERN_COMPILE_ERROR` for a type error (message contains line, column, and TS code), for an `import` declaration, and for `import()`, `MODERN_LOAD_ERROR` for a top-level throw
    - Example test: legacy code referencing `$`, `module`, or `require` fails visibly
    - _Requirements: 4.2, 4.3, 4.5, 5.2, 5.5, 5.6, 5.7, 12.5_

- [x] 6. Implement the run engine
  - [x] 6.1 Write `src/run/run-state.ts` and the side wrappers
    - `RunState` (`deadline`, `fatal`, `firstDifferenceSeen`, `lastDifference`)
    - `makeSide` factory with the five steps from the design; internal `StopSignal` class
    - Verifier's own `assertEquivalent(input)` that records the rendered outcomes, throws `EquivalenceError`, and returns `undefined` on `StopSignal` when a difference was already seen
    - _Requirements: 6.7, 7.9, 7.10, 7.11, 8.3, 8.4_
  - [x] 6.2 Write `src/run/execute.ts`
    - Call `fc.check(property, { numRuns, seed })` with no `endOnFailure`, `interruptAfterTimeLimit`, or `skipAllAfterTimeLimit`, and await the result
    - Confirm against the installed `fast-check` version that `errorInstance` is `undefined` when a predicate returns `false`; if not, apply the fallback written in the design's Open Questions
    - Classify `RunDetails` into `PASSED`, `FAILED`, or `ERROR` as in the design; render the counterexample (`fc.stringify`, 2000 characters), `shrunk` from `numShrinks`, and outcomes from `lastDifference` or `"unavailable"`
    - _Requirements: 7.6, 7.7, 7.8, 7.11, 7.13, 8.5, 8.7, 8.8, 8.9, 8.10, 9.1, 9.2, 9.3_
  - [x] 6.3 Write `src/verify-equivalence.ts`
    - Build `fc.property(inputArbitrary, (input) => assertEquivalent(input))` and run it through the shared flow
    - _Requirements: 7.1, 7.6_
  - [x] 6.4 Write `src/verify-test-code.ts`
    - Compile the Test_Code as a function body in a third sandbox with the five parameters; map syntax errors, throws, and non-property returns to `TEST_CODE_ERROR`
    - Call it with the host `fc`, wrapped `legacyFn` and `modernFn`, `assertEquivalent`, and `numRuns`; duck-type the returned property
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 11.2_
  - [x] 6.5 Write run-engine tests
    - Property test (design property 1, reflexivity): equivalent legacy and modern templates give `PASSED` with `totalRuns === numRuns`
    - Property test (design property 2, difference detection): a pair that differs only for negative integers gives `FAILED` with a negative `counterexample.input`
    - Property test (design property 3, seed determinism): same options and explicit seed give equal `status`, `totalRuns`, and `counterexample.input`, for equivalent and differing pairs, with at least two seeds
    - Example tests: `CALL_TIMEOUT` (looping legacy, `callTimeoutMs: 50`), `TOTAL_TIMEOUT` (`totalTimeoutMs: 1`), timeout during shrinking returns `FAILED`, mutating legacy code does not change the modern outcome, Test_Code errors (syntax error, throws, returns a number, throws an unrelated error, direct `legacyFn` throw)
    - _Requirements: 6.7, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 8.6, 8.10, 9.3, 9.4, 12.2, 12.3, 12.5, 12.6, 12.7_

- [x] 7. Implement evidence text and message sanitizing
  - [x] 7.1 Write `src/evidence.ts`
    - `formatEvidence` with the two exact templates and manual comma grouping (no `Intl`)
    - A `sanitize` helper that replaces banned phrases with `[redacted]` in every string field of a result
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [x] 7.2 Write evidence tests
    - Property test (design property 8): `evidence` equals `formatEvidence(result)`, matches the template, and contains no banned phrase, including when a thrown legacy error message contains one
    - _Requirements: 10.2, 10.3, 10.4, 10.5_

- [x] 8. Wire the pipeline and public exports
  - [x] 8.1 Write `src/pipeline.ts` and `src/index.ts`
    - Single flow: guard → validate → legacy → modern → property → `fc.check` → classify → sanitize → timing
    - Wrap in one `try/catch` that returns `INTERNAL_ERROR` (name and message only, no stack)
    - Compute `executionTimeMs` with `performance.now()` as `Math.max(1, Math.round(ms))`
    - Export only `verifyEquivalence`, `verifyTestCode`, `formatEvidence`, and the public types
    - _Requirements: 2.1, 2.3, 2.5, 2.6, 2.7, 2.8, 2.10, 9.5_
  - [x] 8.2 Write pipeline tests
    - Property test (design property 7): arbitrary option objects and arbitrary code strings with `origin: 'sample'` always resolve to a JSON-serializable `VerificationResult`
    - Example test for `INTERNAL_ERROR` by forcing an unexpected exception (for example, an arbitrary whose `generate` throws a non-Error value)
    - _Requirements: 2.7, 2.8, 2.9, 2.10_

- [x] 9. Add the fixtures and fixture tests
  - [x] 9.1 Create `test/fixtures/{es3,es5-jquery,legacy-node}/` with `legacy.js`, `modern.ts`, and `test-code.js`
    - One pure, deterministic entry function per fixture; ES3/ES5 only in `legacy.js` and no `module`, `exports`, `require`, `$`, `jQuery`, `window`, `document`, or `global`
    - `test-code.js` follows the Test_Code_Contract: no hardcoded run count, calls `assertEquivalent`, ends with `return fc.property(...)`
    - `modern.ts` compiles under `strict` with no `any`, no `var`, no `eval`, and no imports
    - _Requirements: 11.2, 11.3_
  - [x] 9.2 Write fixture tests
    - Run each fixture through `verifyTestCode` with `origin: 'sample'` and `numRuns: 1000`; assert `PASSED` and `totalRuns === 1000`
    - Assert the mapping of `status`, `totalRuns`, and `executionTimeMs` to the `reincarnations` column types (integers; `executionTimeMs` from 1 to 600000)
    - _Requirements: 11.1, 11.3, 12.9_

- [x] 10. Write the README
  - Document the two entry points, options, result shape, error codes, and the Test_Code_Contract by pointing to `database-and-exorcism.md`
  - State that `node:vm` is not a security boundary, that only `origin: 'sample'` is supported, and that `07-sandboxed-execution` will lift the restriction
  - State the known limitations from the design (synchronous functions only, no imports in Modern_Code, Test_Code predicates are not time-bounded, first-run cost of loading TypeScript libraries)
  - Describe results as Empirical_Evidence and never claim a mathematical proof
  - _Requirements: 3.6, 10.6_

- [ ] 11. Final checkpoint
  - Run `pnpm lint`, `pnpm build`, and `pnpm test` from the repository root and confirm exit code 0 for all three
  - Confirm the package test suite finishes in less than 60 seconds
  - Re-read Requirements 1 to 12 and confirm every criterion maps to a completed task or test; list any criterion that could not be verified
  - Confirm no file outside `packages/pbt-verifier/` changed, apart from the lockfile
  - _Requirements: 1.2, 1.5, 12.1, 12.10_

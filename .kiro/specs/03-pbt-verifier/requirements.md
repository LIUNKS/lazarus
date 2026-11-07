# Requirements Document

## Introduction

This spec defines `packages/pbt-verifier`, the Property-Based Testing engine of Lazarus (The Laboratory stage). Given a legacy JavaScript module and its resurrected TypeScript module, the verifier loads both, runs a `fast-check` property that calls the legacy Entry_Function and the modern Entry_Function with the same generated input, and reports the outcome as Empirical_Evidence with the exact number of generated inputs.

The package is a library consumed in-process by later specs (`apps/web` Route Handlers in `05-llm-pipeline-api`, and the sandboxed execution layer in `07-sandboxed-execution`). It has no HTTP surface, no database access, and no environment variables.

The steering documents `product.md`, `tech.md`, `structure.md`, and `database-and-exorcism.md` are the source of truth for the stack, the execution safety rules, the sample source format, the Test_Code_Contract, and the outcome comparison rules. `01-lazarus-foundation` provides the monorepo tooling (Requirements 1 to 4) that this package plugs into, and it seeds the three Sample_Corpse rows whose `pbt_test_code` follows the same Test_Code_Contract. The Foundation records the seeded `pbt_passed` and `execution_time_ms` values with its own runner in `db/harness/`, because the Foundation is built first and may not touch `packages/pbt-verifier`. This package is the runtime implementation of the same contract for the web application.

Out of scope (separate specs): the AST curse scanner (`02-curse-scanner`), LLM generation of the TypeScript and of the test code (`05-llm-pipeline-api`), any UI, persistence of results, and isolation of untrusted code (`07-sandboxed-execution`). This package runs code in `node:vm` contexts, which are not a security boundary, so it executes only code that comes from Sample_Corpse rows (Requirement 3).

## Glossary

- **Verifier**: The package `packages/pbt-verifier`, named `@lazarus/pbt-verifier`.
- **Legacy_Code**: A string of ES3 or ES5 JavaScript source that defines the Entry_Function as a top-level function declaration.
- **Modern_Code**: A string of TypeScript source that exports a function with the same name as the Entry_Function.
- **Entry_Function**: The single deterministic, pure, named function that both Legacy_Code and Modern_Code expose and that is called as `fn(input)`. Its name is passed to the Verifier by the caller.
- **Legacy_Fn**: The Entry_Function as defined by Legacy_Code and loaded by the Verifier.
- **Modern_Fn**: The Entry_Function as defined by Modern_Code, transpiled to JavaScript and loaded by the Verifier.
- **Origin**: The caller-declared source of the code to verify, either `sample` (a row with `is_sample = true`) or `user` (user-imported code).
- **Outcome**: The result of one call to an Entry_Function, either a returned value or a thrown error.
- **Equivalent_Outcomes**: Two Outcomes that satisfy the comparison rules in Requirement 6.
- **Input_Arbitrary**: A `fast-check` arbitrary that generates inputs for the Entry_Function.
- **Test_Code**: A string stored in `reincarnations.pbt_test_code`, written as defined by the Test_Code_Contract.
- **Test_Code_Contract**: The format of `pbt_test_code` and the outcome comparison rules defined in `.kiro/steering/database-and-exorcism.md`, section 3.
- **Sample_Corpse**: A row of `corpses` with `is_sample = true`, as defined in `01-lazarus-foundation`.
- **Seed_Migration**: The file `db/migrations/V2__seed_sample_corpses.sql` of `01-lazarus-foundation`.
- **Reincarnations_Table**: The table `public.reincarnations`, as defined in `01-lazarus-foundation`.
- **Run**: One generated input for which both Entry_Functions are called and their Outcomes are compared.
- **Seed**: The integer `fast-check` uses to initialize its random generator.
- **Counterexample**: The shrunk input for which the Outcomes of Legacy_Fn and Modern_Fn are not Equivalent_Outcomes.
- **Verification_Result**: The object the Verifier returns, with `status` `PASSED`, `FAILED`, or `ERROR` (Requirement 2).
- **Empirical_Evidence**: A property-based testing result expressed as an exact number of generated inputs and a pass or fail outcome, never as a mathematical proof.
- **Call_Timeout**: The maximum wall-clock time allowed for one call to one Entry_Function.
- **Total_Timeout**: The maximum wall-clock time allowed for one whole verification.

## Requirements

### Requirement 1: Package scaffolding and workspace integration

**User Story:** As a developer, I want `packages/pbt-verifier` to be a regular workspace package, so that Turborepo builds, lints, and tests it with the same commands as every other package.

#### Acceptance Criteria

1. THE Verifier SHALL live in `packages/pbt-verifier` and SHALL have a `package.json` with `name` set to `@lazarus/pbt-verifier`, `private` set to `true`, `type` set to `module`, and `engines.node` set to `>=24`.
2. THE Verifier SHALL define the scripts `build`, `test`, and `lint` in its `package.json`, so that the root `pnpm build`, `pnpm test`, and `pnpm lint` run them through the Build_Pipeline of `01-lazarus-foundation`.
3. THE Verifier SHALL provide a `tsconfig.json` that extends the shared base TypeScript configuration of the Workspace_Root and therefore inherits `"strict": true`.
4. THE Verifier SHALL provide a Vitest configuration that extends the Vitest configuration at the Workspace_Root.
5. THE Verifier SHALL contain zero explicit `any` type annotations in its TypeScript sources, so that `pnpm lint` exits with code 0 for the package.
6. WHEN `pnpm build` runs, THE Verifier SHALL emit JavaScript and type declaration files to `packages/pbt-verifier/dist/`, and the `main` and `types` fields (or the `exports` map) of its `package.json` SHALL point to files that exist after the build.
7. THE Verifier SHALL declare `fast-check` (major version 4) and `typescript` (major version 6) as `dependencies` and `vitest` as a `devDependency`. THE Verifier SHALL NOT depend on `typescript` 7.x, because that release ships only the native CLI and no importable JavaScript compiler API (the Verifier needs `createProgram` and `transpileModule`). WHEN a later `typescript` release ships an importable API, a new spec or a change to this one SHALL decide the migration.
8. THE Verifier SHALL NOT read any environment variable and SHALL NOT import `node:fs`, `node:net`, `node:http`, `node:https`, or `node:child_process` in its runtime sources.
9. THE Verifier SHALL write all source comments, error messages, and documentation in English.
10. THE Verifier SHALL NOT write to standard output or standard error, so that a Route Handler decides what is logged.

### Requirement 2: Public API and result shape

**User Story:** As a Route Handler author, I want a small typed API that never throws on bad input or bad code, so that I can map every outcome to an HTTP response.

#### Acceptance Criteria

1. THE Verifier SHALL export the async function `verifyEquivalence(options)` for the programmatic mode (Requirement 7) and the async function `verifyTestCode(options)` for the stored-test mode (Requirement 8).
2. THE Verifier SHALL export the TypeScript types of the options, of the Verification_Result, and of every error code.
3. THE Verifier SHALL export the function `formatEvidence(result)` defined in Requirement 10.
4. THE Verification_Result SHALL be a discriminated union on `status`, with exactly these members:
   - `PASSED`: `status`, `totalRuns`, `seed`, `executionTimeMs`, and `evidence`.
   - `FAILED`: `status`, `totalRuns`, `seed`, `executionTimeMs`, `counterexample`, and `evidence`.
   - `ERROR`: `status`, `code`, `message`, and `executionTimeMs`.
5. FOR ALL Verification_Result values, `executionTimeMs` SHALL be an integer from 1 to 600000, measured as wall-clock time from the start of the call to the return of the call, rounded to the nearest millisecond with a minimum of 1.
6. WHEN `status` is `PASSED`, THE Verification_Result `totalRuns` SHALL equal the number of Runs requested by the caller, and `seed` SHALL be the Seed that was used.
7. THE Verification_Result SHALL be JSON-serializable: it SHALL contain only strings, finite numbers, booleans, `null`, arrays, and plain objects.
8. THE Verifier functions SHALL NOT throw and SHALL NOT reject for any input, including invalid options, code that fails to load, and code that throws at call time. Each such case SHALL be returned as a Verification_Result with `status` `ERROR`.
9. THE `ERROR` Verification_Result `code` SHALL be one of `INVALID_OPTIONS`, `UNSUPPORTED_ORIGIN`, `LEGACY_LOAD_ERROR`, `ENTRY_FUNCTION_NOT_FOUND`, `MODERN_COMPILE_ERROR`, `MODERN_LOAD_ERROR`, `TEST_CODE_ERROR`, `CALL_TIMEOUT`, `TOTAL_TIMEOUT`, or `INTERNAL_ERROR` (an unexpected failure of the Verifier itself, with a `message` that contains the error name and message but no stack trace).
10. THE `ERROR` Verification_Result `message` SHALL be a non-empty English string and SHALL NOT contain the full source of the Legacy_Code, the Modern_Code, or the Test_Code.

### Requirement 3: Execution safety guard

**User Story:** As a security-conscious maintainer, I want the Verifier to refuse to run user-imported code, so that `node:vm` is never used as a security boundary.

#### Acceptance Criteria

1. THE options of `verifyEquivalence` and `verifyTestCode` SHALL include a required field `origin` whose accepted values are exactly `sample` and `user`.
2. IF `origin` is `user`, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `UNSUPPORTED_ORIGIN` and SHALL NOT parse, transpile, compile, or evaluate any of Legacy_Code, Modern_Code, or Test_Code.
3. IF `origin` is missing or is not one of the two accepted values, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `INVALID_OPTIONS` and SHALL NOT parse, transpile, compile, or evaluate any of Legacy_Code, Modern_Code, or Test_Code.
4. THE Verifier SHALL evaluate Legacy_Code, Modern_Code, and Test_Code only inside fresh `node:vm` contexts created for that single verification and discarded after it, and SHALL NOT evaluate them with `eval`, `new Function`, or `import()` in the host realm.
5. THE `node:vm` contexts SHALL expose only the ECMAScript built-in globals of the context itself, and SHALL NOT expose `require`, `process`, `module`, `fetch`, timers, `Buffer`, `console`, or any other host object, except the values injected by Requirement 5 criterion 3 (the `exports` object) and Requirement 8 criterion 3 (the Test_Code parameters).
6. THE Verifier documentation (the package `README.md`) SHALL state that `node:vm` is not a security boundary, that only `sample` origin is supported, and that `07-sandboxed-execution` is the spec that will lift the restriction.

### Requirement 4: Loading Legacy_Code

**User Story:** As a developer, I want legacy ES3 and ES5 code loaded exactly as written, so that the verifier compares real legacy behavior and not a rewritten version.

#### Acceptance Criteria

1. WHEN the Verifier loads Legacy_Code, THE Verifier SHALL evaluate the source unmodified as a classic script (not as a module) in a fresh `node:vm` context and SHALL take Legacy_Fn from the global binding named by the Entry_Function name, following the sample source format in `database-and-exorcism.md`.
2. THE Verifier SHALL NOT define `$`, `jQuery`, `window`, `document`, `global`, `module`, `exports`, or `require` in the Legacy_Code context, so that Legacy_Code that depends on them fails visibly, consistent with Requirement 17 criteria 6 and 8 of `01-lazarus-foundation`.
3. IF the Legacy_Code has a syntax error or throws during evaluation, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `LEGACY_LOAD_ERROR` and a `message` that contains the error name and the error message.
4. IF the Entry_Function name is not a valid ECMAScript identifier, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `INVALID_OPTIONS`.
5. IF the global binding named by the Entry_Function name is not a function after evaluation, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `ENTRY_FUNCTION_NOT_FOUND` and a `message` that contains the name and states that the Legacy_Code is the side where it is missing.
6. THE Verifier SHALL evaluate the Legacy_Code before any call to Legacy_Fn and SHALL NOT evaluate it again for the Runs of one verification.

### Requirement 5: Loading Modern_Code

**User Story:** As a developer, I want the resurrected TypeScript checked under `strict` mode and then run as JavaScript, so that code that does not compile cannot be reported as equivalent.

#### Acceptance Criteria

1. WHEN the Verifier loads Modern_Code, THE Verifier SHALL type-check it in memory with the TypeScript compiler API using `strict: true`, the target `ES2022`, and only the ES2022 default library declarations (no DOM and no Node.js types). The type-check SHALL read no file other than the library declaration files shipped in the `typescript` package, and SHALL write no file.
2. IF the type-check reports at least one error diagnostic, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `MODERN_COMPILE_ERROR` and a `message` that lists up to the first 10 diagnostics, each with its line number, column number, TypeScript error code, and text.
3. WHEN the type-check reports zero error diagnostics, THE Verifier SHALL transpile the Modern_Code to a CommonJS-style JavaScript script and evaluate it in a fresh `node:vm` context, separate from the context of Legacy_Code, with an empty `exports` object injected as the only extra binding.
4. THE Verifier SHALL take Modern_Fn from that `exports` object under the Entry_Function name.
5. IF the transpiled Modern_Code throws during evaluation, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `MODERN_LOAD_ERROR` and a `message` that contains the error name and the error message.
6. IF the Modern_Code does not export a function under the Entry_Function name, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `ENTRY_FUNCTION_NOT_FOUND` and a `message` that states that the Modern_Code is the side where it is missing.
7. THE Verifier SHALL NOT support `import` statements of other modules in Modern_Code. IF the Modern_Code contains an `import` declaration or a dynamic `import()`, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `MODERN_COMPILE_ERROR` and a `message` that states that imports are not supported.

### Requirement 6: Outcomes and equivalence comparison

**User Story:** As a maintainer, I want a precise definition of "equivalent", so that a reported pass means the same thing in every run.

#### Acceptance Criteria

1. WHEN an Entry_Function call returns, THE Verifier SHALL record an Outcome of kind `returned` that holds the returned value.
2. WHEN an Entry_Function call throws, THE Verifier SHALL record an Outcome of kind `threw` that holds the `name` of the thrown value if it is an object with a string `name` property, and the string `"non-error"` otherwise.
3. THE Verifier SHALL treat two `returned` Outcomes as Equivalent_Outcomes if and only if their values are structurally deeply equal, where `NaN` equals `NaN`, `+0` does not equal `-0`, and the comparison does not depend on the `node:vm` context (realm) in which an array, plain object, `Date`, `RegExp`, `Map`, or `Set` was created.
4. THE Verifier SHALL treat two `threw` Outcomes as Equivalent_Outcomes if and only if their recorded `name` values are equal. It SHALL NOT compare error messages or stack traces.
5. THE Verifier SHALL treat a `returned` Outcome and a `threw` Outcome as not Equivalent_Outcomes.
6. IF a returned value is a function or a symbol, THEN THE Verifier SHALL treat the two values as Equivalent_Outcomes only if both Outcomes are of kind `returned` with a value of the same type, and SHALL NOT compare function bodies.
7. THE Verifier SHALL deliver the input to Legacy_Fn and to Modern_Fn as two independent deep copies of the generated input, each created in the context of the function that receives it, so that mutation of the input by one function does not affect the other function or the generated value, and so that checks such as `input instanceof Array` behave as they would in a native runtime.
8. IF a generated input cannot be deep-copied (for example, it contains a function), THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `INVALID_OPTIONS` and a `message` that states that inputs must be structured-cloneable.
9. THE Verifier SHALL support only synchronous Entry_Functions. IF an Entry_Function returns a Promise, THEN THE Verifier SHALL treat it as an ordinary returned object and SHALL NOT await it.

### Requirement 7: Programmatic equivalence run

**User Story:** As a developer, I want to verify two functions with a caller-provided generator and run count, so that I can reuse the engine for every corpse.

#### Acceptance Criteria

1. THE options of `verifyEquivalence` SHALL include `origin`, `legacyCode`, `modernCode`, `entryFunction`, and `inputArbitrary` (an Input_Arbitrary), and MAY include `numRuns`, `seed`, `callTimeoutMs`, and `totalTimeoutMs`.
2. THE Verifier SHALL accept `numRuns` as an integer from 100 to 1000 inclusive and SHALL default it to 1000 when it is absent.
3. IF `numRuns` is not an integer from 100 to 1000, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `INVALID_OPTIONS` and SHALL NOT evaluate any code.
4. THE Verifier SHALL accept `seed` as a 32-bit signed integer, and WHEN `seed` is absent THE Verifier SHALL generate one as `Date.now() | 0` in the host realm and return it in the Verification_Result.
5. THE Verifier SHALL default `callTimeoutMs` to 1000 and `totalTimeoutMs` to 60000, and SHALL reject with `INVALID_OPTIONS` any value that is not an integer from 1 to 600000 (for `totalTimeoutMs`) or from 1 to 60000 (for `callTimeoutMs`).
6. WHEN the options are valid, THE Verifier SHALL run `fast-check` with the given `numRuns` and `seed` over a property that calls Legacy_Fn and Modern_Fn with copies of each generated input and passes if and only if the two Outcomes are Equivalent_Outcomes.
7. WHEN all Runs pass, THE Verifier SHALL return a `PASSED` Verification_Result.
8. WHEN a Run produces Outcomes that are not Equivalent_Outcomes, THE Verifier SHALL stop generating inputs after `fast-check` finishes shrinking and SHALL return a `FAILED` Verification_Result.
9. IF one call to Legacy_Fn or Modern_Fn runs longer than `callTimeoutMs` and no non-equivalence has been found yet, THEN THE Verifier SHALL abort that call, stop the verification, and return an `ERROR` Verification_Result with `code` `CALL_TIMEOUT` and a `message` that names which function (legacy or modern) timed out.
10. IF the verification runs longer than `totalTimeoutMs` and no non-equivalence has been found yet, THEN THE Verifier SHALL stop before starting the next Run and return an `ERROR` Verification_Result with `code` `TOTAL_TIMEOUT`.
11. IF a call timeout or the total timeout occurs after a non-equivalence has been found (while `fast-check` is shrinking), THEN THE Verifier SHALL stop shrinking and return the `FAILED` Verification_Result with the smallest counterexample found so far.
12. FOR ALL option sets with the same code, Entry_Function name, `inputArbitrary`, `numRuns`, and an explicit `seed`, THE Verifier SHALL generate the same sequence of inputs and return a Verification_Result with the same `status`, `totalRuns`, and `counterexample` input (determinism).
13. WHEN the result is `PASSED`, exactly `numRuns` Runs SHALL have executed. THE Verifier SHALL NOT use `fast-check` options that skip or cap Runs on success (such as `interruptAfterTimeLimit` or `skipAllAfterTimeLimit`).

### Requirement 8: Stored Test_Code run

**User Story:** As a Route Handler author, I want to run the `pbt_test_code` stored in the database, so that the numbers shown in the UI come from the same test that the user can read.

#### Acceptance Criteria

1. THE options of `verifyTestCode` SHALL include `origin`, `legacyCode`, `modernCode`, `entryFunction`, and `testCode` (a string), and MAY include `numRuns`, `seed`, `callTimeoutMs`, and `totalTimeoutMs` with the same rules as Requirement 7 criteria 2 to 5.
2. THE Verifier SHALL implement the Test_Code_Contract defined in `database-and-exorcism.md`, section 3: the Test_Code is the body of a function with the parameters `fc`, `legacyFn`, `modernFn`, `assertEquivalent`, and `numRuns`, contains no `import`, `export`, or `require`, does not hardcode a run count, and ends with a `return` statement that returns a `fast-check` property (the result of `fc.property(...)` or `fc.asyncProperty(...)`).
3. WHEN the options are valid, THE Verifier SHALL evaluate the Test_Code in its own fresh `node:vm` context, call it with the Verifier's own `fast-check` module as `fc`, with the loaded Legacy_Fn and Modern_Fn (wrapped so that each call receives its own deep copy of the input and enforces `callTimeoutMs`), with `assertEquivalent` as defined in criterion 4, and with the validated `numRuns`.
4. THE injected `assertEquivalent(input)` function SHALL call both functions with copies of `input`, SHALL return `undefined` when the Outcomes are Equivalent_Outcomes, and SHALL throw an `Error` whose message states the two Outcomes (kind, and value or error name, truncated to 500 characters each) when they are not.
5. THE Verifier SHALL execute the returned property with `fc.check(property, { numRuns, seed })`, so that the number of Runs and the Seed are controlled by the Verifier and not by the Test_Code.
6. IF the Test_Code has a syntax error, throws when called, or does not return a `fast-check` property, THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `TEST_CODE_ERROR` and a `message` that contains the error name and the error message, or states that no property was returned.
7. WHEN `fc.check` reports success, THE Verifier SHALL return a `PASSED` Verification_Result with `totalRuns` equal to `numRuns`.
8. WHEN `fc.check` reports a failure whose cause is a non-equivalence thrown by `assertEquivalent` or a property predicate returning `false`, THE Verifier SHALL return a `FAILED` Verification_Result.
9. IF `fc.check` reports a failure whose cause is a `CALL_TIMEOUT` or `TOTAL_TIMEOUT` condition defined in Requirement 7, THEN THE Verifier SHALL return the corresponding `ERROR` Verification_Result and not a `FAILED` one.
10. IF `fc.check` reports a failure whose cause is any other error thrown by the Test_Code itself (not by `assertEquivalent` and not by a call to Legacy_Fn or Modern_Fn), THEN THE Verifier SHALL return an `ERROR` Verification_Result with `code` `TEST_CODE_ERROR`.

### Requirement 9: Failure reporting and reproducibility

**User Story:** As a user reading a failed verification, I want the smallest failing input and the seed, so that I can reproduce the difference.

#### Acceptance Criteria

1. WHEN the Verifier returns a `FAILED` Verification_Result, THE `counterexample` SHALL contain `input` (the shrunk failing input rendered with `fc.stringify` and truncated to 2000 characters), `legacyOutcome` and `modernOutcome` (each rendered as a string of at most 500 characters, naming the kind and the value or error name), and `shrunk` (a boolean that is `true` if `fast-check` shrank the input at least once).
2. WHEN the Verifier returns a `FAILED` Verification_Result in `verifyTestCode` mode, THE `counterexample` SHALL take `legacyOutcome` and `modernOutcome` from the two rendered Outcomes carried by the error that the Verifier's own `assertEquivalent` throws. WHERE the failure was not raised by `assertEquivalent` (for example, a property predicate returned `false`), THE Verifier SHALL set both to the string `"unavailable"`.
3. WHEN the Verifier returns a `FAILED` Verification_Result, THE `totalRuns` SHALL equal the number of Runs executed up to and including the first failing Run, not counting the executions used for shrinking.
4. WHEN a caller passes the `seed` of a `FAILED` Verification_Result together with the same code, Entry_Function name, `numRuns`, and Input_Arbitrary (or Test_Code) to the Verifier again, THE Verifier SHALL return a `FAILED` Verification_Result with the same `counterexample.input`.
5. THE Verification_Result SHALL NOT contain stack traces, host file paths, or the host `process` details.

### Requirement 10: Evidence text

**User Story:** As a product owner, I want evidence text that is accurate and consistent, so that Lazarus never claims more than the test shows.

#### Acceptance Criteria

1. THE Verifier SHALL export `formatEvidence(result)`, which takes a `PASSED` or `FAILED` Verification_Result and returns an English string.
2. FOR a `PASSED` Verification_Result, `formatEvidence` SHALL return exactly `Verified behavioral equivalence across N generated inputs (seed S).`, where `N` is `totalRuns` formatted with a comma as thousands separator and no locale lookup (for example `1,000`), and `S` is the seed.
3. FOR a `FAILED` Verification_Result, `formatEvidence` SHALL return exactly `Found a behavioral difference after N generated inputs (seed S).`, with `N` and `S` formatted as in criterion 2.
4. THE `evidence` field of every `PASSED` and `FAILED` Verification_Result SHALL equal the return value of `formatEvidence` for that result.
5. THE Verifier SHALL NOT produce any string, in any Verification_Result field, that contains `100%`, `mathematical proof`, `mathematically proven`, or `guaranteed` (compared case-insensitively).
6. THE package `README.md` SHALL describe results as Empirical_Evidence and SHALL NOT claim a mathematical proof of equivalence.

### Requirement 11: Compatibility with the Foundation seed data

**User Story:** As a maintainer, I want the Verifier and the Foundation runner to implement the same contract, so that the stored sample results can be reproduced by the web application.

#### Acceptance Criteria

1. THE field names and types of a `PASSED` or `FAILED` Verification_Result SHALL map without conversion to the Reincarnations_Table columns: `status === 'PASSED'` to `pbt_passed`, `totalRuns` to `total_runs` (INTEGER), and `executionTimeMs` to `execution_time_ms` (INTEGER).
2. THE Verifier SHALL NOT require any Test_Code feature beyond the Test_Code_Contract (no extra injected parameters and no wrapper syntax), so that a `pbt_test_code` value stored by the Seed_Migration of `01-lazarus-foundation` runs unchanged in the Verifier.
3. THE Verifier SHALL provide at least three test fixtures in `packages/pbt-verifier/test/fixtures/`, one per `source_language` (`es3`, `es5-jquery`, `legacy-node`), each with a Legacy_Code file, a Modern_Code file, and a Test_Code file. Each fixture SHALL follow the sample source format and the Test_Code_Contract in `database-and-exorcism.md`, SHALL be a pure, deterministic Entry_Function, and SHALL contain no ES2015 or later syntax in its Legacy_Code.
4. THE Verifier SHALL use the same outcome comparison rules as `database-and-exorcism.md` (Requirement 6 of this spec restates them in full).

### Requirement 12: Verifier self-tests

**User Story:** As a maintainer, I want tests that prove the verifier detects differences and rejects unsafe requests, so that a green result means something.

#### Acceptance Criteria

1. WHEN `pnpm test` runs, THE Verifier SHALL execute its Vitest tests in single-run mode and SHALL exit with a non-zero code if at least one test fails.
2. THE Verifier tests SHALL include a pair of Legacy_Code and Modern_Code that are equivalent, and SHALL assert a `PASSED` result with `totalRuns` equal to the requested `numRuns`.
3. THE Verifier tests SHALL include a pair that differs for exactly one class of inputs (for example, an off-by-one error that appears only for negative numbers), and SHALL assert a `FAILED` result whose `counterexample.input` is a member of that class.
4. THE Verifier tests SHALL assert the `UNSUPPORTED_ORIGIN` result for `origin: 'user'`, using Legacy_Code with a syntax error, so that a `LEGACY_LOAD_ERROR` result would reveal that the code had been parsed or evaluated.
5. THE Verifier tests SHALL include one test for each remaining error code of Requirement 2 criterion 9, each triggered by a minimal code or option fixture.
6. THE Verifier tests SHALL assert the determinism property of Requirement 7 criterion 12 for at least one equivalent pair and one differing pair, using at least two different seeds.
7. THE Verifier tests SHALL assert that Legacy_Code that mutates its input does not change the Outcome of Modern_Fn for the same generated input (Requirement 6 criterion 7).
8. THE Verifier tests SHALL assert that none of `require`, `process`, `fetch`, and `console` is reachable from Legacy_Code, Modern_Code, or Test_Code (Requirement 3 criterion 5).
9. THE Verifier tests SHALL run the three fixtures of Requirement 11 criterion 3 and assert a `PASSED` result for each.
10. THE Verifier tests SHALL complete in less than 60 seconds on a machine that meets the Node.js `>=24` requirement.

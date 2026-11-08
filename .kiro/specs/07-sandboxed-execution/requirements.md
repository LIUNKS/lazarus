# Requirements Document

## Introduction

This spec defines `packages/sandbox-runner`, the isolated execution layer of Lazarus. It lets the Laboratory stage run **user-imported** legacy JavaScript, the LLM-generated TypeScript counterpart, and the LLM-generated Test_Code for authenticated users, which `03-pbt-verifier` refuses to do (`origin: 'user'` returns `UNSUPPORTED_ORIGIN`) because `node:vm` is not a security boundary.

The package provides four things:

1. A **Live_Execution_Gate**: a policy function that decides whether a corpus may run live, with a per-user and a global concurrency limit.
2. An **Exec_Worker**: a fresh Node.js Worker thread per run, with memory limits, a wall-clock timeout, an empty environment, and no host objects reachable from the untrusted code. The untrusted code runs in fresh `node:vm` contexts inside that Worker.
3. A **value codec** that moves inputs and outcomes across the isolation boundary as strings, and a canonical form that implements the equivalence rules of `database-and-exorcism.md`.
4. Two run modes: a **property mode** that runs the stored Test_Code with `fast-check` entirely inside the Sandbox and returns a `PASSED`, `FAILED`, or `ERROR` result like `03-pbt-verifier`, and a **cases mode** that returns one outcome per explicit input.

**This is defense in depth with stated limits, not a claim of absolute security.** The Sandbox runs in the same OS process as the web server. A bug in V8 or in Node.js could let hostile code escape it. The Threat_Model (Requirement 11) lists what the Sandbox does not protect against and the hardening to apply before the feature is exposed beyond a small trusted audience. User-code execution stays disabled until an operator enables it (Requirement 3).

**Prerequisites.** `01-lazarus-foundation` (monorepo tooling), `03-pbt-verifier` (result types, comparison rules, Modern_Code compilation, in-process sample execution). `05-llm-pipeline-api` is the expected caller; this spec does not define or change any HTTP behavior of that spec.

**Changes outside the new package.** Exactly one: an additive subpath export in `packages/pbt-verifier` that exposes the Modern_Code compile function and the result sanitizer (Requirement 1, criterion 8). No requirement of `03-pbt-verifier` changes; its `origin: 'user'` guard stays as it is.

**Out of scope** (separate specs or future work): HTTP routes, rate limits per time window, quota storage, database access, UI, LLM calls, persistence of results (the route, the quota ledger, the persistence, and the corpse status update belong to `08-live-verification-api`; the UI belongs to `06-resurrection-ui`; LLM calls belong to `05-llm-pipeline-api`); OS-level isolation such as containers, microVMs, or an external execution service (listed as future hardening in the design); scanning legacy code for curses (`02-scanner-and-verifier`).

## Glossary

- **Sandbox_Runner**: The package `packages/sandbox-runner`, named `@lazarus/sandbox-runner`.
- **Verifier**: The package `@lazarus/pbt-verifier` of `03-pbt-verifier`.
- **Untrusted_Code**: Legacy_Code, Modern_Code (after transpilation to JavaScript), and Test_Code of a corpus whose Origin is `user`. Test_Code is untrusted because an LLM generates it from user-controlled input.
- **Origin**: `sample` (a row with `is_sample = true`) or `user` (user-imported code). The caller derives it from the database row, never from client input.
- **Caller**: Either `{ kind: 'anonymous' }` or `{ kind: 'member', userId }`, as determined by the calling Route Handler from verified claims.
- **Live_Execution_Gate** (the **Gate**): The policy and concurrency component of Requirement 3.
- **Gate_Config**: `userExecutionEnabled` (boolean, default `false`), `allowAnonymousSampleRuns` (boolean, default `false`), `perUserConcurrency` (integer, default 1), and `globalConcurrency` (integer, default 4).
- **Lease**: A token returned by the Gate that holds one concurrency slot until it is released.
- **Exec_Worker**: A Node.js Worker thread created for exactly one run that executes Untrusted_Code.
- **Compile_Worker**: A Node.js Worker thread created for exactly one run that type-checks and transpiles Modern_Code. It never executes Untrusted_Code.
- **Context**: A `node:vm` context created inside an Exec_Worker. Each run uses three: the Legacy_Context, the Modern_Context, and the Driver_Context.
- **Trusted_Script**: JavaScript text shipped in the Sandbox_Runner and evaluated inside a Context before any Untrusted_Code runs.
- **Sandbox**: An Exec_Worker together with its three Contexts.
- **Sandbox_Limits**: The numeric limits of Requirement 5, supplied as options with the defaults and ranges stated there.
- **Tagged_Value**: The JSON text format of Requirement 7 that carries a JavaScript value across the isolation boundary.
- **Canonical_Form**: The Tagged_Value text of an outcome, built so that two outcomes are Equivalent_Outcomes if and only if their Canonical_Forms are equal strings.
- **Outcome**, **Equivalent_Outcomes**, **Entry_Function**, **Legacy_Fn**, **Modern_Fn**, **Test_Code**, **Test_Code_Contract**, **Empirical_Evidence**, **Seed**, **Counterexample**: As defined in `03-pbt-verifier`.
- **Sandbox_Result**: The object returned by the Sandbox_Runner in property mode (Requirement 2).
- **Denied_Names**: The identifiers `process`, `require`, `module`, `global`, `fetch`, `XMLHttpRequest`, `WebSocket`, `Buffer`, `console`, `setTimeout`, `setInterval`, `setImmediate`, and `queueMicrotask`.
- **Forbidden_Capability**: An attempt by Untrusted_Code to use something the Sandbox denies: dynamic code generation while it is disabled, a dynamic `import()`, WebAssembly compilation, or a reference to a Denied_Name.
- **Threat_Model**: The section of the design and of the package `README.md` that states what the Sandbox protects against and what it does not.
- **Forbidden_Phrases**: The strings `100%`, `mathematical proof`, `mathematically proven`, and `guaranteed`, compared case-insensitively.

## Requirements

### Requirement 1: Package scaffolding and workspace integration

**User Story:** As a developer, I want `packages/sandbox-runner` to be a regular workspace package, so that Turborepo builds, lints, and tests it like every other package.

#### Acceptance Criteria

1. THE Sandbox_Runner SHALL live in `packages/sandbox-runner` and SHALL have a `package.json` with `name` set to `@lazarus/sandbox-runner`, `private` set to `true`, `type` set to `module`, and `engines.node` set to `>=24`.
2. THE Sandbox_Runner SHALL define the scripts `build`, `test`, and `lint` in its `package.json`, so that the root `pnpm build`, `pnpm test`, and `pnpm lint` run them through the Turborepo pipeline of `01-lazarus-foundation`.
3. THE Sandbox_Runner SHALL provide a `tsconfig.json` that extends the shared base TypeScript configuration of the Workspace_Root (and therefore inherits `"strict": true`) and a Vitest configuration that extends the root Vitest configuration.
4. THE Sandbox_Runner SHALL contain zero explicit `any` type annotations in its TypeScript sources and tests, so that `pnpm lint` exits with code 0 for the package.
5. WHEN `pnpm build` runs, THE Sandbox_Runner SHALL emit JavaScript and type declarations to `packages/sandbox-runner/dist/`, SHALL emit the worker entry files and the Trusted_Scripts (including a bundled copy of `fast-check`) to `packages/sandbox-runner/dist/worker/`, and every path named in its `main`, `types`, or `exports` fields SHALL exist after the build.
6. THE Sandbox_Runner SHALL declare `@lazarus/pbt-verifier` (workspace version) and `fast-check` (major version 4) as `dependencies`, and its bundler and `vitest` as `devDependencies`.
7. THE Sandbox_Runner SHALL read no environment variable, SHALL write nothing to standard output or standard error, and SHALL NOT import `node:fs`, `node:net`, `node:http`, `node:https`, or `node:child_process` in the code that runs inside an Exec_Worker. The only configuration source SHALL be the options passed by the caller.
8. THE Sandbox_Runner SHALL depend on an additive subpath export of `@lazarus/pbt-verifier` that exposes `compileModernCode` (type-check under `strict`, reject imports, transpile to CommonJS) and `sanitizeResult` (redaction of Forbidden_Phrases). The change to `packages/pbt-verifier` SHALL be limited to adding that export and SHALL NOT alter any behavior or test of the Verifier.
9. THE Sandbox_Runner SHALL write all source comments, error messages, and documentation in English.

### Requirement 2: Public API and result shape

**User Story:** As a Route Handler author, I want a small typed API that never throws, so that I can map every outcome to an HTTP response.

#### Acceptance Criteria

1. THE Sandbox_Runner SHALL export `createLiveExecutionGate(config)`, `verifyLive(request, gate)`, `runSandboxedVerification(options)` (property mode, Requirement 9), `runSandboxedCases(options)` (cases mode, Requirement 10), and the TypeScript types of all options, results, and error codes.
2. THE Sandbox_Result SHALL be a discriminated union on `status` with the members `PASSED`, `FAILED`, and `ERROR`, whose fields are those of the Verifier's `VerificationResult` (`totalRuns`, `seed`, `executionTimeMs`, `evidence`, `counterexample`, `code`, `message`), plus the field `executor` set to `sandbox-worker`, `in-process`, or `none`.
3. THE `ERROR` member `code` SHALL be one of the Verifier codes `INVALID_OPTIONS`, `LEGACY_LOAD_ERROR`, `ENTRY_FUNCTION_NOT_FOUND`, `MODERN_COMPILE_ERROR`, `MODERN_LOAD_ERROR`, `TEST_CODE_ERROR`, `INTERNAL_ERROR`, or one of the sandbox codes `LIVE_EXECUTION_DENIED`, `SANDBOX_UNAVAILABLE`, `SANDBOX_TIMEOUT`, `SANDBOX_OUT_OF_MEMORY`, `SANDBOX_FORBIDDEN_CAPABILITY`, `SANDBOX_CRASH`, `OUTPUT_LIMIT_EXCEEDED`, or `UNSUPPORTED_VALUE`. WHEN the code is `LIVE_EXECUTION_DENIED`, the result SHALL carry a `reason` from Requirement 3.
4. FOR ALL inputs, including invalid options and hostile code, THE exported run functions SHALL return a resolved promise and SHALL NOT throw or reject.
5. THE Sandbox_Result SHALL be JSON-serializable and SHALL contain only strings, finite numbers, booleans, `null`, arrays, and plain objects.
6. FOR ALL Sandbox_Result values, `executionTimeMs` SHALL be an integer from 1 to 600000, measured on the host from the start of the call to the return, including Worker start-up and termination.
7. THE `message` of an `ERROR` result SHALL be a non-empty English string of at most 500 characters. THE Sandbox_Result SHALL NOT contain a stack trace, a host file path, an environment variable name or value, a `process` detail, or the source text of Legacy_Code, Modern_Code, or Test_Code.
8. THE Sandbox_Runner SHALL apply the `sanitizeResult` function of Requirement 1 criterion 8 to every result, so that no string field contains a Forbidden_Phrase.

### Requirement 3: Live-execution gate and concurrency limits

**User Story:** As a maintainer, I want one policy function that decides whether a corpus may run live, so that user-imported code can never reach an executor by accident.

#### Acceptance Criteria

1. THE Gate SHALL decide from the Origin, the Caller, the identifier of the corpus owner (`corpusOwnerId`, or `null`), and the Gate_Config only, and the decision function SHALL be pure and SHALL NOT read any environment variable.
2. IF the request is malformed (an unknown Origin, a `member` Caller with an empty `userId`, or a missing field), THEN THE Gate SHALL deny with reason `INVALID_REQUEST`.
3. WHEN the Origin is `sample`, THE Gate SHALL allow the run with executor `in-process` if the Caller is a `member`, or if the Caller is `anonymous` and `allowAnonymousSampleRuns` is `true`. OTHERWISE it SHALL deny with reason `ANONYMOUS_NOT_ALLOWED`.
4. WHEN the Origin is `user` and the Caller is `anonymous`, THE Gate SHALL deny with reason `AUTH_REQUIRED`, whatever the Gate_Config.
5. WHEN the Origin is `user`, the Caller is a `member`, and `userExecutionEnabled` is `false`, THE Gate SHALL deny with reason `USER_EXECUTION_DISABLED`. The default Gate_Config SHALL have `userExecutionEnabled` set to `false`.
6. WHEN the Origin is `user`, the Caller is a `member`, and `corpusOwnerId` is `null` or differs from the Caller's `userId`, THE Gate SHALL deny with reason `NOT_OWNER`.
7. WHEN every check of criteria 2 to 6 passes for an Origin `user`, THE Gate SHALL allow the run with executor `sandbox`, and SHALL NOT allow any other executor for that Origin.
8. THE Gate SHALL evaluate the checks in this order and return the first denial only: criterion 2, then the Origin-specific criteria 3 to 6, then the concurrency limits of criterion 9.
9. WHEN a run is allowed with executor `sandbox`, THE Gate SHALL atomically check and take one Lease. IF the number of active Leases of that user is at least `perUserConcurrency`, THEN it SHALL deny with reason `USER_CONCURRENCY_LIMIT`. IF the number of active Leases of all users is at least `globalConcurrency`, THEN it SHALL deny with reason `GLOBAL_CONCURRENCY_LIMIT`.
10. THE Gate SHALL release a Lease exactly once: a second `release()` call SHALL do nothing. `verifyLive` SHALL release the Lease on every path, including a timeout, a crash, and an internal error.
11. FOR ALL sequences of acquire and release operations, the number of active Leases SHALL never exceed the limits of criterion 9, and SHALL return to 0 after all Leases are released.
12. THE Gate SHALL keep its counters in memory of the current process. The design and the `README.md` SHALL state that the limits apply per process, not across several server instances.
13. IF the Gate denies a run, THEN `verifyLive` SHALL return an `ERROR` result with `code` `LIVE_EXECUTION_DENIED`, the denial `reason`, and `executor` `none`, and SHALL NOT parse, compile, transpile, or evaluate any of the submitted code, and SHALL NOT create a Worker.
14. IF the Gate allows a `user` run and the Sandbox cannot be started (for example, the worker files are missing), THEN `verifyLive` SHALL return an `ERROR` result with `code` `SANDBOX_UNAVAILABLE` and SHALL NOT fall back to in-process execution.

### Requirement 4: Worker lifecycle and realm isolation

**User Story:** As a security-conscious maintainer, I want each run isolated from every other run and from the host's objects, so that hostile code has as little to reach as possible.

#### Acceptance Criteria

1. THE Sandbox_Runner SHALL create a new Exec_Worker for each run and SHALL NOT reuse an Exec_Worker or a Context for a second run, so that no state of one run (globals, prototypes, closures) is visible to another run.
2. THE Sandbox_Runner SHALL terminate every Exec_Worker and Compile_Worker it creates, on every path (success, error, timeout, crash), and SHALL resolve its result only after termination has completed or has been requested and the Worker has been detached from the run.
3. THE Sandbox_Runner SHALL create each Worker with: an empty `env` object, an empty `argv`, an empty `execArgv`, `stdout` and `stderr` captured so that nothing is written to the host streams, `resourceLimits` from Requirement 5, and a `workerData` value made only of strings, numbers, and booleans.
4. THE worker entry code SHALL be strict-mode code (an ECMAScript module), so that the stack frames below any Untrusted_Code frame cannot expose their receiver or function through the stack trace API.
5. THE Sandbox_Runner SHALL create the Legacy_Context, the Modern_Context, and the Driver_Context with `vm.createContext` using an ordinary global object (`vm.constants.DONT_CONTEXTIFY`), the option `microtaskMode` set to `afterEvaluate`, and `codeGeneration.wasm` set to `false`. It SHALL NOT pass an `importModuleDynamically` option, so that a dynamic `import()` cannot load a module.
6. THE Sandbox_Runner SHALL NOT place any value created in the Worker's own realm (a function, object, array, `Error`, `Buffer`, or module namespace) into a Context. All helper logic (the codec, the comparator, the side adapters, `fast-check`) SHALL be Trusted_Scripts evaluated inside the Contexts, and the only values that cross from the Worker realm into a Context SHALL be strings, numbers, and booleans passed as script text or arguments.
7. THE Sandbox_Runner SHALL evaluate the Trusted_Scripts of a Context before any Untrusted_Code and SHALL capture the intrinsics they use (`Object.keys`, `Array.isArray`, `JSON.stringify`, `Reflect.ownKeys`, `String`, and so on) in closures. The Worker needs one entry point per Context to call under a `vm` timeout, so the Trusted_Scripts SHALL bind each entry point under a per-run random, non-enumerable, non-writable global name. The Threat_Model SHALL state that hostile code can discover that name, and that the consequence is limited to the integrity of the verdict of its own run (Requirement 11).
8. BEFORE evaluating Untrusted_Code, THE Trusted_Scripts SHALL delete `SharedArrayBuffer` and `Atomics` from the Context global, and SHALL redefine `Error.prepareStackTrace` as a non-writable, non-configurable property whose value is `undefined`.
9. THE Sandbox_Runner SHALL load Legacy_Code as an unmodified classic script in the Legacy_Context, SHALL load the transpiled Modern_Code in the Modern_Context with an `exports` object created by a Trusted_Script as the only extra binding, and SHALL take Legacy_Fn and Modern_Fn from them as `03-pbt-verifier` does (Requirements 4 and 5 of that spec).
10. THE Sandbox_Runner SHALL pass to each side a fresh copy of every input, built inside that side's Context from a Tagged_Value (Requirement 7), so that mutation of an input by one function affects neither the other function nor the generated value, and so that checks such as `input instanceof Array` behave as in a native runtime.

### Requirement 5: Resource limits and termination

**User Story:** As an operator, I want runaway code to be stopped and reported, so that one corpus cannot hang or exhaust the server.

#### Acceptance Criteria

1. THE Sandbox_Runner SHALL accept the Sandbox_Limits as optional options with these defaults and inclusive integer ranges: `wallClockTimeoutMs` 10000 (100 to 60000), `caseTimeoutMs` 1000 (1 to 10000), `compileTimeoutMs` 10000 (1000 to 30000), `maxOldGenerationSizeMb` 128 (32 to 512), `maxYoungGenerationSizeMb` 16 (8 to 64), `maxExternalMemoryMb` 256 (16 to 1024), `maxValueBytes` 65536 (1024 to 262144), `maxResultBytes` 524288 (4096 to 2097152), and `maxSourceBytes` 262144 (1024 to 1048576). IF a value is outside its range or is not an integer, THEN the run function SHALL return `ERROR` with `code` `INVALID_OPTIONS` before creating a Worker.
2. WHEN the combined UTF-8 length of any single code string (Legacy_Code, Modern_Code, or Test_Code) exceeds `maxSourceBytes`, THE run function SHALL return `ERROR` with `code` `INVALID_OPTIONS` before creating a Worker.
3. THE Exec_Worker SHALL run the whole property-mode check, or one case in cases mode, inside a `vm` call with a `timeout` option, so that synchronous loops and microtask loops (`microtaskMode` `afterEvaluate`) are interrupted. WHEN that timeout fires, the run SHALL return `ERROR` with `code` `SANDBOX_TIMEOUT` and a `message` that names the side (legacy, modern, or test) recorded by the progress marker of the Driver, or `unknown` if none was recorded.
4. THE host SHALL also start a wall-clock timer of `wallClockTimeoutMs` plus 2000 ms (the kill grace) for every run and SHALL call `terminate()` on the Worker when it fires, so that code the `vm` timeout cannot interrupt is still stopped. WHEN the host timer fires first, the run SHALL return `ERROR` with `code` `SANDBOX_TIMEOUT`.
5. THE host SHALL create the Exec_Worker with `resourceLimits` set from `maxOldGenerationSizeMb`, `maxYoungGenerationSizeMb`, and the Node.js default stack size. WHEN the Worker terminates because it reached its memory limit (error code `ERR_WORKER_OUT_OF_MEMORY`), the run SHALL return `ERROR` with `code` `SANDBOX_OUT_OF_MEMORY`.
6. BECAUSE `resourceLimits` do not cover external memory such as `ArrayBuffer` contents, THE host SHALL poll `process.memoryUsage().arrayBuffers` at an interval of at most 100 ms while a Worker runs, and SHALL terminate the Worker with result `SANDBOX_OUT_OF_MEMORY` when the value grows by more than `maxExternalMemoryMb` above the value measured before the Worker started. The design SHALL state that this check is best effort.
7. WHEN an Exec_Worker exits without sending a result and without any of the conditions above (an uncaught error, a non-zero exit code, or an error event), THE run SHALL return `ERROR` with `code` `SANDBOX_CRASH` and a `message` that contains no stack trace and no host path.
8. THE Exec_Worker SHALL send exactly one result message, a string. IF the string is longer than `maxResultBytes` (counted in UTF-8 bytes), or does not parse as the expected result shape, THEN the host SHALL discard it and return `ERROR` with `code` `OUTPUT_LIMIT_EXCEEDED` or `SANDBOX_CRASH` respectively. THE Exec_Worker SHALL also enforce `maxResultBytes` before sending.
9. WHEN a Trusted_Script encodes an outcome or a counterexample that exceeds `maxValueBytes` or a nesting depth of 256, THE run SHALL return `ERROR` with `code` `OUTPUT_LIMIT_EXCEEDED`. The encoder SHALL check the size while it writes, so that a huge value is rejected before it is fully built.
10. THE Compile_Worker SHALL run `compileModernCode` under `compileTimeoutMs` and a memory limit of 256 MB for the old generation, so that a pathological type-check cannot block the host. WHEN it exceeds the timeout, the run SHALL return `ERROR` with `code` `SANDBOX_TIMEOUT` and a `message` that states that the compile stage timed out.
11. THE Sandbox_Runner SHALL NOT block the host event loop while a Worker runs: it SHALL wait only on Worker events and timers.
12. THE host SHALL NOT start the Exec_Worker if the Compile_Worker returned an error. The run SHALL return the compile error and SHALL have created no Exec_Worker.

### Requirement 6: Denied capabilities and information leakage

**User Story:** As a maintainer, I want the untrusted code to see an environment with no filesystem, network, process, or environment access, so that a normal program has no way to touch the host.

#### Acceptance Criteria

1. THE Contexts SHALL expose only the ECMAScript built-in globals of a fresh `vm` context, minus `SharedArrayBuffer` and `Atomics`. They SHALL NOT define any Denied_Name or any timer, and WebAssembly compilation SHALL be disabled.
2. THE Contexts SHALL be created with dynamic code generation from strings (`eval`, `Function`, and the other function constructors) disabled by default. THE run options SHALL accept `allowDynamicCode` (boolean, default `false`); WHEN it is `true`, the Contexts SHALL allow `eval` and `Function`, and the isolation of criterion 1 SHALL NOT depend on the setting.
3. WHEN Untrusted_Code throws an `EvalError` while dynamic code is disabled, calls `import()`, attempts to compile WebAssembly, or throws a `ReferenceError` for a Denied_Name, THE Trusted_Scripts SHALL record a Forbidden_Capability with the capability name and the side, and the run SHALL return `ERROR` with `code` `SANDBOX_FORBIDDEN_CAPABILITY` and a `message` that names the capability and the side. THE Sandbox_Runner SHALL treat this classification as a best-effort report based on error names, codes, and identifiers, and SHALL NOT use it for any security decision.
4. THE Trusted_Scripts SHALL read no property other than `name` and `message` from a value thrown by Untrusted_Code and SHALL NOT read `stack`. They SHALL use `message` only to identify a Denied_Name in a `ReferenceError` (criterion 3) and to build the messages of criterion 5, and SHALL NOT include a thrown message in a result anywhere else.
5. WHEN Legacy_Code, Modern_Code, or Test_Code fails to load or throws outside an Entry_Function call, THE message of the `LEGACY_LOAD_ERROR`, `MODERN_LOAD_ERROR`, or `TEST_CODE_ERROR` result SHALL contain the error `name` and `message` produced by the code or by the JavaScript engine, truncated to 300 characters, and SHALL NOT contain a stack trace, a file path, or the code text.
6. THE Trusted_Scripts SHALL be the only code that serializes a result. A result SHALL be built from the Trusted_Scripts' own captured intrinsics, so that tampering with `Object.prototype`, `Array.prototype`, `JSON`, `Object.keys`, or `Function.prototype` by Untrusted_Code does not change the structure of the result or the verdict logic of the host.
7. THE host SHALL validate the shape of the Exec_Worker's result string (field names, types, and value ranges) before it builds a Sandbox_Result, and SHALL NOT forward any unvalidated field.
8. THE Sandbox_Runner SHALL NOT claim in any result field, message, or documentation that the Sandbox is secure, safe, or proven. It SHALL describe it as an isolation layer with documented limits.

### Requirement 7: Value serialization across the boundary

**User Story:** As a developer, I want a precise rule for which values cross the isolation boundary and what happens to the rest, so that no value silently changes meaning.

#### Acceptance Criteria

1. THE Sandbox_Runner SHALL move inputs into a Context and outcomes out of a Context only as Tagged_Value text (a JSON string), never as shared objects, `postMessage` structured clones of user values, or transferred buffers.
2. THE Tagged_Value format SHALL represent these values and no others: `undefined`, `null`, booleans, finite numbers, `NaN`, `+Infinity`, `-Infinity`, `-0`, strings, bigints, arrays (including holes), plain objects (own enumerable string keys), `Date` (including the invalid date), `RegExp` (source and flags), `Map`, `Set`, `Error` objects (name and message), and typed arrays.
3. WHEN the host encodes an input that contains a function, a symbol, a `WeakMap`, a `Promise`, a host-only object such as `URL`, or a symbol-keyed property value that is a function or symbol, THE Sandbox_Runner SHALL return `ERROR` with `code` `UNSUPPORTED_VALUE` and a `message` that names the kind of value and its path, and SHALL NOT create a Worker. Symbol keys with other values SHALL be ignored.
4. WHEN an input contains a reference cycle, THE host encoder SHALL return `UNSUPPORTED_VALUE` with the message `cyclic input`. WHEN an input contains the same object more than once without a cycle, THE encoder SHALL write each occurrence in full, so that sharing is not preserved and each copy is independent.
5. WHEN a function returns a value that contains a function or a symbol, THE Trusted_Script encoder SHALL encode it as the marker `{"$":"function"}` or `{"$":"symbol"}` that carries no further data. WHEN a returned value contains a reference cycle, THE encoder SHALL write a back-reference to the ancestor by depth, so that two structurally equal cyclic values have equal Canonical_Forms.
6. THE Tagged_Value of an object SHALL list keys in sorted code-unit order, and the Tagged_Value of a `Map` and a `Set` SHALL list entries in insertion order, so that the encoding is deterministic.
7. THE decoder SHALL build every value with the constructors of the Context in which it runs, and SHALL reject malformed text, unknown tags, and a nesting depth over 256 with `UNSUPPORTED_VALUE`.
8. THE decoder and the encoder SHALL NOT invoke a getter of a Tagged_Value it builds, SHALL NOT assign `__proto__`, and SHALL define properties with `Object.defineProperty` semantics, so that a key such as `__proto__` becomes an ordinary own property.
9. FOR ALL supported values `v`, decoding the encoding of `v` SHALL yield a value whose Canonical_Form equals the Canonical_Form of `v` (round trip), and a decoded copy SHALL be independent of the original.
10. THE README SHALL list the supported values, the rejected values, and the behavior of cycles and shared references.

### Requirement 8: Outcomes and equivalence inside the Sandbox

**User Story:** As a maintainer, I want the Sandbox to apply exactly the equivalence rules of the steering, so that a result means the same thing whether the code ran in-process or in the Sandbox.

#### Acceptance Criteria

1. WHEN a function call returns, THE Sandbox SHALL record an Outcome of kind `returned` with the Canonical_Form of the value. WHEN it throws, THE Sandbox SHALL record an Outcome of kind `threw` with the `name` of the thrown value if it is an object with a string `name`, and the string `non-error` otherwise.
2. THE Sandbox SHALL treat two Outcomes as Equivalent_Outcomes if and only if both are `returned` with equal Canonical_Forms, or both are `threw` with equal `name` values. A `returned` and a `threw` Outcome SHALL never be equivalent.
3. THE Canonical_Form SHALL make `NaN` equal to `NaN`, SHALL distinguish `+0` from `-0`, SHALL compare arrays, plain objects, `Date`, `RegExp`, `Map`, `Set`, typed arrays, and `Error` objects by structure without comparing prototypes, and SHALL compare a function or a symbol only by its type.
4. THE Sandbox SHALL NOT compare error messages or stack traces.
5. FOR ALL pairs of values generated from the supported types, the verdict "Canonical_Forms are equal" SHALL equal the verdict of the `deepEquivalent` function of the Verifier on the same pair, including pairs whose values were created in different Contexts.
6. THE Sandbox SHALL support only synchronous Entry_Functions. IF an Entry_Function returns a Promise, THEN the Sandbox SHALL treat it as an ordinary returned object, SHALL NOT await it, and SHALL encode it as a plain object.

### Requirement 9: Property mode

**User Story:** As a Route Handler author, I want to run the stored `pbt_test_code` for a user corpus and get the same result shape as for a sample corpus, so that the UI shows one kind of evidence.

#### Acceptance Criteria

1. THE options of `runSandboxedVerification` SHALL include `legacyCode`, `modernCode`, `entryFunction`, and `testCode`, and MAY include `numRuns`, `seed`, `allowDynamicCode`, and `limits`. THE function SHALL validate them with the rules of `03-pbt-verifier` Requirement 7 (`numRuns` an integer from 100 to 1000 with default 1000, `seed` a 32-bit signed integer with default `Date.now() | 0` on the host, `entryFunction` a valid identifier) and return `INVALID_OPTIONS` otherwise, without creating a Worker.
2. THE Sandbox_Runner SHALL implement the Test_Code_Contract of `database-and-exorcism.md` without extension: the Test_Code is the body of a function with the parameters `fc`, `legacyFn`, `modernFn`, `assertEquivalent`, and `numRuns`, and a `pbt_test_code` value that runs in the Verifier runs unchanged in the Sandbox.
3. THE Sandbox_Runner SHALL run `compileModernCode` in the Compile_Worker, then run the Exec_Worker. Inside the Driver_Context, it SHALL evaluate the bundled `fast-check`, compile the Test_Code as a function body, call it with the bundled `fc`, wrappers for the two Entry_Functions, `assertEquivalent`, and `numRuns`, and execute the returned property with `fc.check(property, { numRuns, seed })`. The Test_Code SHALL NOT control the run count or the seed.
4. THE injected `assertEquivalent(input)` SHALL give each side an independent copy of `input` built in that side's Context (Requirement 4 criterion 10), return `undefined` when the Outcomes are Equivalent_Outcomes, and throw an `Error` that states both Outcomes (kind, and value or error name, each truncated to 500 characters) when they are not.
5. WHEN `fc.check` reports success, THE Sandbox_Runner SHALL return `PASSED` with `totalRuns` equal to `numRuns`, the used `seed`, and `evidence` equal to the Verifier's `formatEvidence` text. WHEN it reports a failure caused by `assertEquivalent` or a predicate that returned `false`, the result SHALL be `FAILED` with a Counterexample bounded as in `03-pbt-verifier` Requirement 9 (`input` at most 2000 characters, outcomes at most 500 characters, `shrunk`).
6. IF the Test_Code has a syntax error, throws, does not return a `fast-check` property, or throws an error that does not come from `assertEquivalent` or from a call to an Entry_Function, THEN THE result SHALL be `ERROR` with `code` `TEST_CODE_ERROR`.
7. THE Sandbox_Runner SHALL support a property returned by `fc.asyncProperty` only if it settles within the evaluation (microtasks only). IF the property has not settled when the evaluation returns, THEN the result SHALL be `ERROR` with `code` `TEST_CODE_ERROR` and a `message` that states that asynchronous work outside microtasks is not supported.
8. FOR ALL option sets with the same code, Entry_Function name, Test_Code, `numRuns`, and an explicit `seed`, THE Sandbox_Runner SHALL return a result with the same `status`, `totalRuns`, and `counterexample.input` (determinism).
9. FOR ALL pure sample functions that the Verifier accepts, THE Sandbox_Runner SHALL return the same `status`, `totalRuns`, and `counterexample.input` as the Verifier for the same code, Test_Code, `numRuns`, and `seed` (parity).
10. THE evidence text SHALL describe a result as Empirical_Evidence with the exact number of generated inputs, SHALL NOT contain a Forbidden_Phrase, and SHALL be produced only for `PASSED` and `FAILED` results.

### Requirement 10: Cases mode

**User Story:** As a developer, I want to run both functions on explicit inputs and see one outcome per input, so that I can inspect a difference or probe a corpus without writing a property.

#### Acceptance Criteria

1. THE options of `runSandboxedCases` SHALL include `legacyCode`, `modernCode`, `entryFunction`, and `inputs` (an array of 1 to 1000 values), and MAY include `allowDynamicCode` and `limits`.
2. IF `inputs` has fewer than 1 or more than 1000 entries, or the combined Tagged_Value text of all inputs exceeds `maxResultBytes`, THEN THE function SHALL return `ERROR` with `code` `INVALID_OPTIONS`. IF an input is not encodable, it SHALL return `UNSUPPORTED_VALUE` (Requirement 7), and in both cases it SHALL create no Worker.
3. WHEN the run completes, THE function SHALL return `{ status: 'COMPLETED', executor, executionTimeMs, cases }` where `cases` has one entry per input in input order, each with `equivalent` (boolean), `legacy` and `modern` (each `{ kind: 'returned', rendered }` with `rendered` at most 200 characters, or `{ kind: 'threw', name }`). THE result of this mode SHALL NOT contain `evidence` text, because a list of cases is not a verification.
4. THE Exec_Worker SHALL run each side of each case in its own `vm` call with `caseTimeoutMs` as the `timeout`. IF a call times out, THEN the whole run SHALL return `ERROR` with `code` `SANDBOX_TIMEOUT` and the index of the case in the `message`.
5. FOR ALL permutations of `inputs`, THE outcome of each input SHALL be the same as in the original order (case independence), because each case decodes its own copies.
6. THE cases mode SHALL apply Requirements 3, 4, 5, 6, 7, and 8 in the same way as property mode, including the Gate when called through `verifyLive`.

### Requirement 11: Threat model and documentation

**User Story:** As a reviewer, I want an honest statement of what the Sandbox does and does not protect against, so that nobody enables it on a false assumption.

#### Acceptance Criteria

1. THE package `README.md` and the design SHALL contain a Threat_Model with these parts: the assets, the attacker, the layers that are implemented and what each one addresses, the list of things the Sandbox does not protect against, and recommended future hardening.
2. THE Threat_Model SHALL state that the Sandbox runs in the same OS process as the web server, that `node:vm` is documented as not a security mechanism, that a Worker thread is not an OS-level sandbox, and that an escape from the JavaScript engine would give the attacker the privileges of the server process, including its files, network, and environment.
3. THE Threat_Model SHALL list at least these uncovered items: engine and Node.js vulnerabilities; side channels (timing and contention); CPU and external-memory exhaustion that happens faster than the polling interval; the forging or manipulation of the verdict by the code's own author; denial of service by many requests (the quota belongs to `05-llm-pipeline-api`); and Node.js permission model limits (no network scope in Node.js 24, no inheritance to Worker threads as documented).
4. THE Threat_Model SHALL recommend, as future hardening before exposing the feature to untrusted audiences: a separate OS process or container with no secrets in its environment, a read-only filesystem, no network namespace, CPU and memory cgroup limits, a non-root user, and ideally a microVM or an external execution service; and, for the process that hosts the Sandbox, the Node.js `--permission` flag.
5. THE README SHALL state that user-code execution is off by default and name the `Gate_Config` field that enables it.
6. THE README and every result SHALL describe outcomes as Empirical_Evidence and SHALL NOT contain a Forbidden_Phrase or an absolute claim of security.

### Requirement 12: Self tests and adversarial tests

**User Story:** As a maintainer, I want tests that attack the Sandbox and say honestly what they do not cover, so that a green test run means something specific.

#### Acceptance Criteria

1. WHEN `pnpm test` runs, THE Sandbox_Runner SHALL execute its Vitest tests in single-run mode and SHALL exit with a non-zero code if at least one test fails. THE tests SHALL complete in less than 120 seconds on a machine that meets the Node.js `>=24` requirement.
2. THE tests SHALL include an adversarial corpus of hostile snippets, each run as Legacy_Code, as Modern_Code, and as Test_Code where applicable, with `allowDynamicCode` both `false` and `true`: an infinite loop at load time and at call time; `while(true)` inside a callback passed to `Array.prototype.map`; a promise-callback infinite loop; a memory allocation bomb on the heap; a string-doubling bomb; an `ArrayBuffer` allocation too large for the engine; a very large returned string and a very deep returned value; attempts to reach `process`, `require`, `module`, `fetch`, the host global object, `this`, `constructor.constructor`, `Function`, `eval`, and `import()`; a `setTimeout` or `setInterval` callback that would outlive the run; prototype tampering of `Object`, `Array`, `Function`, and `JSON` intrinsics; an `Error.prepareStackTrace` and `Error.captureStackTrace` call-site attack; and a mutation of the input.
3. FOR EACH hostile snippet, THE tests SHALL assert the expected result code of the design's table, that the call returns within the wall-clock limit plus the kill grace, that no Worker created by the run remains alive afterwards, and that the Lease is released.
4. THE tests SHALL assert that a run with hostile code does not change the host: the values of the host `process.env`, of `Object.prototype`, and of `globalThis` keys (compared before and after) are unchanged, and that the host event loop stays responsive during the run (a timer scheduled before the run fires within 250 ms of its due time).
5. THE tests SHALL include the correctness properties of the design: the codec round trip, the agreement of the Canonical_Form with the Verifier's `deepEquivalent`, the Gate truth table, Lease conservation, seed determinism, parity with the Verifier, case independence, and result hygiene (JSON-serializable, no stack trace or path, no Forbidden_Phrase).
6. THE tests SHALL run the three fixtures of `03-pbt-verifier` (`es3`, `es5-jquery`, `legacy-node`, read from `packages/pbt-verifier/test/fixtures/` as text) through property mode and assert `PASSED` with `totalRuns` equal to the requested `numRuns`.
7. THE test documentation (a section of the README and a comment block in the corpus file) SHALL state which escape classes the tests do not cover: engine-level vulnerabilities, native addons, side channels, rapid external-memory exhaustion, escapes that depend on a specific Node.js or V8 patch version, and the behavior on operating systems other than the one the tests ran on.

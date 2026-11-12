# Implementation Plan

## Overview

This plan builds `packages/sandbox-runner` (`@lazarus/sandbox-runner`) as described in `design.md`: a policy gate with concurrency leases, a Worker-based sandbox with fresh `node:vm` contexts, a string-based value codec with a canonical form, a property mode that runs the stored Test_Code with a bundled `fast-check` inside the sandbox, a cases mode, an adversarial test corpus, and a README with an honest threat model. The order is: scaffolding and toolchain checks; types and options; gate; codec; host supervisor; worker bootstrap and Trusted_Scripts; compile stage; property mode; cases mode; the `verifyLive` facade; adversarial tests; README; final checkpoint.

## Preconditions

- `01-lazarus-foundation` is implemented (root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, ESLint config, `vitest.shared.ts`).
- `03-pbt-verifier` is implemented. At the time of writing, `packages/pbt-verifier` does not exist. If it is still missing when this plan starts, stop and ask the user (Open Items A3).
- Node.js `>=24` and `pnpm` are installed.
- Before using an API of `fast-check`, `typescript`, `esbuild`, or `node:worker_threads` / `node:vm`, check the documentation for the installed version (see `tech.md`). Do not invent options.

## Scope and conventions

- Work only inside `packages/sandbox-runner/`, with one exception: task 1.3 adds an additive subpath export to `packages/pbt-verifier`. The lockfile update from `pnpm install` is also allowed. Nothing under `.kiro/specs/05-llm-pipeline-api/`, `.kiro/specs/06-resurrection-ui/`, `apps/web`, or `db/` is changed.
- All code, comments, test names, messages, and docs are in English. No explicit `any`. The package reads no environment variable and writes nothing to stdout or stderr.
- Every test name starts with `R<n>.<m>` for the requirement and criterion it verifies. Every property test is one `fc.assert(fc.property(...))` with an explicit `numRuns`, and its `it` body starts with `// Feature: 07-sandboxed-execution, Property <N>: <title>` (or `Supporting check: <title>`), with `<N>` from 1 to 10 as numbered in `design.md`.
- Tests that start Workers use small limits (`wallClockTimeoutMs` 300 to 500, `maxOldGenerationSizeMb` 32) so the whole suite stays below 120 seconds.
- Never describe results as a proof. The words listed as Forbidden_Phrases do not appear in code, tests, messages, or docs (except inside the sanitizer's own test data).
- Mark nothing as done until the task's checks pass.

## Tasks

- [x] 1. Scaffold the package and confirm the toolchain
  - [x] 1.1 Create the package files
    - Create `packages/sandbox-runner/package.json` (`@lazarus/sandbox-runner`, `private`, `type: module`, `engines.node >=24`, scripts `build`, `test` = `vitest run`, `lint`, `exports` and `types` pointing at `dist/`), `tsconfig.json` extending the root base, `vitest.config.ts` extending the root shared config, an empty `src/index.ts`, and a placeholder `scripts/build-worker.mjs`
    - Dependencies: `@lazarus/pbt-verifier` (workspace), `fast-check@^4`; devDependencies: `esbuild`, `vitest`, `typescript@^6`, `@types/node`
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.9_
  - [x] 1.2 Install and check the toolchain assumptions
    - Run `pnpm install`; confirm `typescript` resolves to 6.x and `fast-check` to 4.x
    - Spike (throwaway scripts, not committed): (a) `esbuild` bundles `fast-check` to a single IIFE with no Node built-in imports and the bundle runs in a `vm` context created with `codeGeneration.strings: false`; (b) `vm.createContext(vm.constants.DONT_CONTEXTIFY, { microtaskMode: 'afterEvaluate', codeGeneration: { strings: false, wasm: false } })` is accepted and `Error.prepareStackTrace` can be redefined as non-configurable. Write the result of each check in the task notes; if (a) fails, stop and ask the user which fallback of Open Item O1 to take
    - Task notes (spike run on Node.js v26.13.0, esbuild 0.28.2, fast-check 4.10.2, typescript 6.0.3):
      - (a) `esbuild` bundles `fast-check` to one IIFE (about 379 KB) that references no Node.js built-in. It runs in a context created with `codeGeneration.strings: false`: a passing property, a failing property with shrinking, `fc.anything()`, and an `fc.asyncProperty` that settles by microtasks all work, and `eval` throws `EvalError`. One difference from Open Item O1: the bundle reads the free names `setTimeout` and `clearTimeout` when it loads. The build wraps the bundle in a function that declares both as local stubs that throw, so the context still defines no timer (Requirement 6.1). No fallback of O1 is needed.
      - (b) `vm.createContext(vm.constants.DONT_CONTEXTIFY, { microtaskMode: 'afterEvaluate', codeGeneration: { strings: false, wasm: false } })` is accepted, and `Error.prepareStackTrace` can be redefined as non-writable and non-configurable (a later `defineProperty` throws `TypeError`). This confirms Open Items O2 and O6.
      - `pnpm install` exits with code 1 when a dependency has an install script that is neither allowed nor denied. `esbuild` has one, so `pnpm-workspace.yaml` now denies it (`allowBuilds: esbuild: false`). `esbuild` works without that script. This is one root-file change outside the scope paragraph.
      - The package has a `turbo.json` that makes `test` depend on its own `build`, because the tests start real Workers from `dist/worker/`.
    - _Requirements: 1.5, 4.5, 4.8_
  - [x] 1.3 Add the additive export to `packages/pbt-verifier`
    - Add a subpath export (for example `@lazarus/pbt-verifier/shared`) that re-exports `compileModernCode(source, entryFunction)`, `sanitizeResult`, `formatEvidence`, `deepEquivalent`, and the result types from existing modules. Extract `compileModernCode` from the existing modern loader without changing its behavior
    - Run the Verifier's own tests and confirm they pass unchanged
    - _Requirements: 1.8_

- [x] 2. Checkpoint - Scaffolding builds, lints, and tests
  - Run `pnpm exec turbo run build lint test --filter=@lazarus/sandbox-runner --filter=@lazarus/pbt-verifier` and confirm exit code 0.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Types, option validation, and limits
  - [x] 3.1 Write `src/types.ts`
    - `Origin`, `Caller`, `GateConfig`, `DenialReason`, `SandboxLimits`, `SandboxVerifyOptions`, `LiveRequest`, `SandboxErrorCode`, `SharedErrorCode`, `Executor`, `SandboxResult`, `CaseOutcome`, `CasesResult`, as in the design
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [x] 3.2 Write `src/options.ts`
    - Validate `numRuns` (100 to 1000, default 1000), `seed` (32-bit signed integer, default `Date.now() | 0`), `entryFunction` (identifier, not reserved), `allowDynamicCode`, every `SandboxLimits` field against its range, and the byte length of each code string against `maxSourceBytes`. Return a resolved options object or an `INVALID_OPTIONS` result. Never throw
    - _Requirements: 5.1, 5.2, 9.1_
  - [x] 3.3 Write option tests
    - Example tests for each range boundary (lowest, highest, one outside), non-integers, defaults, oversized sources, invalid identifiers; assert no Worker is created (injectable spawn spy)
    - _Requirements: 5.1, 5.2, 9.1_

- [x] 4. Live-execution gate
  - [x] 4.1 Write `src/gate/policy.ts`
    - `decideLiveExecution(request, config)`: pure, checks in the order of Requirement 3.8, default config with `userExecutionEnabled: false` and `allowAnonymousSampleRuns: false`, no environment access
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  - [x] 4.2 Write `src/gate/gate.ts`
    - `createLiveExecutionGate(config)` with `acquire(request)`: policy first, then an atomic per-user and global counter check; idempotent `lease.release()`; validate `perUserConcurrency` and `globalConcurrency` as integers >= 1
    - _Requirements: 3.9, 3.10, 3.11, 3.12_
  - [x] 4.3 Write gate tests
    - Property test (design Property 3, gate truth table): for generated requests and configs, the decision equals a table-driven oracle; an anonymous caller never gets `sandbox`; `origin: 'user'` never gets `in-process`; malformed requests give `INVALID_REQUEST`
    - Property test (design Property 4, lease conservation): for generated sequences of acquire and release (including double release), active leases never exceed the limits and return to 0
    - Example tests: each denial reason with the minimal request that triggers it; the order of checks when several fail
    - _Requirements: 3.1 to 3.11_

- [x] 5. Value codec
  - [x] 5.1 Write `src/host/tagged-value.ts`
    - Host encoder for inputs following the table in the design: reject functions, symbols, `WeakMap`, `Promise`, host-only objects, and cycles with `UNSUPPORTED_VALUE` and a path; expand shared references; ignore symbol-keyed non-function values; enforce depth 256 and `maxValueBytes`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_
  - [x] 5.2 Write the Trusted_Scripts `prelude.js` and `codec.js`
    - Plain ES2022 text files with no imports. `prelude.js`: capture intrinsics in closures, delete `SharedArrayBuffer` and `Atomics`, lock `Error.prepareStackTrace`, bind nothing else. `codec.js`: `encode` and `decode` with incremental size and depth counters, sorted keys, ancestor back-references for cycles, markers for functions and symbols, `Object.defineProperty` for properties, no getter calls, no `__proto__` assignment, decoding with the constructors of the running context
    - _Requirements: 4.7, 4.8, 5.9, 7.5, 7.6, 7.7, 7.8, 8.3_
  - [x] 5.3 Write codec tests (evaluate the scripts in a plain `vm` context in the test)
    - Property test (design Property 1, round trip): `canonical(decode(encode(v))) === canonical(v)` for generated supported values, and mutating the decoded copy never changes the original; include `-0`, `NaN`, holes, nested `Map`/`Set`, `__proto__` keys
    - Property test (design Property 2, agreement with the Verifier): for generated pairs of supported values, equal Canonical_Forms iff `deepEquivalent`, including pairs built in different contexts and the cases `+0` vs `-0`, `NaN` vs `NaN`, shared vs duplicated references
    - Example tests: unsupported input kinds and cyclic input give `UNSUPPORTED_VALUE` with a path; an output cycle encodes as a back-reference and two equal cyclic outputs have equal forms; an oversized or too-deep output is rejected while writing; malformed text and unknown tags are rejected by the decoder
    - _Requirements: 7.1 to 7.9, 8.3, 8.5, 5.9_

- [x] 6. Host supervisor
  - [x] 6.1 Write `src/host/supervisor.ts`
    - `spawnRun(entry, data, limits)` as in the design: Worker options (`env: {}`, `argv: []`, `execArgv: []`, captured and drained stdio, `resourceLimits`, primitive-only `workerData`), kill timer, memory watchdog on `process.memoryUsage().arrayBuffers`, first-settlement-wins, `terminate()` on every path with a 1000 ms wait, a live-Worker counter exposed for tests only, and no blocking of the event loop
    - _Requirements: 4.1, 4.2, 4.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.11_
  - [x] 6.2 Write `src/host/result-parser.ts`
    - Check the UTF-8 byte length against `maxResultBytes`, parse JSON, validate the exact field names, types, and ranges per result kind, drop unknown fields, map failures to `OUTPUT_LIMIT_EXCEEDED` or `SANDBOX_CRASH`
    - _Requirements: 5.8, 6.7_
  - [x] 6.3 Write supervisor tests with tiny fixture worker entries (not user code)
    - Cases: normal message, timeout (`SANDBOX_TIMEOUT`), heap limit (`SANDBOX_OUT_OF_MEMORY`, confirms Open Item O4), external-memory watchdog, uncaught error and non-zero exit (`SANDBOX_CRASH`), oversized result (`OUTPUT_LIMIT_EXCEEDED`), malformed result, a worker that floods stdout, a second message after the first. In every case assert the Worker is terminated, the live-Worker counter returns to its start value, and the Worker was created with an empty `env` and no inherited `execArgv`
    - Task notes (Node.js v26.13.0):
      - Open Item O4 is confirmed: a Worker that reaches its heap limit ends with `ERR_WORKER_OUT_OF_MEMORY` on the `error` event, and the run reports `SANDBOX_OUT_OF_MEMORY`.
      - Open Item O5, measured: `process.memoryUsage().arrayBuffers` read on the host covers only the host thread. It stayed flat (0 MB) while a Worker held 192 MB of `ArrayBuffer` contents, so the watchdog of Requirement 5 criterion 6 never fired as written. The supervisor uses the per-Worker signal that O5 allows instead: it polls `worker.getHeapStatistics()` every 100 ms and compares `external_memory` with `maxExternalMemoryMb`. The call answered while the Worker ran a busy loop. The check is still best effort. Requirement 5 criterion 6 and the supervisor section of `design.md` name the old API and need the same amendment once the user agrees.
      - Task 3.3 stays open until task 10.2, which adds the assertion that an options failure creates no Worker (the supervisor counts created Workers for that).
    - _Requirements: 4.1, 4.2, 4.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.11, 6.7_

- [x] 7. Checkpoint - Gate, codec, and supervisor
  - Run `pnpm --filter @lazarus/sandbox-runner lint` and `pnpm --filter @lazarus/sandbox-runner test`; confirm exit code 0.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Worker bootstrap and Trusted_Scripts
  - [x] 8.1 Write the Trusted_Script `side.js`
    - Side adapter: decode input into a fresh copy, call the Entry_Function in `try/catch`, return the Canonical_Form of the outcome; read only `name` (and `message` for classification) of thrown values and never `stack`; classify Forbidden_Capabilities (`EvalError` while dynamic code is off, `ReferenceError` naming a Denied_Name, WebAssembly `CompileError`); bind the entry point under a per-run random, non-enumerable, non-writable global name; renderer for the `rendered` text of cases mode
    - _Requirements: 4.7, 4.10, 6.3, 6.4, 8.1, 8.2, 8.4, 8.6_
  - [x] 8.2 Write the Trusted_Script `driver.js`
    - Bundled `fast-check` (from the build), `legacyFn`, `modernFn`, `assertEquivalent` (same text input to both adapters, string comparison, `EquivalenceError` with rendered outcomes truncated to 500 characters, progress state with the last difference and `fc.stringify` input truncated to 2000 characters), the `fc.check(property, { numRuns, seed })` runner, and result classification as in the design
    - _Requirements: 9.3, 9.4, 9.5, 9.6_
  - [x] 8.3 Write `src/worker/exec-entry.ts` (strict ES module; imports only `node:vm` and `node:worker_threads`)
    - Property and cases bootstraps from the design: three or two contexts created with `DONT_CONTEXTIFY`, `microtaskMode: 'afterEvaluate'`, `codeGeneration` from `allowDynamicCode`, no `importModuleDynamically`; Trusted_Scripts first, then Untrusted_Code under per-phase `timeout = min(remaining budget, phase cap)`; Test_Code compiled with `vm.Script`; only strings, numbers, and booleans cross from the Worker realm; `unhandledRejection` handler that records only the dynamic-import code; progress marker read after a timeout; result length check before `postMessage`
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.9, 4.10, 5.3, 5.9, 6.1, 6.2, 6.6, 8.6, 9.7, 10.4_
  - [x] 8.4 Write the build script `scripts/build-worker.mjs`
    - Bundle `exec-entry.ts` and `compile-entry.ts` to `dist/worker/` with `esbuild`; embed the Trusted_Scripts and the `fast-check` IIFE as text constants so the Worker reads no file; make `pnpm build` run it after `tsc`
    - Task notes (Node.js v26.13.0):
      - Open Item O7 is confirmed: a dynamic `import()` in a context without a loader returns a promise that rejects with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. The rejection reaches the `unhandledRejection` handler of the bootstrap as an Error of the Worker realm and does not end the Worker. The handler reads `code` only from an Error of its own realm, so a value rejected by untrusted code is never inspected.
      - The error of a `vm` timeout is not an Error of the Worker realm, so it cannot be told apart from a look-alike thrown by untrusted code by its type. The bootstrap recognizes a timeout by the elapsed time and reads nothing from the thrown value.
      - A fresh context carries a `console` object, although the design says it exposes only the ECMAScript built-ins. `console` is a Denied_Name, so `prelude.js` deletes it together with `SharedArrayBuffer` and `Atomics`.
      - The Trusted_Scripts are fragments that the bootstrap joins inside one function body per context, so they share closures and add nothing to the global object except the one entry point.
      - The Test_Code is compiled with `vm.compileFunction` and `parsingContext`, so a body cannot close the wrapper function early. The text is first parsed as a script only to report the engine's syntax message.
      - The Compile_Worker entry is emitted by `tsc` and is not bundled, because the TypeScript compiler must find its library files in `node_modules`.
    - _Requirements: 1.5_
  - [x] 8.5 Write bootstrap invariant tests (run through the real Worker)
    - Untrusted probe code reports `typeof` of every Denied_Name, `SharedArrayBuffer`, `Atomics`, `WebAssembly.compile`, `import()`, `eval`, and `Function` under both `allowDynamicCode` values; a probe checks that no value reachable from the globals has a Worker-realm prototype (compare `Object.getPrototypeOf` chains with the context's own intrinsics); the prelude lock of `Error.prepareStackTrace` holds; the bootstrap file is an ES module and begins with strict semantics; a source scan asserts that `src/worker/**` and the Trusted_Scripts import no `node:fs`, `node:net`, `node:http(s)`, `node:child_process`, and that the whole package contains no `process.env` read and no `console` call
    - _Requirements: 1.7, 4.4, 4.5, 4.6, 4.7, 4.8, 6.1, 6.2_

- [x] 9. Compile stage
  - [x] 9.1 Write `src/worker/compile-entry.ts` and `src/host/compile-stage.ts`
    - Compile_Worker runs `compileModernCode` from `@lazarus/pbt-verifier` under `compileTimeoutMs` and a 256 MB old-generation limit, posts `{ ok, js }` or `{ ok: false, code, message }`; the host maps a compile error to `MODERN_COMPILE_ERROR` and a timeout to `SANDBOX_TIMEOUT` (message names the compile stage); no Exec_Worker is created after a compile error
    - _Requirements: 5.10, 5.12, 9.3_
  - [x] 9.2 Write compile-stage tests
    - A type error and an `import` give `MODERN_COMPILE_ERROR` with no Exec_Worker created (spawn spy); a pathological recursive type with a short `compileTimeoutMs` gives `SANDBOX_TIMEOUT` and the Compile_Worker is terminated
    - _Requirements: 5.10, 5.12_

- [x] 10. Property mode
  - [x] 10.1 Write `src/property-mode.ts`
    - `runSandboxedVerification`: options validation (no Worker on failure), host input checks, Compile_Worker, Exec_Worker, result parsing, `formatEvidence` for `PASSED` and `FAILED`, `executor: 'sandbox-worker'`, `executionTimeMs` from `performance.now()` clamped to at least 1, `sanitizeResult` on every result, one `try/catch` returning `INTERNAL_ERROR`; messages bounded to 500 characters
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 2.8, 6.4, 6.5, 6.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.10_
  - [x] 10.2 Write property-mode tests
    - Property test (design Property 5, seed determinism) for an equivalent and a differing pair with at least two seeds
    - Property test (design Property 6, parity with the Verifier) for pure function templates with an equivalent or differing modern version: same `status`, `totalRuns`, and `counterexample.input` as `verifyTestCode` with `origin: 'sample'`
    - Property test (design Property 10, evidence text): `evidence` equals `formatEvidence(result)` and contains no Forbidden_Phrase, including when legacy code throws an error whose message contains one
    - Example tests: each Test_Code error (syntax error, throw, returns a number, unrelated throw), an async property that settles by microtasks and one that does not, a timeout during shrinking returning `FAILED` with the smallest recorded counterexample, a Test_Code written in the Foundation seed style running unchanged, load errors with `name: message` and no stack or path, `UNSUPPORTED_VALUE` for a generator that yields a function
    - Run the three Verifier fixtures with `numRuns: 1000` and assert `PASSED`
    - _Requirements: 2.8, 6.5, 9.2, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 12.6_

- [x] 11. Cases mode
  - [x] 11.1 Write `src/cases-mode.ts`
    - `runSandboxedCases`: validate 1 to 1000 inputs and total encoded size, host-encode all inputs before any Worker, run the per-case loop with `caseTimeoutMs`, return one entry per input with `equivalent`, `legacy`, and `modern`, no `evidence` field, and the case index in a timeout message
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_
  - [x] 11.2 Write cases-mode tests
    - Property test (design Property 8, case independence): for generated input lists and a generated permutation, each input has the same outcome
    - Example tests: bounds of `inputs`, unsupported input creating no Worker, per-case timeout naming the index, a function that throws on some inputs, result has no `evidence`
    - Task notes:
      - Case independence (Requirement 10 criterion 5, Property 8) holds because each case decodes its own copy of the input. The two contexts live for the whole run, as the design states, so a legacy function that keeps state in module-level variables can still return a value that depends on earlier cases. The property test uses a function that mutates its input and records what it saw, but whose return value does not read that record. Criterion 5 needs the words "for functions that keep no state between calls", or the design needs a fresh pair of contexts per case.
      - A run whose time budget ends while the Trusted_Scripts are still being evaluated (seen on a busy host with a 500 ms limit) is reported as `SANDBOX_TIMEOUT` with side `unknown`.
      - The `vm` timer can fire a fraction of a millisecond before the measured limit. The bootstrap allows a tolerance of 5 percent of the limit (at least 2 ms) when it recognizes a timeout by elapsed time.
    - _Requirements: 10.1 to 10.6_

- [x] 12. The `verifyLive` facade
  - [x] 12.1 Write `src/live.ts` and `src/index.ts`
    - `verifyLive(request, gate)`: acquire, map denial to `LIVE_EXECUTION_DENIED` with `executor: 'none'`, route `in-process` to the Verifier's `verifyTestCode({ origin: 'sample' })`, route `sandbox` to `runSandboxedVerification`, release the Lease in `finally`, return `SANDBOX_UNAVAILABLE` when the worker files cannot be loaded, never fall back to in-process for `user`, one `try/catch` returning `INTERNAL_ERROR`. Export only the public API and types
    - _Requirements: 2.1, 2.4, 3.10, 3.13, 3.14_
  - [x] 12.2 Write facade tests
    - A denied request creates no Worker and evaluates no code (use a legacy source with a syntax error and assert no `LEGACY_LOAD_ERROR`); the Lease is released after success, timeout, crash, and internal error; a missing worker file gives `SANDBOX_UNAVAILABLE` and the in-process executor is not called; `sample` origin goes in-process and `user` origin never does
    - _Requirements: 3.10, 3.13, 3.14_

- [x] 13. Adversarial tests
  - [x] 13.1 Write the hostile corpus `test/corpus/hostile.ts`
    - Entries H1 to H23 from the design, each with its role (legacy, modern, test), expected result for `allowDynamicCode` false and true, and a comment block that lists the escape classes the corpus does not cover
    - _Requirements: 12.2, 12.7_
  - [x] 13.2 Write the adversarial tests
    - For every entry and setting: assert the expected result code, that the call returns within `wallClockTimeoutMs` plus the kill grace plus a margin, that the live-Worker counter returns to its start value, and that the Lease is released; around each run compare the host `process.env` snapshot, `Object.prototype` keys, and `Object.keys(globalThis)` before and after, and check that a 250 ms timer fires on time
    - Property test (design Property 9, termination and cleanup) sampling corpus entries with `fc.constantFrom`
    - Property test (design Property 7, result hygiene) over arbitrary option objects and corpus entries: JSON-serializable, no stack trace or host path pattern, no Forbidden_Phrase, `message` at most 500 characters
    - Task notes (Windows, Node.js v26.13.0), where a measured result differs from the table in `design.md`:
      - H4: a promise callback that loops is interrupted when it is queued at load time or by an async property. When the Entry_Function queues it, the callback never runs, because the microtask queue of that context is not drained again; the run ends with a normal verdict.
      - H7: `new ArrayBuffer(2 ** 40)` ended in `SANDBOX_OUT_OF_MEMORY` on this machine, not in a `RangeError` outcome. The corpus accepts both.
      - H19: every stack overflow takes a few milliseconds, so 200 calls do not fit in a 400 ms limit and end in `SANDBOX_TIMEOUT`. With a larger limit both sides throw `RangeError` and the result is `PASSED`, as the table says.
      - H22: replacing `fc.check` has no effect, because the driver captured it first. A property that never compares the two functions still passes; that is the documented limit on verdict integrity.
      - Found while writing the corpus: the Compile_Worker used the caller's `maxExternalMemoryMb`. The compiler's own strings count as external memory, so a 16 MB limit made every compile fail with `SANDBOX_OUT_OF_MEMORY`. The compile stage now has its own fixed limit of 1,024 MB.
    - _Requirements: 2.4, 2.5, 2.7, 2.8, 4.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.6, 12.2, 12.3, 12.4, 12.5_

- [x] 14. README, threat model, and wording checks
  - [x] 14.1 Write `packages/sandbox-runner/README.md`
    - Sections: Overview (defense in depth, not an absolute claim), Usage (`verifyLive`, property mode, cases mode, one example each with `ok`/error handling), Gate and defaults (user execution off, name of the `userExecutionEnabled` field, anonymous denial, per-process concurrency limits), Limits table with defaults and ranges, Supported and rejected values (cycles, shared references, functions, symbols), Error codes, Threat_Model (assets, attacker, layers, not covered, future hardening, same-process warning, verdict-integrity limit), Escape classes the tests do not cover, Verified facts and Open Items pointer
    - _Requirements: 3.12, 7.10, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.7_
  - [x] 14.2 Write the README and wording tests
    - The README contains each required section and each required uncovered item; states that user execution is off by default and names the config field; states the per-process limit; contains no Forbidden_Phrase and no absolute security claim (a fixed word list including "secure", "safe", "unbreakable", "impenetrable" is checked only outside negations or quotations, so keep the list short and review hits by hand); no source file, message template, or fixture contains a Forbidden_Phrase except the sanitizer test data
    - _Requirements: 6.8, 11.1 to 11.6_

- [x] 15. Final checkpoint
  - Run `pnpm lint`, `pnpm build`, and `pnpm test` from the repository root and confirm exit code 0 for all three. Confirm the package suite finishes in less than 120 seconds.
  - Re-read Requirements 1 to 12 and confirm every criterion maps to a completed task or test; list any criterion that could not be verified.
  - Confirm with `git status` that no file outside `packages/sandbox-runner/` changed, apart from the additive export of task 1.3 and the lockfile, and that `.kiro/specs/05-llm-pipeline-api/` and `.kiro/specs/06-resurrection-ui/` are untouched.
  - Remind the user of the manual steps: decide the Gate defaults (Open Items D1 to D4); the kill switch is `LAZARUS_SANDBOX_KILL_SWITCH`, read by `08-live-verification-api`, and keep `userExecutionEnabled` off until the hardening in the design is in place.
  - Task notes (Windows, Node.js v26.13.0, pnpm 12.18.0):
    - `pnpm lint` exits with code 0 (5 tasks). `pnpm build` exits with code 0 (4 tasks).
    - `pnpm test`: every workspace package passes (7 Turborepo tasks; `@lazarus/sandbox-runner` 253 tests in about 60 seconds, `@lazarus/pbt-verifier` 216 tests unchanged). The root run exits with code 1 because of one test outside this spec, `db/tests/migration-runner.test.ts` R6.1. That test starts `pnpm` with a PATH made of a temporary directory, the directory of the Node.js binary, and the system directory. On this machine `pnpm` was installed with `npm install -g` (Node.js 26 ships no Corepack), so it is in the npm global directory and the test cannot find it. The test fails the same way with the `pnpm-workspace.yaml` of `develop`.
    - Files changed outside `packages/sandbox-runner/`: the additive export of task 1.3 (`packages/pbt-verifier/package.json`, `src/shared.ts`, and the extraction in `src/sandbox/modern-loader.ts`), `pnpm-lock.yaml`, `pnpm-workspace.yaml` (see task 1.2), and this file. Nothing under `.kiro/specs/05-llm-pipeline-api/`, `.kiro/specs/06-resurrection-ui/`, `apps/web`, or `db/` changed.
    - Criteria that are met with a difference from their wording, for the user to review: Requirement 5 criterion 6 (the watchdog reads the Worker's heap statistics, not the host value it names); Requirement 6 criterion 3 (a dynamic `import()` seen during the check is reported without one side, because the rejection arrives after the call); Requirement 7 criterion 5 against the design table (the markers are `function` and `symbol`, as the requirement says); Requirement 10 criterion 5 (holds for functions that keep no state between calls); Requirement 11 criterion 3 names `05-llm-pipeline-api` as the owner of the quota, while the design names `08-live-verification-api` (the README follows the design). `design.md` and `requirements.md` were not edited.
  - _Requirements: 1.4, 1.5, 12.1_

## Notes

- Each task references the requirements it traces. Property tasks name the design property and the requirements it validates.
- Open Items O1 to O7 in `design.md` are checks to run during implementation; tasks 1.2, 6.3, 8.5, and 10.2 carry the first ones. Record any result that differs from the design in the task notes and update the design before continuing.
- This plan does not change the HTTP behavior of `05-llm-pipeline-api`. Wiring `verifyLive` into a Route Handler (`POST /api/verify`) is a task of `08-live-verification-api`; 05 stays unchanged and never calls it.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1", "5.1", "5.2"] },
    { "id": 4, "tasks": ["3.3", "4.2", "5.3", "6.1", "8.1"] },
    { "id": 5, "tasks": ["4.3", "6.2", "8.2", "9.1"] },
    { "id": 6, "tasks": ["6.3", "8.3", "9.2"] },
    { "id": 7, "tasks": ["8.4", "10.1", "11.1"] },
    { "id": 8, "tasks": ["8.5", "10.2", "11.2", "12.1"] },
    { "id": 9, "tasks": ["12.2", "13.1"] },
    { "id": 10, "tasks": ["13.2", "14.1"] },
    { "id": 11, "tasks": ["14.2"] }
  ]
}
```

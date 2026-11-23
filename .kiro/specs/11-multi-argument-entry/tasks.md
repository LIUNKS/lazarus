# Implementation Plan

## Preconditions

- Specs 03, 05, 07, and 08 are implemented.

## Scope and conventions

- Files of other specs: only those listed in `design.md`. Every change is additive.
- No new dependency, route, migration, or UI change.
- Tests follow `testing-conventions.md`; test names start with `R<n>.<m>`; property tests carry `// Feature: 11-multi-argument-entry, Property <N>: <title>`.

## Tasks

- [x] 1. Verifier: spreading call, `assertEquivalentArgs`, and the arity guard
  - `context.ts`, `sides.ts`, `run-state.ts`, `execute.ts`, `prepare.ts`, `verify-test-code.ts`
  - `test/multi-argument.test.ts` (properties 1 to 3 and the examples)
  - `pnpm --filter @lazarus/pbt-verifier test` and `lint`
  - _Requirements: 1.1 to 1.5, 2.1, 2.2_
- [x] 2. Sandbox_Runner: `apply` and `arity` in the Side_Adapter, the helper and the guard in the Driver_Context
  - `prelude.js`, `side.js`, `driver.js`, `exec-entry.ts`
  - `test/multi-argument.test.ts` (properties 1 to 3 and the non-array example)
  - `pnpm --filter @lazarus/sandbox-runner build`, `test`, and `lint`
  - _Requirements: 1.1 to 1.5, 2.1, 2.2_
- [x] 3. Web app: prompt, Static_Gate rule, and reincarnate wiring
  - `prompts.ts`, `static-gate.ts`, `routes/reincarnate.ts`
  - `static-gate.multi-argument.test.ts` (property 4), prompt and route examples
  - `pnpm --filter @lazarus/web test` and `lint`
  - _Requirements: 3.1 to 3.5_
- [x] 4. Documentation
  - `.kiro/steering/database-and-exorcism.md`, `packages/pbt-verifier/README.md`, `packages/sandbox-runner/README.md`, `README.md`
  - _Requirements: 4.1 to 4.3_
- [x] 5. Checkpoint: `pnpm exec turbo run build lint test --filter=@lazarus/pbt-verifier --filter=@lazarus/sandbox-runner --filter=@lazarus/web`
  - Result with `--concurrency=1`: exit 0, 10 of 10 Turborepo tasks; pbt-verifier 224 tests, sandbox-runner 259, web 1,201, all passed.
  - With the default concurrency on the OneDrive working copy, two runs each failed a different set of time-limited tests (verifier fixtures with 1,000 inputs in the first run; `verify.wiring.test.ts` and a 30 s timeout in `persistence.test.ts` in the second). Every one of them passes when run alone. Not yet checked: whether the same happens without this spec's changes, and on the CI runner.

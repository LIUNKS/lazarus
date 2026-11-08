# Implementation Plan: Live Verification API

## Overview

This plan implements `POST /api/verify` in `apps/web` and the code around it, as described in `design.md`: the kill switch and execution flag, the verification quota (migration `V4`), the wiring of `@lazarus/sandbox-runner` and its Gate, and the persistence of a completed result into `public.reincarnations` and the corpse `status`. Work goes bottom up: pure modules first (so their property tests run early), then the migration and its database-gated tests, then the store and sandbox seams, then the handler and route, then boundary checks, the build check, and the README.

## Preconditions

- `01-lazarus-foundation`, `03-pbt-verifier`, `04-web-shell-auth`, `05-llm-pipeline-api` (including migration `V3` and its shared modules), and `07-sandboxed-execution` (`packages/sandbox-runner`, built to `dist/`) are implemented. If any of them is missing when this plan starts, stop and ask the user. The names of the 05 modules used here (`preflight`, `jsonResponse`, `resolveAccess`, `verificationOf`, `evidenceOf`, `createSupabaseStore`, `PipelineStore`, `StoreError`, the `MemoryStore`, and the guards) come from the 05 design. If the implemented names differ, adapt the imports and note the difference in the task.
- Node.js `>=24`, `pnpm`, and (for the database-gated tests) a `TEST_DATABASE_URL` and the Flyway CLI.
- Before using an API of `@lazarus/sandbox-runner`, read its `README.md` and `dist/` type declarations (see `tech.md`: check the installed version instead of assuming).

## Scope and conventions

- Work only on the files in the allowed list of Requirement 12 criterion 5. Do not change `packages/`, migrations `V1` to `V3`, the 05 routes, or any `06-resurrection-ui` file. Do not edit `.kiro/specs/04`, `05`, `06`, or `07`.
- Run tests with `vitest run` only, never in watch mode. Every `fc.assert` gets an explicit `numRuns`. The first line of each property-based `it` body is `// Feature: 08-live-verification-api, Property <N>: <title>` (or `Supporting check: <title>`). Test names start with `R<n>.<m>` and include `Requirement <n>`.
- Pure modules start without `import 'server-only'`; every other module under `lib/verification/` and `env-server.ts` starts with it.
- Results are empirical evidence. No test name, message, fixture, or document in this plan's output contains a Forbidden_Phrase, except fixtures in tests whose name says they test the rejection of Forbidden_Phrases. All code, comments, and messages are English. No explicit `any`.
- Mark nothing as done until the task's checks pass.

## Tasks

- [ ] 1. Dependency, environment documentation, and test guards
  - [ ] 1.1 Add `@lazarus/sandbox-runner` to `apps/web`
    - Confirm that the preconditions hold. Add `@lazarus/sandbox-runner@workspace:*` under `dependencies` in `apps/web/package.json`. Do not add `@lazarus/pbt-verifier` to any section. Run `pnpm install`, then `pnpm --filter @lazarus/sandbox-runner build`, and confirm that `createLiveExecutionGate`, `verifyLive`, `LiveRequest`, and `SandboxResult` import in `apps/web`. Check in the package README and type declarations that the names and shapes match the design (`LiveRequest` fields, `GateConfig`, the `reason` of `LIVE_EXECUTION_DENIED`).
    - Confirm that `pnpm build` at the repository root builds `@lazarus/sandbox-runner` before `@lazarus/web` (the workspace dependency makes Turborepo's `^build` cover it). If not, add the dependency edge in `turbo.json` only if that is the sole way, and record it in the task notes.
    - _Requirements: 1.1, 12.5_
  - [ ] 1.2 Document the kill switch in `.env.example`
    - Verify the entry (the cross-spec consistency pass already added it; add it only if it is missing): a comment line directly above `LAZARUS_SANDBOX_KILL_SWITCH` that states its purpose (server-only emergency stop for live verification of user code) and its accepted values (`1` or `true` engages it; unset, `0`, or `false` leaves it off; any other value is treated as engaged), and the entry itself commented out with a leading `#` and a placeholder value of `0`. Do not touch any other line (another change may edit this file; re-read it immediately before editing). Add no `NEXT_PUBLIC_` variant.
    - _Requirements: 4.8, 12.5_
  - [ ] 1.3 Extend the Vitest guards for the kill switch
    - In `apps/web/test/setup/guards.ts` (from 05), add `LAZARUS_SANDBOX_KILL_SWITCH` to the set of variable names whose read fails a test unless the test set it explicitly. Keep every existing guard. Run the existing `apps/web` suite and confirm it stays green.
    - _Requirements: 11.13, 12.4_

- [ ] 2. Pure foundation modules
  - [ ] 2.1 Create `limits.ts` and `flags.ts` under `apps/web/src/lib/verification/`
    - `limits.ts` (pure): `VERIFICATION_LIMITS` exactly as in the design (`userQuota` 10 per 3,600 s, `globalQuota` 100 per 86,400 s, `numRuns` 1,000, `quotaCallTimeoutMs` 5,000, `busyRetryAfterSeconds` 15, `perUserConcurrency` 1, `globalConcurrency` 4).
    - `flags.ts` (pure): `export const USER_EXECUTION_ENABLED = false;` with the doc comment of the design (shipped `false`; flipping is a reviewed change made after the hardening in the 07 Threat_Model is judged adequate). The file reads no environment variable.
    - _Requirements: 4.1, 5.10, 6.2, 6.6_
  - [ ] 2.2 Write tests for the constants and the flag
    - File: `apps/web/src/lib/verification/limits.test.ts`. Assert the quota values and windows, that both windows are at most 86,400 s, that `numRuns` is an integer from 100 to 1,000, and that the busy retry-after is an integer from 1 to 86,400. In the same file assert that `USER_EXECUTION_ENABLED` equals a local constant `EXPECTED_USER_EXECUTION_ENABLED = false` (flipping the flag therefore needs an edit of both files, which a reviewer sees).
    - _Requirements: 4.1, 5.10, 6.2, 11.10_
  - [ ] 2.3 Create `apps/web/src/lib/env-server.ts`
    - Start with `import 'server-only'`. Export `KillSwitchState`, the pure `parseKillSwitch(raw)` (trim, lower-case; `1`/`true` gives `engaged`; `undefined`, empty, `0`, `false` gives `not-engaged`; anything else `invalid`), `readKillSwitch()` (the only place in `apps/web/src/` that references `process.env.LAZARUS_SANDBOX_KILL_SWITCH`), `ServerConfigProblem`, and `serverConfigProblems()` which returns `{ variable, reason: 'invalid' }` for an invalid value and never contains the value. Do not change `lib/env.ts`.
    - _Requirements: 1.5, 4.2, 4.3_
  - [ ] 2.4 Create `execution.ts` and write the kill switch property test
    - `execution.ts`: the pure `decideExecution(flag, state)` returning `{ enabled: true }` only for `(true, 'not-engaged')` and otherwise `{ enabled: false, reason }` with `flag-off`, `kill-switch`, or `kill-switch-invalid`; and `effectiveExecution()` which calls it with `USER_EXECUTION_ENABLED` and `readKillSwitch()`.
    - **Property 4: Kill switch and effective flag**
    - Files: `apps/web/src/lib/env-server.test.ts` and `apps/web/src/lib/verification/execution.test.ts`, `numRuns` 200. Generate strings with padding, mixed case, and arbitrary content; assert the three states against an oracle written in the test; assert the full truth table of `decideExecution`; assert that `invalid` never enables execution and that no problem entry or reason contains the supplied value.
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.6, 11.5**
  - [ ] 2.5 Create `errors.ts`
    - Pure. `VERIFY_ERROR_CODES` (the 18 codes of Requirement 9 criterion 1 with their statuses), `VerifyError` (code plus typed numeric details such as `retryAfterSeconds` and `limit`, and a short constant `detail` for the log), the message table of the design (messages of shared codes imported from 05's table; two verification-specific `RATE_LIMITED` texts; the five new messages), and `verifyErrorResponse(error)` built on `jsonResponse` of 05 (headers `Cache-Control: private, no-store` and JSON content type; `Retry-After` only for `RATE_LIMITED` and `VERIFICATION_BUSY`, clamped to an integer from 1 to 86,400). It reads nothing from a caught exception except the typed fields.
    - _Requirements: 2.3, 5.5, 5.6, 6.6, 9.1, 9.2, 9.3, 9.4_
  - [ ] 2.6 Write the property test for the envelope
    - **Property 9: Envelope and non-leakage** (pure part)
    - File: `apps/web/src/lib/verification/errors.test.ts`, `numRuns` 200. For every code and arbitrary retry-after, line, and detail values: status equals the table; body has exactly the keys `ok`, `error.code`, `error.message`; message is the fixed text, 1 to 200 ASCII characters, no Forbidden_Phrase, no stack-like text, path, or SQLSTATE; `Retry-After` appears only for the two 429 codes. Include an example asserting that the set of codes equals the list in Requirement 9 criterion 1 and that the five new codes are present.
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
  - [ ] 2.7 Create `classify.ts`
    - Pure and total: `classifySandboxResult(result)` returning the `Classification` of the design table, including the value checks of Requirement 7 criterion 3 (`PASSED`: integer `totalRuns` 100 to 1,000; `FAILED`: integer 1 to 1,000; `executionTimeMs` an integer of at least 0; a failed check gives `internal`). Unknown codes and malformed shapes give `internal`. The `detail` is a short constant (the Sandbox_Runner code or the denial reason), never the `message`.
    - _Requirements: 6.6, 6.7, 7.1, 7.2, 7.3, 7.4_
  - [ ] 2.8 Write the property test for the classification
    - **Property 5: Result classification** (pure part)
    - File: `apps/web/src/lib/verification/classify.test.ts`, `numRuns` 200. Generate results of every status and code with arbitrary `message`, `reason`, counts (including out-of-range and non-integer), and extra fields; assert totality (no throw), that `conclusive` appears only for `PASSED`/`FAILED` with valid values, and the exact mapping table. Add one example per Sandbox_Runner code of Requirement 7 criterion 4, per denial reason of Requirement 6 criterion 6, and for `SANDBOX_UNAVAILABLE`.
    - **Validates: Requirements 6.6, 6.7, 7.1, 7.2, 7.3, 7.4**
  - [ ] 2.9 Create `present.ts`
    - Pure. `verifyBody(source, row, corpse)` returning the success shape of Requirement 2 criterion 4 from a stored row, using `verificationOf` and `evidenceOf` of 05 for `verification` and `evidence`. It takes no Sandbox_Result.
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 10.1_
  - [ ] 2.10 Write the property test for the response shape
    - **Property 7: Response shape and wording**
    - File: `apps/web/src/lib/verification/present.test.ts`, `numRuns` 200. Rows with `pbt_passed` true/false/NULL and `total_runs` around 0, 100, 999, 1,000, and large values; assert the exact key sets, the `verification` mapping, the evidence string and its comma formatting, `null` evidence otherwise, the whole-word restrictions of Requirement 10 criterion 2 over all string values, and no Forbidden_Phrase.
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.7, 10.1, 10.2**

- [ ] 3. Checkpoint - Pure modules
  - Run `pnpm --filter @lazarus/web test`, `pnpm --filter @lazarus/web lint`, and confirm exit code 0 for both. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 1.8, 11.1_

- [ ] 4. Migration `V4` and database tests
  - [ ] 4.1 Write the ledger and the quota function in `db/migrations/V4__live_verification_support.sql`
    - Create `public.verification_usage_events` with its two indexes, enable RLS with no policy, revoke all privileges from `PUBLIC`, `anon`, and `authenticated`. Create `public.reserve_verification_run(integer, interval, integer, interval)` as `SECURITY DEFINER` with `SET search_path = ''`: copy the body of `reserve_llm_call` from `V3` and apply only the three differences listed in the design (no route argument or check, the new table, the advisory lock key `lazarus.reserve_verification_run`). Revoke `EXECUTE` from `PUBLIC` and `anon`, grant to `authenticated`. English comments only.
    - _Requirements: 5.3, 8.1, 8.2, 8.3, 8.4, 8.5, 8.10_
  - [ ] 4.2 Write `record_verification` in the same migration
    - As in the design: `SECURITY INVOKER`, `SET search_path = ''`, explicit errors for a null `auth.uid()` (`28000`) and for invalid arguments (`22023`: any NULL, negative `p_execution_time_ms`, `p_total_runs` above 1,000, below 100 for a pass, below 1 for a failure), the `UPDATE ... WHERE pbt_passed IS NULL`, the guarded corpse status update, and the result columns `was_updated`, `stored_passed`, `stored_total_runs`, `stored_execution_time_ms`, `corpse_status`. Revoke `EXECUTE` from `PUBLIC` and `anon`, grant to `authenticated`. End the file with `NOTIFY pgrst, 'reload schema';`. Do not modify or reference-drop any object of `V1` to `V3`, and define no policy on existing tables.
    - Apply with `pnpm db:migrate` against a scratch database and confirm it succeeds on the seeded schema.
    - _Requirements: 7.6, 8.6, 8.7, 8.8, 8.9, 8.10_
  - [ ] 4.3 Update the tests that assert the exact migration list
    - In `db/tests/config.test.ts` and `db/tests/migrations.test.ts` (as amended by 05), expect the files `V1`, `V2`, `V3__llm_pipeline_support.sql`, and `V4__live_verification_support.sql`, and four history rows (versions 1 to 4). Rename the pending-probe file used by `migrations.test.ts` from `V4__pending_probe.sql` to `V5__pending_probe.sql` so it stays higher than the real migrations. Keep every other assertion.
    - _Requirements: 8.12_
  - [ ] 4.4 Write the database-gated example tests
    - File: `db/tests/live-verification.test.ts`, skipped when `TEST_DATABASE_URL` is unset (same helper as `db/tests/llm-pipeline.test.ts`). Cover the list of Requirement 8 criterion 11: `anon` has no read, write, or execute access to any new object; `authenticated` cannot read or write the ledger; the 11th reservation in 60 minutes is denied with `user` and a retry-after from 1 to 3,600; 15 concurrent reservations by one user give exactly 10 allowed; the global limit (100) denies with `global`; denied and invalid calls insert nothing; users do not share counts; `record_verification` writes once, a second call returns `was_updated` false and keeps the first values, `RESURRECTED` and `FAILED` are set correctly and a terminal status is kept, each invalid argument raises, a sample and a foreign corpse are unchanged, two concurrent calls leave exactly one result. Test names start with `R8.11` and include `Requirement 8`.
    - _Requirements: 8.2, 8.5, 8.9, 8.11_
  - [ ] 4.5 Write the model-based property test for the quota function
    - **Property 10: Quota function matches a rolling-window model (database)**
    - File: `db/tests/live-verification.test.ts`, `numRuns` 100. Each run opens a rolled-back transaction, seeds ledger rows of several users with chosen ages through the owner connection, calls the function as `authenticated`, and compares allowed flag, denying limit, row counts, retry-after (whole seconds, rounded up, clamped), cleanup of rows older than 24 hours, and per-user isolation with a reference model written in the test.
    - **Validates: Requirements 5.2, 5.4, 8.3, 8.4**
  - [ ] 4.6 Write the property test for `record_verification`
    - **Property 11: Verdict recording (database)**
    - File: `db/tests/live-verification.test.ts`, `numRuns` 100. Generate reincarnation relations (owned unverified, owned verified, sample, foreign, missing), corpse statuses, and argument tuples (valid and each kind of invalid); assert raise-and-no-change for invalid tuples, the update condition, the written values, the status rule, the second-call result, and the outcome of two concurrent calls.
    - **Validates: Requirements 7.6, 7.12, 8.7, 8.8, 8.9**

- [ ] 5. Checkpoint - Database
  - Run `pnpm test:db` with `TEST_DATABASE_URL` set and confirm exit code 0, including the amended migration-list tests. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 8.11, 8.12_

- [ ] 6. Store, sandbox seam, and test doubles
  - [ ] 6.1 Create `store.ts`
    - `VerificationStore`, `RecordInput`, `RecordResult`, and `createSupabaseVerificationStore(client)` as in the design: reads composed from `createSupabaseStore(client)` of 05; `reserveVerificationRun` calls `rpc('reserve_verification_run', ...)` with the constants of `limits.ts` as arguments and a 5,000 ms abort signal, reusing the verdict guard of 05's quota module (exactly one well-formed row, otherwise `QuotaUnavailable`); `recordVerification` calls `rpc('record_verification', ...)`, maps `was_updated` false to `{ wasUpdated: false }`, validates the returned row with runtime guards, and throws `StoreError` (safe detail only) on a database error or an unexpected shape. It creates no other client.
    - _Requirements: 1.4, 5.1, 5.7, 5.9, 5.10, 7.6_
  - [ ] 6.2 Write the store tests against the chainable fake client
    - File: `apps/web/src/lib/verification/store.test.ts` using `lib/testing/fake-client.ts` (it already supports `rpc`). Assert the RPC names and argument objects (the quota limits come from `limits.ts`), the guard accepting only a well-formed allow or deny, the 5,000 ms timeout path giving `QuotaUnavailable`, `was_updated` true and false mapping, and that a database error body never appears in the thrown error.
    - _Requirements: 5.1, 5.7, 5.10, 7.6, 7.9_
  - [ ] 6.3 Create `sandbox.ts` and `gate.ts`
    - `sandbox.ts`: `SandboxPort` and `createSandboxPort(gate)` whose `run(request)` calls `verifyLive(request, gate)`. This is the only file in `apps/web/src/` that imports `@lazarus/sandbox-runner`.
    - `gate.ts`: `getVerificationGate()`, a per-process singleton built with `createLiveExecutionGate({ userExecutionEnabled: effectiveExecution().enabled, allowAnonymousSampleRuns: false, perUserConcurrency, globalConcurrency })` from `limits.ts`. The route never releases a Lease. Add a comment that the counters are per process.
    - _Requirements: 1.3, 4.6, 6.4, 6.5, 6.9_
  - [ ] 6.4 Write the Gate configuration tests
    - File: `apps/web/src/lib/verification/gate.test.ts`. With the real Sandbox_Runner: a Gate built with the flag off returns `LIVE_EXECUTION_DENIED` with reason `USER_EXECUTION_DISABLED` for a `user` origin request whose code strings contain a syntax error (so a result of `LEGACY_LOAD_ERROR` would reveal that the code was parsed), and creates no Worker; an anonymous caller is denied; a non-owner is denied; with the test-only Gate enabled and `perUserConcurrency` 1, a second concurrent request is denied with `USER_CONCURRENCY_LIMIT`. The production `getVerificationGate()` is asserted only in the flag-off configuration.
    - _Requirements: 4.6, 6.4, 6.5, 6.6_
  - [ ] 6.5 Create the test doubles
    - `apps/web/src/lib/testing/memory-verification-store.ts`: implements `VerificationStore` over 05's `MemoryStore` for reads (same RLS-like visibility), scripted quota verdicts (`allowed`, `denied` by user or global, `error`, `malformed`), a `record` that enforces `pbt_passed IS NULL` and the status rule of the SQL function, scripted failures per method, a hook that inserts a competing verdict just before `record`, and a write log with kinds `quota.reserve` and `verification.record`.
    - `apps/web/src/lib/testing/mock-sandbox.ts`: a scripted `SandboxPort` that returns a queued `SandboxResult` per call and records every `LiveRequest`.
    - `apps/web/src/lib/testing/verification-arbitraries.ts`: `fast-check` generators for bodies, corpse and store states, Sandbox_Results, kill switch strings, and quota verdicts.
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 7. Handler, wrapper, and route
  - [ ] 7.1 Create `deps.ts` and `run-verify-route.ts`
    - `deps.ts`: `VerifyDeps` and `verificationDeps()` (session from `createClient()` and `getCurrentMember(client)` with `createSupabaseVerificationStore(client)`; `sandbox: createSandboxPort(getVerificationGate())`; `execution: effectiveExecution`; `randomSeed` from `crypto.getRandomValues` as a signed 32-bit integer; `now`; `log` writing one JSON line; `appOrigin: requestOrigin(request.headers)`).
    - `run-verify-route.ts`: records the start time, runs `preflight` of 05 (checks 1 to 5 in order), calls the handler, converts a thrown `VerifyError` to `verifyErrorResponse`, converts any other throw to `INTERNAL_ERROR` without rethrowing, and writes exactly one failure line `{ event: 'verification_error', route: 'verify', code, corpseId, elapsedMs, detail }` with `corpseId` null before the id is known. If 05's `runPipelineRoute` accepts a route name and an error table, use it instead and omit this file (design Open Item 4).
    - _Requirements: 1.6, 2.2, 2.3, 2.8, 9.2, 9.5, 9.7_
  - [ ] 7.2 Write `verify.ts`: access, precomputed, and stored paths
    - `handleVerify(request, deps)` through the wrapper. Steps 1 to 4 of the design sequence: `resolveAccess` of 05; sample returns `precomputed` or `NOT_PRECOMPUTED`; Visitor rules; owned corpse without a reincarnation gives `REINCARNATION_REQUIRED`; a Stored_Verdict returns `stored`. None of these paths reads the Kill_Switch (`deps.execution` is not called), reserves quota, calls the sandbox, or writes.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 3.12, 4.9_
  - [ ] 7.3 Write `verify.ts`: the execution path
    - Steps 5 to 13 of the design sequence: the enablement decision (`VERIFICATION_DISABLED` with the reason as log detail), `entryFunctionOf` from the Séance row (`SEANCE_REQUIRED`), the single quota reservation (`RATE_LIMITED` with `Retry-After`, `QUOTA_UNAVAILABLE`), the pure `liveRequest` builder (origin `user`, member caller, `corpusOwnerId`, code strings from the database, `numRuns` from `limits.ts`, seed from `deps.randomSeed`), exactly one `deps.sandbox.run`, the `verification_run` log line, classification and error mapping (`VERIFICATION_BUSY` with `Retry-After` 15, `VERIFICATION_DISABLED`, `SANDBOX_UNAVAILABLE`, `VERIFICATION_INCONCLUSIVE`, `INTERNAL_ERROR`), the single `recordVerification` call, and the three outcomes (`executed`, re-read to `stored`, `PERSISTENCE_FAILED`). The route does not abort on a client disconnect. No reservation is ever removed or compensated.
    - _Requirements: 3.8, 3.11, 4.5, 5.1, 5.5, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 9.6_
  - [ ] 7.4 Create the route file and extend the method guard
    - `apps/web/src/app/api/verify/route.ts` exactly as in the design (exports `POST`, `runtime`, `dynamic`, `maxDuration = 60`, nothing else). In `apps/web/src/proxy.ts` add `/api/verify` to the set of paths of the method guard of 05, and extend the proxy test of 05 so each of `GET`, `HEAD`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS` against `/api/verify` yields 405 with `Allow: POST`, the envelope, and the cache header.
    - _Requirements: 1.2, 2.1, 12.4_
  - [ ] 7.5 Write the property tests for gating, free paths, and access
    - **Property 1: Execution gating and call budget**; **Property 2: Free paths**; **Property 3: Access resolution**
    - Files: `verify.gating.test.ts`, `verify.free.test.ts`, `verify.access.test.ts` under `apps/web/src/lib/verification/`, `numRuns` 150 each, with the memory store and mock sandbox. Property 1 generates the full combination of Requirement 11 criterion 2 and asserts the sandbox, quota, and write counts and the code of the first failing guard. Property 2 asserts zero sandbox, quota, Kill_Switch, and write counts and identical bodies across flag and kill switch values. Property 3 asserts the identical `AUTH_REQUIRED` and `NOT_FOUND` bodies, the `precomputed` and `NOT_PRECOMPUTED` outcomes, and `INTERNAL_ERROR` when the session or corpse query throws.
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 4.5, 4.9, 5.1, 6.4, 11.2, 11.3**
  - [ ] 7.6 Write the property tests for persistence and quota handling
    - **Property 6: Persistence and race**; **Property 8: Quota verdict handling**; **Property 5: Result classification** (route part); **Property 9: Envelope and non-leakage** (route part)
    - Files: `verify.persist.test.ts`, `verify.quota.test.ts`, `verify.results.test.ts`, `run-verify-route.test.ts`, `numRuns` 150 each. Property 6 uses the competing-verdict hook and asserts one record call, the three outcomes, the status transitions, and no write that updates or deletes a verdict. Property 8 generates well-formed and malformed quota results and asserts the continue-or-stop rule, the clamped `Retry-After`, the message naming only the denying limit, and that no later failure removes the reservation. Property 5 (route part) asserts no `verification.record` write, unchanged status, a kept reservation, and no sandbox `message` or `code` in the body for every non-conclusive result. Property 9 (route part) puts sentinels in the sandbox message, database error text, code fixtures, and kill switch value and asserts they appear in no body or log line, and that exactly one failure log line is written per error response.
    - **Validates: Requirements 5.1, 5.5, 5.6, 5.7, 5.8, 6.6, 6.7, 7.1, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 9.5, 9.7, 11.7, 11.8**
  - [ ] 7.7 Write the example tests for the route
    - File: `apps/web/src/lib/verification/verify.examples.test.ts`. The Request_Body and header examples of Requirement 11 criterion 4 against the route (rejected examples yield 0 sandbox calls and 0 writes); one example per Sandbox_Runner result code, denial reason, and `SANDBOX_UNAVAILABLE` (Requirement 11 criterion 6) with status, code, writes, and reservation; the `verification_run` log line fields (including the seed and the user id, and no code or message text); the `entryFunctionOf` guard (missing Séance row, empty and non-string `entry_function`); that a passing run sets `RESURRECTED` and a failing run sets `FAILED`; and that every status and code produced is in the closed list.
    - _Requirements: 3.11, 6.3, 7.4, 7.7, 9.6, 11.4, 11.6, 11.7, 11.8_
  - [ ] 7.8 Write the wiring test with the real Sandbox_Runner
    - File: `apps/web/src/lib/verification/verify.wiring.test.ts`. Build a test-only Gate with `userExecutionEnabled: true`, run `handleVerify` with the memory store over the three seed fixtures (`es3`, `es5-jquery`, `legacy-node` from `db/seed/`, owned by a test Member), and assert `source` `executed`, `totalRuns` 1,000, `verification` `VERIFIED`, `evidence` with `1,000`, `corpse.status` `RESURRECTED`, and one `LiveRequest` with origin `user`. Add one differing-modern-code fixture that yields `FAILED` with `corpse.status` `FAILED` (a counterexample found, `totalRuns` from 1 to 1,000). The test fails with a clear message, and does not skip, when the Sandbox_Runner `dist/` is missing. Use a test timeout that keeps the file inside the 60,000 ms suite budget.
    - _Requirements: 6.1, 6.2, 6.4, 7.2, 7.7, 11.1, 11.9_

- [ ] 8. Boundary checks and build output
  - [ ] 8.1 Amend `apps/web/test/isolation.test.ts`
    - Extend the checks of 05 (keep all of them): the modules of `lib/verification/` and `env-server.ts` start with `import 'server-only'` unless pure; `@lazarus/sandbox-runner` is imported only in `src/lib/verification/sandbox.ts`; `LAZARUS_SANDBOX_KILL_SWITCH` appears only in `src/lib/env-server.ts` (and `LLM` names keep their 05 rule); `app/api` may contain `scan`, `seance`, `reincarnate`, and `verify`; no module under `lib/verification` or `env-server.ts` is reachable from a `'use client'` file; no `@lazarus/pbt-verifier`, `node:vm`, `node:child_process`, `eval`, or `new Function` in the Verification_API; no `SUPABASE_SERVICE_ROLE_KEY`; no explicit `any`. Keep the check that `apps/web/package.json` does not list `@lazarus/pbt-verifier`.
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9, 11.10, 12.4_
  - [ ] 8.2 Amend `apps/web/test/build-output.test.ts`
    - Add the name `LAZARUS_SANDBOX_KILL_SWITCH` and a sentinel value set in the build environment to the existing search lists, and assert that no emitted client file under `static/` contains the file name of a `lib/verification` module (for example `classify.ts`, `run-verify-route.ts`, `env-server.ts`).
    - _Requirements: 1.5, 12.4_
  - [ ] 8.3 Keep the Sandbox_Runner and its worker files in the server output
    - Read the Next.js docs for the installed version, then check on a production build (`pnpm --filter @lazarus/web build`) that `.next/server/app/api/verify/route.js.nft.json` lists the files under `packages/sandbox-runner/dist/` that the Worker needs (the worker entries and Trusted_Scripts). If it does not, add `@lazarus/sandbox-runner` to `serverExternalPackages` and `outputFileTracingIncludes` for `/api/verify` in `apps/web/next.config.ts`, keep every existing setting, and rebuild to confirm. Start the production server (`next start`) once with a scratch environment, send a request for a sample corpse, and record the result in the task notes. Do not enable the Execution_Flag.
    - _Requirements: 6.7, 12.5_
  - [ ] 8.4 Write the boundary and route-shape tests
    - File: `apps/web/test/verification-boundaries.test.ts`. The route file exports exactly `POST`, `runtime`, `dynamic`, and `maxDuration` (integer 60); the committed Execution_Flag equals the expected constant; no authored string in `lib/verification/` and `env-server.ts` contains a Forbidden_Phrase (use `containsForbiddenPhrase` of 05); the error code list in source equals Requirement 9 criterion 1. Test names include `Requirement 1`, `Requirement 4`, `Requirement 9`, or `Requirement 10`.
    - _Requirements: 1.2, 4.1, 9.1, 10.1, 11.10, 11.12_

- [ ] 9. Documentation
  - [ ] 9.1 Append the `## Verification API` section to `apps/web/README.md`
    - Append after the `## Pipeline API` section without altering existing content. Include: the route, the Request_Body, the success shape, the three Verify_Source values; the flow order of Requirement 3 criterion 8; the quota values (10 per user per rolling 60 minutes, 100 in total per rolling 24 hours) and the file `apps/web/src/lib/verification/limits.ts`; the execution switches (the constant `USER_EXECUTION_ENABLED` shipped as `false` and why flipping it is a deliberate, reviewed change that depends on the hardening in the 07 Threat_Model; the `LAZARUS_SANDBOX_KILL_SWITCH` values and the fail-closed rule for an invalid value); the per-process concurrency note; the limitations (a) to (g) of Requirement 10 criterion 3; the optional future hardening of Requirement 10 criterion 4 and why it is not in this spec; the statement that results are empirical evidence from randomly generated inputs with the exact run count; the reproduction steps of Requirement 12 criterion 3; and a table under the heading `### Verification error codes` with one English sentence per code.
    - _Requirements: 4.7, 6.3, 6.9, 10.3, 10.4, 10.5, 12.1, 12.2, 12.3_
  - [ ] 9.2 Write the README test
    - File: `apps/web/test/verification-readme.test.ts`. Parse the `### Verification error codes` table and assert the set equals the source code list; assert the presence of the quota values and file name, the flag and kill switch statements, the limitation statements (a) to (g), the reproduction steps, and the future-hardening paragraph; assert the pre-existing README sections (including `## Pipeline API` and its `### Error codes` table) are intact; assert no Forbidden_Phrase outside the glossary-style definition (the README does not need to contain that definition).
    - _Requirements: 10.1, 10.3, 10.4, 12.1, 12.2_

- [ ] 10. Final checkpoint
  - Run `pnpm lint`, `pnpm build`, and `pnpm test` from the repository root, and `pnpm test:db` with `TEST_DATABASE_URL`, and confirm exit code 0 for all. Confirm the Verification_API tests finish within 60,000 ms with 0 failed and 0 skipped tests.
  - Re-read Requirements 1 to 12 and confirm every criterion maps to a completed task or test; list any criterion that could not be verified.
  - Run `git status` and `git diff --stat` against the base revision and confirm every added or modified path is in the allowed list of Requirement 12 criterion 5, that nothing under `packages/`, `db/migrations/V1` to `V3`, the 05 routes, or `06-resurrection-ui` changed, and that `.kiro/specs/04` to `07` are untouched by this work.
  - Confirm `USER_EXECUTION_ENABLED` is still `false` and remind the user of the manual steps: decide whether and when to flip it (after the 07 hardening), set `LAZARUS_SANDBOX_KILL_SWITCH` in the deployment environment if needed, and resolve the Open Items of `design.md`.
  - _Requirements: 4.1, 10.5, 11.1, 11.11, 12.5, 12.6_

## Notes

- Each task references the requirements it traces. Property tasks name the design property and the requirements it validates.
- Property 5 and Property 9 each have a pure part (tasks 2.6 and 2.8) and a route part (task 7.6).
- Open Items 1 to 8 in `design.md` are decisions or checks for the user and for implementation time. Item 1 (the `total_runs` range for failures) affects task 4.2 and task 2.7; if the user chooses a different rule, change both and the matching requirement criteria together.
- This plan does not change the HTTP behavior of the 05 routes and does not add any control to the UI. Calling the route from the Laboratory panel is a task for `06-resurrection-ui`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.3", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5", "2.7", "2.9", "4.2"] },
    { "id": 3, "tasks": ["2.6", "2.8", "2.10", "4.3", "4.4"] },
    { "id": 4, "tasks": ["3", "4.5", "4.6", "6.1", "6.3"] },
    { "id": 5, "tasks": ["5", "6.2", "6.4", "6.5"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["7.3"] },
    { "id": 9, "tasks": ["7.4", "7.5", "7.6", "7.7", "7.8", "8.1", "8.2"] },
    { "id": 10, "tasks": ["8.3", "8.4", "9.1"] },
    { "id": 11, "tasks": ["9.2"] },
    { "id": 12, "tasks": ["10"] }
  ]
}
```

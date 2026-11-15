# Requirements Document

## Introduction

This spec adds the live verification route of Lazarus to `apps/web`: `POST /api/verify`. It owns the piece that sits between three other specs and that none of them owns:

- `05-llm-pipeline-api` generates and stores a reincarnation but never executes code, so it stores `pbt_passed`, `total_runs`, and `execution_time_ms` as NULL for user corpses.
- `07-sandboxed-execution` provides the isolated runner and its Gate (`verifyLive`) but defines no HTTP route, no persistence, no quota, and no database access.
- `06-resurrection-ui` shows a stored verification result but has no control that produces one.

This spec closes that gap with five things:

1. The route `POST /api/verify` (Requirement 2) and its access rules (Requirement 3).
2. The decision whether live execution is enabled: a reviewed constant in code plus an operator kill switch (Requirement 4).
3. A separate quota for verification runs (Requirement 5).
4. The wiring of `@lazarus/sandbox-runner` and its Gate into the Route Handler (Requirement 6).
5. Persistence of a completed result into `public.reincarnations` and the corpse `status` (Requirement 7), through migration `V4` (Requirement 8).

**Decisions made by this spec.**

- **Three result sources.** `precomputed` (stored result of a Sample_Corpse), `stored` (the owner's reincarnation already holds a conclusive result), and `executed` (a new sandbox run just produced the stored result). Visitors and Members get `precomputed` for samples at no cost. Only a Member who owns the corpse can cause an `executed` result.
- **Only a completed property run is conclusive.** A pass, or a counterexample found, is stored. A timeout, an out-of-memory stop, a forbidden capability, a crash, an output limit, an unsupported value, a compile failure, or a load failure is inconclusive: nothing is written and the corpse `status` stays as it was. The quota reservation is still kept.
- **A stored verdict is final.** A `VERIFIED` or `FAILED` result is never re-run, replaced, or regenerated in this spec.
- **Execution is off in the shipped code.** The effective flag is the reviewed constant `USER_EXECUTION_ENABLED` (shipped as `false`) AND the kill switch `LAZARUS_SANDBOX_KILL_SWITCH` not being engaged. A maintainer flips the constant in a code change after the hardening named in the Threat_Model of `07-sandboxed-execution` is judged adequate. Until then the route answers `VERIFICATION_DISABLED` for owned corpora, while sample and `stored` responses keep working.
- **Separate quota.** Verification runs use their own ledger and function (`verification_usage_events`, `reserve_verification_run`), mirroring the design of `llm_usage_events` and `reserve_llm_call` of `05-llm-pipeline-api`. Defaults: 10 runs per user per rolling 60 minutes and 100 runs in total per rolling 24 hours.
- **Fixed run parameters.** The run count is the constant 1,000 and never comes from the client. The seed is chosen by the server and logged, so a maintainer can reproduce a failure.
- **Writes are done by the database function under RLS.** `record_verification` is `SECURITY INVOKER`, so RLS decides who may write. No service role key is used.

**Honest limitations** (repeated in Requirement 10 and in the README): the verdict is visible only to the owner under RLS and is not an attestation. An owner with direct table access can write the same columns, because the owner UPDATE policy of the Foundation allows it. Hostile code can also influence the verdict of its own run (Threat_Model of `07-sandboxed-execution`). Results are empirical evidence with an exact run count, never a mathematical statement.

**Prerequisites.** `01-lazarus-foundation` (schema, RLS, samples), `03-pbt-verifier` (result types, evidence wording), `04-web-shell-auth` (session, `getCurrentMember()`, `Server_Client`, environment module), `05-llm-pipeline-api` (shared infrastructure, migration `V3`), and `07-sandboxed-execution` (`@lazarus/sandbox-runner`, built to `dist/`). `06-resurrection-ui` consumes the route but is not a prerequisite.

**Reuse of spec 05.** This spec does not repeat requirements of `05-llm-pipeline-api`. A reference such as "as Requirement 3 of 05" means the criterion applies to `/api/verify` unchanged, and only the differences are stated here.

**Changes outside `apps/web`.** One migration, `db/migrations/V4__live_verification_support.sql` (V3 is created by spec 05; V1 to V3 are never modified), and the matching tests under `db/tests/`. This amends the Foundation and 05 tests that assert the exact migration list.

**Out of scope.** Any screen or button that calls the route (`06-resurrection-ui`); re-running, regenerating, or deleting a stored verdict; storing or returning the seed or the counterexample; cases mode of the Sandbox_Runner; a service-role or signed-attestation hardening (described in Requirement 10 as future work); LLM calls; any change to `packages/`; any change to V1 to V3.

## Glossary

- **Verification_API**: The Route Handler `Verify_Route` and its modules under `apps/web/src/lib/verification/`. It is separate from the Pipeline_API of `05-llm-pipeline-api`.
- **Verify_Route**: The Route Handler `POST /api/verify`.
- **Pipeline_API**, **Error_Envelope**, **Request_Body**, **Target_Stack**, **Forbidden_Phrases**, **Test_Code_Contract**: As defined in `05-llm-pipeline-api`.
- **Web_App**, **Server_Client**, **Visitor**, **Member**, **Sample_Corpse**, **Owned_Corpse**, **Server_Only_Variables**: As defined in `04-web-shell-auth`. `getCurrentMember()` is the helper of that spec.
- **Sandbox_Runner**, **Gate**, **Lease**, **LiveRequest**, **Sandbox_Result**, **Denial reason**: As defined in `07-sandboxed-execution`. `verifyLive` and `createLiveExecutionGate` are its exports.
- **Verify_Source**: One of `precomputed`, `stored`, or `executed`.
- **Stored_Verdict**: A `reincarnations` row whose `pbt_passed` is not NULL.
- **Conclusive_Result**: A Sandbox_Result with `status` `PASSED` or `FAILED`.
- **Inconclusive_Outcome**: Any other Sandbox_Result, including every `ERROR`.
- **Verification_Ledger**: The table `public.verification_usage_events`, one row per reserved verification run.
- **Verification_Quota_Function**: The function `public.reserve_verification_run`, which checks both limits and records one Verification_Ledger row in one atomic step.
- **Record_Function**: The function `public.record_verification`, which stores a Conclusive_Result and the corpse status in one transaction.
- **User_Verification_Quota**: 10 reservations per user per rolling 60 minutes.
- **Global_Verification_Quota**: 100 reservations in total per rolling 24 hours.
- **Verification_Limits**: The constants of `apps/web/src/lib/verification/limits.ts`: the two quotas, `NUM_RUNS` (1,000), the quota call timeout (5,000 ms), the busy retry-after (15 s), the per-user concurrency (1), and the global concurrency (4).
- **Execution_Flag**: The boolean constant `USER_EXECUTION_ENABLED` in `apps/web/src/lib/verification/flags.ts`, shipped as `false`.
- **Kill_Switch**: The optional server-only environment variable `LAZARUS_SANDBOX_KILL_SWITCH`.
- **Kill_Switch_State**: One of `engaged`, `not-engaged`, or `invalid`, produced by `parseKillSwitch` (Requirement 4).
- **Effective_Execution_Flag**: True if and only if the Execution_Flag is true and the Kill_Switch_State is `not-engaged`.
- **Env_Server_Module**: `apps/web/src/lib/env-server.ts`, the server-side half of the environment module of `04-web-shell-auth` (`lib/env.ts` stays client-safe). It is the only file that reads the Kill_Switch.
- **Verification_Response**: The success body of Requirement 2.
- **Forbidden_Phrases**: The strings `100%`, `mathematical proof`, `mathematically proven`, and `guaranteed`, compared case-insensitively.

## Requirements

### Requirement 1: Dependencies, module layout, and boundaries

**User Story:** As a developer, I want the verification code isolated in server-only modules with one narrow door to the Sandbox_Runner, so that no key, flag, or code path can leak to a client bundle or bypass the Gate.

#### Acceptance Criteria

1. THE Web_App SHALL list `@lazarus/sandbox-runner` (workspace version) under `dependencies` in `apps/web/package.json`, and SHALL NOT list `@lazarus/pbt-verifier` in any dependency section, so that Requirement 1 criterion 1 of 05 and its isolation test stay valid.
2. THE Web_App SHALL place the Route Handler at `apps/web/src/app/api/verify/route.ts`, and the file SHALL export the function `POST`, the route segment options `runtime` set to `nodejs` and `dynamic` set to `force-dynamic`, and `maxDuration` with the integer value 60 (seconds, above the sum of the Sandbox_Runner default compile timeout, wall-clock timeout, and kill grace), and no other exports.
3. THE Verification_API SHALL keep its modules under `apps/web/src/lib/verification/`, SHALL make `import 'server-only'` the first import of every module there except a pure module (as defined in Requirement 1 criterion 3 of 05), and SHALL import `@lazarus/sandbox-runner` only in `apps/web/src/lib/verification/sandbox.ts`, so that a search of all other files under `apps/web/src/` finds zero import statements for that package.
4. THE Verification_API SHALL perform every database read and write through the Server_Client created for the current request, SHALL create no other database client, and SHALL contain zero references to `SUPABASE_SERVICE_ROLE_KEY`.
5. THE Verification_API SHALL read `LAZARUS_SANDBOX_KILL_SWITCH` only in the Env_Server_Module, so that a search of all other files under `apps/web/src/` finds zero references to that name, and the production client bundles SHALL contain zero occurrences of that name and of the value configured in the build environment.
6. THE Verification_API SHALL reuse the shared infrastructure of 05 by importing it (the request pre-checks, the JSON response builder, the access resolution, the origin helper, the `verification` and `evidence` formatting functions, the log writer, and the read methods of the store), and SHALL NOT copy those implementations. THE Verification_API SHALL keep its own error-code table and SHALL NOT modify `ERROR_CODES` or the error table of 05.
7. THE Verification_API SHALL NOT import `@lazarus/pbt-verifier`, `node:vm`, or `node:child_process`, SHALL contain no call to `eval` or `new Function`, and SHALL treat `original_code`, `modern_code`, and `pbt_test_code` only as strings that it passes to the Sandbox_Runner, so that it never parses, compiles, evaluates, or imports any part of them.
8. THE Verification_API SHALL contain zero explicit `any` type annotations, SHALL write all comments, messages, and documentation in English, and `pnpm lint` SHALL report zero errors for its files.
9. IF a Client Component (a file that starts with `'use client'`) imports, directly or through another module, a module under `apps/web/src/lib/verification/` or the Env_Server_Module, THEN `pnpm build` SHALL fail with an error that names the offending import.

### Requirement 2: Route contract and response shape

**User Story:** As a UI developer, I want `POST /api/verify` to follow the same HTTP conventions as the other pipeline routes and return one predictable success shape, so that the resurrection UI handles every outcome in the same way.

#### Acceptance Criteria

1. IF the HTTP method of a request to `/api/verify` is not `POST`, THEN THE Web_App SHALL respond with HTTP status 405, the header `Allow: POST`, and the Error_Envelope code `METHOD_NOT_ALLOWED`, by extending the method guard in `apps/web/src/proxy.ts` of 05 with the path `/api/verify`.
2. THE Verify_Route SHALL evaluate the checks of Requirement 3 criteria 2 to 5 of 05 (Origin, content type, the 1,024-byte body cap, and the Request_Body `{ "corpseId": "<uuid>" }`) in the order of Requirement 3 criterion 10 of 05, SHALL respond with the first failing check only, SHALL complete all of them before any database access, and SHALL accept no input other than `corpseId` (Requirement 3 criterion 9 of 05).
3. THE Verify_Route SHALL set `Cache-Control: private, no-store` and `Content-Type: application/json; charset=utf-8` on every response, including every error response.
4. WHEN a request succeeds, THE Verify_Route SHALL respond with HTTP status 200 and a JSON object with exactly the keys `ok` (true), `source` (a Verify_Source), `reincarnation` (an object with exactly the keys `id`, `targetStack`, `pbtPassed`, `totalRuns`, `executionTimeMs`, `verification`, and `evidence`), and `corpse` (an object with exactly the keys `id` and `status`).
5. THE Verify_Route SHALL take `pbtPassed`, `totalRuns`, and `executionTimeMs` from the stored row (never from the Sandbox_Result directly), and SHALL set `verification` and `evidence` exactly as Requirement 12 criteria 6 and 7 of 05 define them: `VERIFIED` when `pbt_passed` is true, `FAILED` when it is false, `NOT_RUN` when it is NULL; `evidence` is `Verified behavioral equivalence across N generated inputs.` with `N` equal to `total_runs` formatted with a comma as thousands separator when `verification` is `VERIFIED` and `total_runs` is not NULL, and `null` otherwise.
6. THE Verify_Route SHALL set `source` to `precomputed` for a Sample_Corpse, to `stored` when the Owned_Corpse already has a Stored_Verdict, and to `executed` only when a sandbox run of this request produced the stored result.
7. THE `corpse.status` of a success response SHALL be the corpse status as stored after the request, and SHALL be one of `INFECTED`, `IN_SEANCE`, `RESURRECTED`, and `FAILED`.
8. IF an exception occurs that no other requirement of this spec maps to an Error_Envelope code, THEN THE Verify_Route SHALL respond with HTTP status 500 and the code `INTERNAL_ERROR` and SHALL complete without rethrowing the exception.

### Requirement 3: Access rules and request flow

**User Story:** As a judge, I want the stored results of the sample corpses without signing in, and as a Member I want verification of my own corpse only, so that nobody can cause an execution or a write for a corpse they do not own.

#### Acceptance Criteria

1. THE Verify_Route SHALL determine the caller as a Visitor or a Member only with `getCurrentMember()` from verified Claims, and SHALL load the corpse by the `corpseId` with the Server_Client of the request, as Requirement 4 criteria 1 and 2 of 05 state.
2. WHEN the corpse is a Sample_Corpse, THE Verify_Route SHALL return the stored `reincarnations` row of that corpse with HTTP status 200 and `source` set to `precomputed`, for a Visitor and for a Member, without calling the Sandbox_Runner, without reserving quota, without reading the Kill_Switch, and without writing to the database.
3. IF the corpse is a Sample_Corpse and it has no stored `reincarnations` row, THEN THE Verify_Route SHALL respond with HTTP status 404 and the code `NOT_PRECOMPUTED`, with the same absence of side effects as criterion 2.
4. IF the caller is a Visitor and the corpse is not a visible Sample_Corpse (it does not exist or is not a sample), THEN THE Verify_Route SHALL respond with HTTP status 401 and the code `AUTH_REQUIRED`, with a byte-identical response body in both cases.
5. IF the caller is a Member and the query returns no corpse (it does not exist or belongs to another user), THEN THE Verify_Route SHALL respond with HTTP status 404 and the code `NOT_FOUND`, with a byte-identical response body in both cases.
6. FOR ALL requests made by a Visitor, whatever the body, THE Verify_Route SHALL make zero calls to the Sandbox_Runner, zero reservations of quota, zero reads of the Kill_Switch, and zero database writes, including when the body is rejected by Requirement 2.
7. IF `getCurrentMember()` or the corpse query raises an error that is not a "no rows" result, THEN THE Verify_Route SHALL respond with HTTP status 500 and the code `INTERNAL_ERROR`, and SHALL NOT call the Sandbox_Runner, reserve quota, or write to the database.
8. FOR an Owned_Corpse, THE Verify_Route SHALL evaluate these steps in this order and SHALL respond according to the first step that applies: (a) the caller is a verified Member; (b) the corpse is an Owned_Corpse; (c) the `reincarnations` row of the corpse exists; (d) the row is a Stored_Verdict; (e) verification is enabled (Requirement 4); (f) the entry function can be resolved (criterion 11); (g) the quota is reserved (Requirement 5); (h) the Gate grants a Lease and the sandbox run completes (Requirement 6); (i) the result is persisted (Requirement 7).
9. IF the Owned_Corpse has no `reincarnations` row, THEN THE Verify_Route SHALL respond with HTTP status 409 and the code `REINCARNATION_REQUIRED`, SHALL NOT read the Kill_Switch, reserve quota, or call the Sandbox_Runner, and SHALL write nothing.
10. WHEN the `reincarnations` row of the Owned_Corpse is a Stored_Verdict, THE Verify_Route SHALL respond with HTTP status 200, `source` set to `stored`, and the stored values unchanged, whether the verdict is `VERIFIED` or `FAILED`, without reading the Kill_Switch, reserving quota, calling the Sandbox_Runner, or writing to the database.
11. THE Verify_Route SHALL take the entry function name from the `entry_function` value of `invariants_json` of the stored `seance_specs` row of the corpse. IF that row does not exist, or `entry_function` is not a non-empty string, THEN THE Verify_Route SHALL respond with HTTP status 409 and the code `SEANCE_REQUIRED`, and SHALL NOT reserve quota, call the Sandbox_Runner, or write.
12. THE responses with `source` `precomputed` and `stored` SHALL NOT depend on the Execution_Flag, the Kill_Switch, the availability of the Sandbox_Runner, or the usage ledger, so that they are identical when the Kill_Switch is engaged.

### Requirement 4: Execution enablement and kill switch

**User Story:** As an operator, I want live execution of user code to be off in the shipped code and to have an emergency stop, so that enabling it is a deliberate, reviewed decision and disabling it needs no code change.

#### Acceptance Criteria

1. THE Verification_API SHALL define the Execution_Flag as an exported boolean constant `USER_EXECUTION_ENABLED` in `apps/web/src/lib/verification/flags.ts`, with the literal value `false` in the shipped code, and SHALL read it from no other source (no environment variable, no database value, no request value).
2. THE Env_Server_Module SHALL export `parseKillSwitch(raw)`, a pure function that returns `engaged` when the trimmed, case-insensitive value is `1` or `true`; `not-engaged` when the value is unset or the trimmed value is `0`, `false`, or an empty string; and `invalid` for any other value.
3. THE Env_Server_Module SHALL treat the state `invalid` as engaged for every decision (fail closed), and SHALL report it through its server-configuration problems list as `{ variable: 'LAZARUS_SANDBOX_KILL_SWITCH', reason: 'invalid' }` without including the value in the list, in any log line, in any response, or in any error object.
4. THE Effective_Execution_Flag SHALL be true if and only if the Execution_Flag is true and the Kill_Switch_State is `not-engaged`.
5. IF the Effective_Execution_Flag is false and the request reaches step (e) of Requirement 3 criterion 8, THEN THE Verify_Route SHALL respond with HTTP status 503 and the code `VERIFICATION_DISABLED`, SHALL NOT reserve quota, take a Lease, or call the Sandbox_Runner, and SHALL write nothing.
6. THE Verification_API SHALL create the Gate with `userExecutionEnabled` set to the Effective_Execution_Flag as computed when the Gate is created, `allowAnonymousSampleRuns` set to `false`, `perUserConcurrency` set to 1, and `globalConcurrency` set to 4 (the Verification_Limits), and SHALL still evaluate the Effective_Execution_Flag on every request before the quota step, so that engaging the Kill_Switch stops runs without a code change.
7. THE README section of Requirement 12 SHALL state that flipping `USER_EXECUTION_ENABLED` is a deliberate, reviewed code change that a maintainer makes only after the hardening recommended in the Threat_Model of `07-sandboxed-execution` is judged adequate, and SHALL document the Kill_Switch values of criterion 2.
8. THE file `.env.example` SHALL document `LAZARUS_SANDBOX_KILL_SWITCH` with a comment line directly above it that states its purpose and its accepted values, and SHALL NOT contain a variable named with the prefix `NEXT_PUBLIC_` followed by that name.
9. THE Verify_Route SHALL read the Kill_Switch only after step (d) of Requirement 3 criterion 8 has found no Stored_Verdict, so that Visitor, `precomputed`, and `stored` requests never read it.

### Requirement 5: Verification quota and abuse control

**User Story:** As an operator, I want a hard limit on verification runs per user and in total, so that one account cannot exhaust the CPU budget of the server.

#### Acceptance Criteria

1. WHEN a request has passed steps (a) to (f) of Requirement 3 criterion 8, THE Verify_Route SHALL call the Verification_Quota_Function exactly once, with the limits and windows of the Verification_Limits, SHALL wait for its result, and SHALL take a Lease and start the sandbox only after the function allowed the request.
2. THE Verification_Quota_Function SHALL allow a request if and only if the number of Verification_Ledger rows of the calling user created in the last 60 minutes is less than 10 and the number of rows of all users created in the last 24 hours is less than 100, both counted against the database clock at the time of the call, and SHALL record exactly one row in the same atomic step when it allows the request. The 10th run of a user in a window is allowed and the 11th is denied. The 100th run of all users in a window is allowed and the 101st is denied.
3. THE Verification_Quota_Function SHALL derive the user from `auth.uid()` and SHALL NOT accept a user id as an argument.
4. FOR ALL sets of concurrent calls, THE Verification_Quota_Function SHALL allow at most 10 reservations per user within any rolling 60 minutes and at most 100 in total within any rolling 24 hours (no oversubscription).
5. IF the Verification_Quota_Function denies the request, THEN THE Verify_Route SHALL respond with HTTP status 429 and the code `RATE_LIMITED` with the header `Retry-After` set to an integer from 1 to 86,400 (the time until the exceeded window drops below its limit, rounded up and clamped; the larger value when both limits are exceeded), SHALL NOT take a Lease or call the Sandbox_Runner, and SHALL NOT record a Verification_Ledger row for the denied request.
6. THE message of a `RATE_LIMITED` response of this route SHALL state whether the user limit or the global limit was reached, SHALL name verification runs and not generation requests, and SHALL NOT state any row count or user id.
7. IF the Verification_Quota_Function call returns an error, returns a value that is neither an allow nor a deny verdict, or returns no result within 5,000 ms, THEN THE Verify_Route SHALL respond with HTTP status 503 and the code `QUOTA_UNAVAILABLE`, SHALL NOT take a Lease or call the Sandbox_Runner (fail closed), and SHALL write nothing.
8. IF any outcome occurs after the Verification_Quota_Function allowed the request (a busy Gate, an unavailable Sandbox, an Inconclusive_Outcome, a persistence failure, an internal error, or a client disconnect), THEN THE Verify_Route SHALL keep the reservation and SHALL NOT delete, update, or compensate the Verification_Ledger row.
9. THE Verification_Ledger SHALL be separate from the Usage_Ledger of 05: a verification reservation SHALL NOT count toward the User_Quota or the Global_Quota of 05, and an LLM reservation SHALL NOT count toward the User_Verification_Quota or the Global_Verification_Quota.
10. THE limits (10, 60 minutes, 100, 24 hours) SHALL be constants in `apps/web/src/lib/verification/limits.ts`, and the Verification_Quota_Function SHALL receive them as arguments, so that a change needs no migration. Both windows SHALL be at most 24 hours, because the function deletes ledger rows older than 24 hours.

### Requirement 6: Sandbox wiring

**User Story:** As a maintainer, I want exactly one audited path from the Route Handler to the Sandbox_Runner, so that the Gate decides every run and no input comes from the client.

#### Acceptance Criteria

1. THE Verify_Route SHALL build the `LiveRequest` only from values it read from the database under RLS and from verified Claims: `origin` set to `user` (the corpse row has `is_sample` false), `caller` set to `{ kind: 'member', userId }` with the Member id, `corpusOwnerId` set to the `user_id` of the corpse row, `legacyCode` set to `original_code`, `modernCode` set to the stored `modern_code`, `testCode` set to the stored `pbt_test_code`, and `entryFunction` as in Requirement 3 criterion 11. It SHALL NOT take any of these values from the body, the query string, or a header.
2. THE Verify_Route SHALL set `numRuns` to the constant `NUM_RUNS` of the Verification_Limits (the integer 1,000, within the range 100 to 1,000), SHALL never take a run count from the client, SHALL leave `allowDynamicCode` at its default `false`, and SHALL pass no `limits` override, so that the Sandbox_Runner defaults apply.
3. THE Verify_Route SHALL choose the `seed` itself as a 32-bit signed integer from an injected random source, SHALL pass it explicitly, and SHALL write it to the server log line of Requirement 9 criterion 6, so that a maintainer can reproduce a run with the stored columns and the logged seed (a run with the same code, entry function, test code, `numRuns`, and seed gives the same status and counterexample input, as Requirement 9 criterion 8 of 07 states). THE seed SHALL NOT be stored in the database or returned in a response.
4. THE Verify_Route SHALL call `verifyLive` of the Sandbox_Runner exactly once per executed request, with the Gate of this process, SHALL NOT call `runSandboxedVerification` or any function of `@lazarus/pbt-verifier` directly, and SHALL NOT fall back to any in-process execution.
5. THE Verification_API SHALL create the Gate once per process in `apps/web/src/lib/verification/gate.ts` and SHALL NOT release a Lease itself, because `verifyLive` releases it on every path.
6. IF `verifyLive` returns `LIVE_EXECUTION_DENIED`, THEN THE Verify_Route SHALL respond as follows: reason `USER_EXECUTION_DISABLED` gives HTTP status 503 and `VERIFICATION_DISABLED`; reason `USER_CONCURRENCY_LIMIT` or `GLOBAL_CONCURRENCY_LIMIT` gives HTTP status 429, the code `VERIFICATION_BUSY`, and `Retry-After` set to the constant `BUSY_RETRY_AFTER_SECONDS` (15); every other reason gives HTTP status 500 and `INTERNAL_ERROR`. In every case it SHALL keep the quota reservation and write nothing else.
7. IF `verifyLive` returns `SANDBOX_UNAVAILABLE`, THEN THE Verify_Route SHALL respond with HTTP status 503 and the code `SANDBOX_UNAVAILABLE`, SHALL keep the reservation, and SHALL write nothing.
8. THE Verify_Route SHALL NOT abort a started sandbox run when the client disconnects, because the run is bounded by the Sandbox_Runner limits, and SHALL persist a Conclusive_Result even if the client has gone.
9. THE concurrency limits SHALL apply per server process, not across instances, and the README SHALL say so (Requirement 3 criterion 12 of 07).

### Requirement 7: Result handling and persistence

**User Story:** As a Member, I want a completed verification stored with an honest state, so that The Crypt shows evidence only when a property run actually finished.

#### Acceptance Criteria

1. THE Verify_Route SHALL treat a Sandbox_Result as a Conclusive_Result if and only if its `status` is `PASSED` or `FAILED`.
2. WHEN the result is `PASSED`, THE Verify_Route SHALL call the Record_Function with `p_passed` true, `p_total_runs` equal to the result `totalRuns`, and `p_execution_time_ms` equal to the result `executionTimeMs`. WHEN the result is `FAILED`, it SHALL call the Record_Function with `p_passed` false and the result `totalRuns` (the number of runs up to and including the first failing run, as Requirement 9 criterion 3 of 03 defines it) and `executionTimeMs`.
3. BEFORE calling the Record_Function, THE Verify_Route SHALL check that `totalRuns` is an integer from 100 to 1,000 for `PASSED` and from 1 to 1,000 for `FAILED`, and that `executionTimeMs` is an integer of at least 0. IF a check fails, THEN it SHALL respond with HTTP status 500 and the code `INTERNAL_ERROR` and SHALL write nothing.
4. IF the result is an Inconclusive_Outcome with a Sandbox_Runner code of `SANDBOX_TIMEOUT`, `SANDBOX_OUT_OF_MEMORY`, `SANDBOX_FORBIDDEN_CAPABILITY`, `SANDBOX_CRASH`, `OUTPUT_LIMIT_EXCEEDED`, `UNSUPPORTED_VALUE`, `MODERN_COMPILE_ERROR`, `LEGACY_LOAD_ERROR`, `ENTRY_FUNCTION_NOT_FOUND`, `MODERN_LOAD_ERROR`, or `TEST_CODE_ERROR`, THEN THE Verify_Route SHALL respond with HTTP status 422 and the code `VERIFICATION_INCONCLUSIVE`. IF the code is `INVALID_OPTIONS`, `INTERNAL_ERROR`, or not in the Sandbox_Runner list, THEN it SHALL respond with HTTP status 500 and `INTERNAL_ERROR`.
5. IF the result is an Inconclusive_Outcome, THEN THE Verify_Route SHALL NOT call the Record_Function, SHALL write nothing to any table, SHALL leave the corpse `status` unchanged, SHALL keep the quota reservation, and SHALL NOT include the Sandbox_Runner `message`, `code`, or any part of it in the response body.
6. WHEN the result is a Conclusive_Result and the checks of criterion 3 pass, THE Verify_Route SHALL call the Record_Function exactly once with the Server_Client of the request, and the function SHALL update the `reincarnations` row only where `pbt_passed` is NULL.
7. WHEN the Record_Function reports that it updated the row, THE Verify_Route SHALL respond with HTTP status 200, `source` set to `executed`, the written values, and `corpse.status` as returned by the function: `RESURRECTED` when `pbt_passed` is true and `FAILED` when it is false, unless the corpse status was already `RESURRECTED` or `FAILED`, in which case it is unchanged.
8. WHEN the Record_Function reports that it updated no row (another run recorded a verdict first, or the row is not writable), THE Verify_Route SHALL read the stored row with the Server_Client, SHALL respond with HTTP status 200 and `source` set to `stored` if that row is a Stored_Verdict, and SHALL otherwise respond with HTTP status 500 and the code `PERSISTENCE_FAILED`. It SHALL discard its own run result in both cases.
9. IF the Record_Function call returns a database error, THEN THE Verify_Route SHALL respond with HTTP status 500 and the code `PERSISTENCE_FAILED`, SHALL NOT return its run result, and SHALL keep the quota reservation.
10. THE Verification_API SHALL change the corpse `status` only through the Record_Function, and SHALL set `FAILED` only as the result of a Conclusive_Result with `status` `FAILED`. THE rule of Requirement 14 criterion 6 of 05 (no `FAILED` status from the Pipeline_API) is unchanged, because the Verification_API is not part of the Pipeline_API.
11. THE Verification_API SHALL NOT update or delete a Stored_Verdict, SHALL NOT re-run a corpse that has one, and SHALL NOT regenerate its reincarnation, so that a `VERIFIED` or `FAILED` result is final.
12. FOR ALL Owned_Corpses, WHEN two requests for the same corpse both run and both reach the Record_Function, THE `reincarnations` table SHALL hold the values of exactly one of the two results afterwards, and both requests SHALL respond with HTTP status 200 and the same stored values.

### Requirement 8: Database migration `V4`

**User Story:** As a maintainer, I want the new database objects defined by one reviewed Flyway migration with RLS, so that the quota and the one-verdict rule are enforced by the database.

#### Acceptance Criteria

1. THE migration `db/migrations/V4__live_verification_support.sql` SHALL create the table `public.verification_usage_events` with `id` (uuid, default `gen_random_uuid()`), `user_id` (uuid, NOT NULL, references `profiles(id)` with `ON DELETE CASCADE`), and `created_at` (timestamptz, NOT NULL, default `now()`), with an index on `(user_id, created_at)` and an index on `created_at`.
2. THE migration SHALL run `ENABLE ROW LEVEL SECURITY` on the table, SHALL define no policy for it, and SHALL revoke all table privileges on it from `PUBLIC`, `anon`, and `authenticated`.
3. THE migration SHALL create `public.reserve_verification_run(p_user_limit integer, p_user_window interval, p_global_limit integer, p_global_window interval)` as `SECURITY DEFINER` with a fixed `search_path`, returning the allowed flag (boolean), the denying limit (`user`, `global`, or `none`), and the retry-after seconds (integer), serialized with its own transaction-level advisory lock so that Requirement 5 criterion 4 holds.
4. THE function `reserve_verification_run` SHALL behave as Requirement 18 criteria 5, 11, and 12 of 05 define for `reserve_llm_call`, without the route argument: it raises an error and changes nothing when `auth.uid()` is NULL or any limit is NULL or less than 1 or any window is NULL or not a positive interval; it inserts one row and returns `true`, `none`, and 0 when both counts are below their limits; it inserts no row and returns `false`, `user` (also when both limits are reached) or `global`, and a retry-after from 1 to 86,400 when a limit is reached; and it deletes rows older than 24 hours on every valid call.
5. THE migration SHALL revoke `EXECUTE` on `reserve_verification_run` from `PUBLIC` and `anon`, and SHALL grant it to `authenticated` only.
6. THE migration SHALL create `public.record_verification(p_reincarnation_id uuid, p_passed boolean, p_total_runs integer, p_execution_time_ms integer)` as `SECURITY INVOKER` with a fixed `search_path`, so that RLS decides which rows the caller may update.
7. THE function `record_verification` SHALL, in one transaction, update the `reincarnations` row `p_reincarnation_id` setting `pbt_passed`, `total_runs`, and `execution_time_ms` only `WHERE pbt_passed IS NULL`; when and only when that update changed one row, update the parent corpse `status` to `RESURRECTED` if `p_passed` is true and to `FAILED` otherwise, only where the current status is not `RESURRECTED` and not `FAILED`; and return a row with the flag `was_updated`, the written values, and the corpse status after the call. WHEN the update changed no row, it SHALL write nothing else and SHALL return `was_updated` false.
8. THE function `record_verification` SHALL raise an error and change nothing when `auth.uid()` is NULL, any argument is NULL, `p_execution_time_ms` is less than 0, `p_total_runs` is greater than 1,000, `p_total_runs` is less than 100 while `p_passed` is true, or `p_total_runs` is less than 1 while `p_passed` is false.
9. THE migration SHALL revoke `EXECUTE` on `record_verification` from `PUBLIC` and `anon` and grant it to `authenticated`. THE function SHALL change nothing for a Sample_Corpse, a corpse of another user, or an id that does not exist (RLS allows no update), and SHALL return `was_updated` false in those cases.
10. THE migration SHALL NOT modify, drop, or recreate any object of `V1`, `V2`, or `V3`, SHALL define no policy on the existing Lazarus tables, SHALL contain English comments only, and SHALL end with `NOTIFY pgrst, 'reload schema'`.
11. THE Verification_Suite SHALL gain tests that run under `TEST_DATABASE_URL` and are skipped when it is unset (as in Requirement 18 criterion 10 of 05), covering: `anon` cannot read, write, or execute any new object; `authenticated` cannot read or write the ledger directly; the 11th reservation in 60 minutes by one user is denied with denying limit `user` and a retry-after from 1 to 3,600; 15 concurrent reservations by one user yield exactly 10 allowed results; the global limit denies with `global`; a denied call and an invalid call insert no row; one user's reservations do not count for another; `record_verification` writes once and a second call returns `was_updated` false and leaves the first values; it sets `RESURRECTED` and `FAILED` correctly and leaves a terminal status unchanged; it rejects each invalid argument; it changes nothing for a sample and for a corpse of another user; and two concurrent calls leave exactly one result.
12. THE Verification_Suite tests that assert the exact migration list (`db/tests/config.test.ts` and `db/tests/migrations.test.ts`, as amended by 05) SHALL be updated to expect `V1`, `V2`, `V3`, and `V4`, and four history rows.

### Requirement 9: Error codes, status mapping, and logging

**User Story:** As a UI developer and an operator, I want a closed list of error codes and safe server logs, so that the UI can map every failure and no secret leaks.

#### Acceptance Criteria

1. THE Verify_Route SHALL use only these Error_Envelope codes with these HTTP statuses: `INVALID_REQUEST` 400, `AUTH_REQUIRED` 401, `FORBIDDEN_ORIGIN` 403, `NOT_FOUND` 404, `NOT_PRECOMPUTED` 404, `METHOD_NOT_ALLOWED` 405, `SEANCE_REQUIRED` 409, `REINCARNATION_REQUIRED` 409, `REQUEST_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `VERIFICATION_INCONCLUSIVE` 422, `RATE_LIMITED` 429, `VERIFICATION_BUSY` 429, `INTERNAL_ERROR` 500, `PERSISTENCE_FAILED` 500, `QUOTA_UNAVAILABLE` 503, `VERIFICATION_DISABLED` 503, and `SANDBOX_UNAVAILABLE` 503. The codes shared with 05 keep their meaning and status; the five codes `REINCARNATION_REQUIRED`, `VERIFICATION_DISABLED`, `VERIFICATION_BUSY`, `VERIFICATION_INCONCLUSIVE`, and `SANDBOX_UNAVAILABLE` are new.
2. WHEN the Verify_Route responds with an HTTP status of 400 or higher, it SHALL return an Error_Envelope whose `code` is in the list of criterion 1 and whose HTTP status equals the status listed for that code.
3. THE Verify_Route SHALL return for each code one fixed English `message` of 1 to 200 characters (two fixed texts for `RATE_LIMITED`, one per limit), identical on every occurrence and free of any stack trace, SQL text, SQLSTATE, policy name, Supabase error body, Sandbox_Runner message, file path, code text, host detail, and environment value.
4. THE Verify_Route SHALL set `Retry-After` only on the responses with code `RATE_LIMITED` and `VERIFICATION_BUSY`, as an integer from 1 to 86,400.
5. WHEN a request fails with an Error_Envelope, THE Verify_Route SHALL write exactly one server-side log line with the route name `verify`, the error code, the corpse id (recorded as absent when the body was rejected before the id was known), the elapsed time in milliseconds as a non-negative integer, and a short constant `detail` (for example a Sandbox_Runner code, a denial reason, a SQLSTATE class, or `kill_switch_invalid`).
6. WHEN a sandbox run produced a Sandbox_Result, THE Verify_Route SHALL write one server-side log line with the event `verification_run`, the corpse id, the user id, the Sandbox_Result `status` and `code` (if any), `totalRuns`, `executionTimeMs`, and the `seed`.
7. THE Verify_Route SHALL NOT write `original_code`, `modern_code`, `pbt_test_code`, a counterexample, a Sandbox_Runner `message`, an email address, the Kill_Switch value, or any Server_Only_Variables value to any log line, and SHALL write every message and log line in English.

### Requirement 10: Wording and stated limitations

**User Story:** As a product owner, I want verification described as empirical evidence with honest limits, so that Lazarus never claims more than the runs show.

#### Acceptance Criteria

1. THE Verification_API SHALL author the `evidence` string only as Requirement 2 criterion 5 defines it, and SHALL NOT include a Forbidden_Phrase in any string it authors, including every Error_Envelope message, log field, and README sentence of this spec (except the Forbidden_Phrases definition).
2. WHEN a response has `verification` equal to `NOT_RUN`, THE Verify_Route SHALL NOT include any of the whole words `verified`, `tested`, `proven`, `proof`, or `equivalent` (case-insensitive) in any string value of the response, and WHEN `verification` is `FAILED` it SHALL NOT include `verified`, `proven`, or `proof`, as Requirement 19 criteria 4 and 5 of 05 state.
3. THE README section of Requirement 12 SHALL state each of these limitations in English: (a) the verdict is visible only to the owner under RLS and is not an attestation; (b) an owner with direct table access, or a call to `record_verification` with chosen arguments, could write the same columns, because the owner UPDATE policy of the Foundation allows it; (c) code under test can influence the verdict of its own run, as the Threat_Model of `07-sandboxed-execution` states; (d) a `VERIFIED` or `FAILED` result is final and is not re-run or regenerated by this spec; (e) an Inconclusive_Outcome stores nothing and still uses one unit of quota, so a corpse whose code never completes a run stays unverified; (f) concurrency limits apply per process; (g) neither the seed nor the counterexample is stored or returned, and the seed is only in the server log.
4. THE README section SHALL describe, as optional future hardening and not as part of this spec, moving the verdict write behind a function that only a trusted server identity can execute, together with column-level privileges that stop the owner from updating the verdict columns directly, and SHALL state why it is not in this spec: it needs either a service role key (forbidden by Requirement 7 of 04 and Requirement 1 criterion 5 of 05) or a signing secret, and a change of the Foundation grants and policies.
5. THE README section SHALL state that results are empirical evidence from randomly generated inputs, with the exact run count, and SHALL NOT describe them as exhaustive.

### Requirement 11: Tests

**User Story:** As a maintainer, I want automated tests that need no network, no key, no database, and no real sandbox for the decision logic, so that the execution and cost rules are checked on every `pnpm test`.

#### Acceptance Criteria

1. WHEN `pnpm test` runs, THE Web_App SHALL execute the Verification_API tests with Vitest in single-run mode, SHALL replace the Sandbox_Runner with a fake sandbox port and the store with an in-memory verification store, SHALL NOT require a database, a network connection, a Supabase project, or any environment variable, and SHALL complete them within 60,000 ms with 0 failed and 0 skipped tests (the database-gated tests of Requirement 8 criterion 11 are excluded from this count).
2. THE tests SHALL include a property-based test (`fast-check`, explicit `numRuns` of at least 100) over every combination of Request_Body, corpse kind (Sample_Corpse, Owned_Corpse, corpse of another Member), caller (Visitor or Member), reincarnation presence, Stored_Verdict presence, entry function validity, Effective_Execution_Flag, and fake quota result (allowed, denied, error), asserting that the fake sandbox is called if and only if every step of Requirement 3 criterion 8 passed, at most once per request, after exactly one quota call.
3. THE tests SHALL include a property-based test (`fast-check`, explicit `numRuns` of at least 100) asserting that every Visitor request, whatever the body, and every `precomputed` and `stored` response, yields 0 sandbox calls, 0 quota calls, 0 Kill_Switch reads, and 0 write calls on the store, and that these responses are identical for every combination of Execution_Flag and Kill_Switch value.
4. THE tests SHALL cover the Request_Body validation of this route with one accepted and one rejected example for each case listed in Requirement 20 criterion 4 of 05, each rejected example yielding an Error_Envelope with a status and code from Requirement 9 criterion 1, 0 sandbox calls, and 0 writes.
5. THE tests SHALL cover the Kill_Switch parsing with a property-based test (`fast-check`, explicit `numRuns` of at least 100) over strings with padding, mixed case, and arbitrary content, and SHALL cover the truth table of the Effective_Execution_Flag.
6. THE tests SHALL cover the classification of Requirement 7 with one example per Sandbox_Runner result code (`PASSED`, `FAILED`, and each code listed in Requirement 7 criterion 4 and the `INVALID_OPTIONS` and `INTERNAL_ERROR` codes), one example per denial reason of Requirement 6 criterion 6, and `SANDBOX_UNAVAILABLE`, each asserting status, code, and the exact set of writes (none for every non-conclusive case, with the quota reservation kept).
7. THE tests SHALL cover the persistence paths of Requirement 7 criteria 7, 8, 9, and 12 (updated, not updated and re-read, database error, and a race simulated by inserting a conflicting verdict just before the Record_Function), and the status transitions to `RESURRECTED` and `FAILED`.
8. THE tests SHALL assert that every response status and code produced by the Verify_Route in any test is in the list of Requirement 9 criterion 1, and that no response body or log line contains a sentinel placed in the fake sandbox message, the fake database error text, the code fixtures, or the Kill_Switch value.
9. THE tests SHALL include one wiring test that runs the real `@lazarus/sandbox-runner` (through `verifyLive` with a test-only Gate whose `userExecutionEnabled` is true) over the three seed fixtures (`es3`, `es5-jquery`, `legacy-node`) with the in-memory store, and asserts `source` `executed`, `totalRuns` 1,000, `verification` `VERIFIED`, and `corpse.status` `RESURRECTED`; it SHALL fail with a clear message, and not skip, when the Sandbox_Runner `dist/` is missing.
10. THE tests SHALL assert, by scanning source files (excluding test files), the boundaries of Requirement 1 criteria 1, 3, 4, 5, 7, and 9, the route export set, the committed value of the Execution_Flag against a constant in the test (so that flipping it requires a deliberate edit of both files), and the absence of Forbidden_Phrases in authored strings.
11. THE tests SHALL name each test with `R<n>.<m>` of the requirement it covers, SHALL pass an explicit `numRuns` to every property-based test, and SHALL put the comment `// Feature: 08-live-verification-api, Property <N>: <title>` (or `Supporting check: <title>`) as the first line of each property-based `it` body.
12. THE tests SHALL describe results as empirical evidence and SHALL contain no Forbidden_Phrase in any test name, assertion message, or fixture, except fixtures whose test name states that they test the rejection of Forbidden_Phrases.
13. THE guards of 05 (network, environment, database) SHALL also fail a Verification_API test that reads `LAZARUS_SANDBOX_KILL_SWITCH` without having set it explicitly.

### Requirement 12: Documentation and scope boundary

**User Story:** As a reviewer and a new contributor, I want the route documented and the file list limited, so that the review covers only this stage.

#### Acceptance Criteria

1. THE Web_App SHALL extend `apps/web/README.md` with one new section `## Verification API` written in English, appended after the `## Pipeline API` section of 05 without removing or altering any pre-existing content, that lists the route, the Request_Body, the success shape, the three Verify_Source values, the flow order of Requirement 3 criterion 8, the quota values and the file that holds them (`apps/web/src/lib/verification/limits.ts`), and the statements of Requirement 4 criterion 7 and Requirement 10 criteria 3 to 5.
2. THE README section SHALL list every error code of Requirement 9 criterion 1 in a table under the heading `### Verification error codes`, with one English sentence per code, so that the set of documented codes equals the set of codes defined in the Verification_API source with no omission and no extra entry. The heading SHALL differ from `### Error codes` of 05, so that the README test of 05 is unaffected.
3. THE README section SHALL explain how a maintainer reproduces a failed run: take `original_code`, `modern_code`, and `pbt_test_code` from the stored row, the entry function from `invariants_json`, `numRuns` 1,000, and the seed from the `verification_run` log line, and call `runSandboxedVerification` of the Sandbox_Runner in a trusted environment.
4. THE Verification_API SHALL extend these artifacts of 05 and no other: `apps/web/test/isolation.test.ts` (rules for `lib/verification/`, the `@lazarus/sandbox-runner` import allowed only in `sandbox.ts`, the Kill_Switch name allowed only in `env-server.ts`, `app/api` allowed to contain `verify`); `apps/web/test/build-output.test.ts` (the Kill_Switch name and value as sentinels, and no file name of a `lib/verification` module under `static/`); `apps/web/test/setup/guards.ts` (the Kill_Switch guard); the method guard of `apps/web/src/proxy.ts` and its test; and `apps/web/README.md`. The dependency rule of Requirement 1 criterion 1 of 05 and its isolation check are kept unchanged.
5. THE Verification_API SHALL limit the files it adds or modifies to: `apps/web/src/app/api/verify/route.ts`; files under `apps/web/src/lib/verification/`; `apps/web/src/lib/env-server.ts` and its test; the test doubles `apps/web/src/lib/testing/memory-verification-store.ts`, `mock-sandbox.ts`, and `verification-arbitraries.ts`; `apps/web/src/proxy.ts` and its test; `apps/web/next.config.ts` (only to keep the Sandbox_Runner and its worker files in the server output); `apps/web/package.json`; `pnpm-lock.yaml`; `apps/web/README.md`; the amended tests of criterion 4; the new Web_App tests `apps/web/test/verification-readme.test.ts` and `apps/web/test/verification-boundaries.test.ts`; `db/migrations/V4__live_verification_support.sql`; `db/tests/live-verification.test.ts`; the amended `db/tests/config.test.ts` and `db/tests/migrations.test.ts`; and the one `.env.example` entry of Requirement 4 criterion 8, so that a diff of the implementation against its base revision shows zero added or modified files outside this list.
6. THE Verification_API SHALL NOT add, change, or remove any file under `packages/`, any migration `V1` to `V3`, any route of 05 (`scan`, `seance`, `reincarnate`), or any component or page of `06-resurrection-ui`.

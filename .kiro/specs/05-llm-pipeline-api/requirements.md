# Requirements Document

## Introduction

This spec adds the server-side pipeline of Lazarus to `apps/web`: three Route Handlers and the shared infrastructure behind them.

1. **`POST /api/scan`** (The Hex Scanner): runs the deterministic curse scanner of `02-scanner-and-verifier` on a corpse and stores the curses. It makes no LLM call. `04-web-shell-auth` assigned this route to this spec.
2. **`POST /api/seance`** (The Séance Chamber): asks an LLM to extract the "soul" of a corpse into a Séance spec (`requirements_md` in EARS notation, `design_md`, and `invariants_json`) and stores it in `public.seance_specs`.
3. **`POST /api/reincarnate`** (The Laboratory, generation half): asks an LLM for the resurrected TypeScript module and the property-based test code, validates both statically, and stores them in `public.reincarnations`.
4. **Shared infrastructure**: Vercel AI SDK with Groq (optional Google fallback), structured-output validation, the `code_hash` cache, a per-user rate limit with a global ceiling stored in Postgres, and the Judge/Sandbox rule that anonymous visitors never trigger an LLM call.

**Decisions made by this spec** (the steering documents leave them to the spec):

- **Rate limit.** 20 LLM-backed requests per user per rolling 60 minutes, counted across `/api/seance` and `/api/reincarnate`, plus a global ceiling of 500 per rolling 24 hours. The counters live in a Postgres table that only a `SECURITY DEFINER` function can touch (migration `V3`).
- **Cache scope.** The cache is keyed by `code_hash` and reads only rows that Row Level Security (RLS) already lets the caller see: the corpse's own rows and the Sample_Corpse rows. Results are never shared between two users, because a generated spec describes the private code it came from. This needs no service role key.
- **One result per corpse.** `V3` adds unique indexes on `seance_specs.corpse_id` and `reincarnations.corpse_id`. A repeated or concurrent request returns the stored row instead of creating a second one.
- **No live verification of user code.** `03-pbt-verifier` runs only `sample` origin code, and `07-sandboxed-execution` has not lifted that rule; the route that lifts it, `POST /api/verify`, belongs to `08-live-verification-api`. This spec therefore never executes legacy code, generated code, or generated test code. A reincarnation of a user corpse is stored as generated and statically validated, with `pbt_passed`, `total_runs`, and `execution_time_ms` set to NULL. It never claims a verification that did not happen.
- **Non-streaming responses.** The routes return one JSON document. Streaming progress is not planned in any spec: it would need a change to these routes first, and `06-resurrection-ui` shows an indeterminate pending state instead.
- **Known limitation.** A Member who sends two identical generation requests at nearly the same moment spends two rate-limit units, and one of the two provider results is discarded.

**Prerequisites.** `01-lazarus-foundation` (schema, RLS, three Sample_Corpse rows with Séance specs and reincarnations), `02-scanner-and-verifier` (`@lazarus/mcp-curse-scanner` library API, built to `dist/`), and `04-web-shell-auth` (session handling, `getCurrentMember()`, `Server_Client`, import with `code_hash`).

**Changes outside `apps/web`.** This spec adds one migration, `db/migrations/V3__llm_pipeline_support.sql`, and the matching Verification_Suite tests. This amends Foundation Requirement 8 criterion 2 ("exactly two files in `db/migrations/`"); the Foundation tests that assert the exact migration list change in this spec's tasks.

**Out of scope** (separate specs): all screens and client-side calls of the Hex Scanner, Séance Chamber, and Laboratory, and the approval control for a Séance spec (`06-resurrection-ui`); executing legacy code, generated TypeScript, or generated test code, and any call to `@lazarus/pbt-verifier` (`03-pbt-verifier`, `07-sandboxed-execution`, `08-live-verification-api`); streaming progress (not planned in any spec); regeneration of an existing result; fetching code from GitHub; any change to the Foundation migrations V1 and V2, the seed, or the packages under `packages/`.

## Glossary

- **Pipeline_API**: The three Route Handlers `Scan_Route`, `Seance_Route`, and `Reincarnate_Route` and their shared modules under `apps/web/src/lib/pipeline/`, `apps/web/src/lib/llm/`, and `apps/web/src/app/api/`.
- **Scan_Route**: The Route Handler `POST /api/scan`.
- **Seance_Route**: The Route Handler `POST /api/seance`.
- **Reincarnate_Route**: The Route Handler `POST /api/reincarnate`.
- **LLM_Routes**: `Seance_Route` and `Reincarnate_Route`.
- **Web_App**, **Server_Client**, **Visitor**, **Member**, **Sample_Corpse**, **Owned_Corpse**, **Claims**, **Safe_Redirect_Path**: As defined in `04-web-shell-auth`. `getCurrentMember()` is the helper of that spec.
- **Curse_Scanner**: The library API of `@lazarus/mcp-curse-scanner` (`scanCurses`, `extractFunctionSignatures`).
- **LLM_Provider**: The Vercel AI SDK (`ai`) with the Groq provider (`@ai-sdk/groq`), and optionally the Google provider (`@ai-sdk/google`).
- **LLM_Config**: The server-only variables `GROQ_API_KEY`, `LLM_MODEL`, `GOOGLE_GENERATIVE_AI_API_KEY`, and `LLM_FALLBACK_MODEL`.
- **Request_Body**: The JSON object `{ "corpseId": "<uuid>" }`.
- **Error_Envelope**: The JSON object `{ "ok": false, "error": { "code": "<ERROR_CODE>", "message": "<English text>" } }`.
- **Result_Source**: One of `precomputed` (stored row of a Sample_Corpse), `stored` (stored row of the requested corpse), `cache` (row copied from another visible corpse with the same `code_hash`), or `generated` (new LLM output).
- **Entry_Function**: As defined in `03-pbt-verifier`: the single deterministic, pure, named top-level function that the Séance spec and the modern code expose.
- **Entry_Candidate**: A function returned by `extractFunctionSignatures` with `kind` equal to `declaration`, `nestingDepth` equal to 0, and a non-null `name`.
- **Seance_Output**: The structured value the LLM returns for `Seance_Route`: `requirementsMd`, `designMd`, and `invariants` (`entry_function`, `input`, `output`, `invariants`).
- **Invariants_Document**: The value stored in `seance_specs.invariants_json`, with the keys `entry_function`, `input`, `output`, and `invariants`, as in Foundation Requirement 19 criterion 4.
- **EARS_Criterion**: A numbered line of `requirements_md` that starts with one of `THE`, `WHEN`, `WHILE`, `IF`, or `WHERE` (uppercase) and contains the uppercase word `SHALL`.
- **Reincarnation_Output**: The structured value the LLM returns for `Reincarnate_Route`: `modernCode` and `pbtTestCode`.
- **Target_Stack**: The constant string `TypeScript (strict, ES2022)` stored in `reincarnations.target_stack`.
- **Test_Code_Contract**: As defined in `database-and-exorcism.md`, section 3.
- **Static_Gate**: The checks of Requirement 13 that run on generated code without executing it.
- **Usage_Ledger**: The table `public.llm_usage_events`, one row per reserved LLM-backed request.
- **Quota_Function**: The function `public.reserve_llm_call`, which checks both limits and records one Usage_Ledger row in one atomic step.
- **User_Quota**: 20 reservations per user per rolling 60 minutes.
- **Global_Quota**: 500 reservations in total per rolling 24 hours.
- **Max_LLM_Source_Bytes**: 20,000 bytes of UTF-8 of `original_code`.
- **Provider_Call_Timeout**: 45,000 ms for one call to the LLM_Provider.
- **Request_Deadline**: 100,000 ms of wall-clock time for one request to an LLM_Route.
- **Forbidden_Phrases**: The strings `100%`, `mathematical proof`, `mathematically proven`, and `guaranteed`, compared case-insensitively.
- **Server_Only_Variables**: As defined in `04-web-shell-auth`.

## Requirements

### Requirement 1: Dependencies, module layout, and server-only boundary

**User Story:** As a developer, I want the LLM code isolated in server-only modules, so that no key or prompt can reach a client bundle.

#### Acceptance Criteria

1. THE Web_App SHALL list the dependencies `ai` (major version 7), `@ai-sdk/groq` (major version 4), `@ai-sdk/google`, `zod`, `server-only`, `typescript` (major version 6), and `@lazarus/mcp-curse-scanner` (workspace version) under `dependencies` in `apps/web/package.json`, and SHALL NOT list `@lazarus/pbt-verifier` in any dependency section of `apps/web/package.json`.
2. THE Web_App SHALL place the Route Handlers at `apps/web/src/app/api/scan/route.ts`, `apps/web/src/app/api/seance/route.ts`, and `apps/web/src/app/api/reincarnate/route.ts`, and each file SHALL export the function `POST` and the route segment options `runtime` set to `nodejs` and `dynamic` set to `force-dynamic`, and no other exports. The files of the LLM_Routes SHALL also export `maxDuration` with an integer value of at least 120 (seconds), which exceeds the 100-second Request_Deadline.
3. THE Web_App SHALL make `import 'server-only'` the first import statement of every module under `apps/web/src/lib/llm/` and `apps/web/src/lib/pipeline/`, except a pure module. A pure module is a module that contains no import from `ai`, `@ai-sdk/*`, `next`, or `server-only`, and no reference to `process.env`, and that is exercised by unit tests under Vitest without a Next.js runtime.
4. THE Web_App SHALL import `ai`, `@ai-sdk/groq`, and `@ai-sdk/google` only in modules under `apps/web/src/lib/llm/`, so that a search of all other files under `apps/web/src/` finds zero import statements for these three packages.
5. THE Web_App SHALL read each LLM_Config variable (`GROQ_API_KEY`, `LLM_MODEL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `LLM_FALLBACK_MODEL`) only in `apps/web/src/lib/llm/config.ts`, and SHALL contain zero references to `SUPABASE_SERVICE_ROLE_KEY` in any file under `apps/web/src/`.
6. THE Pipeline_API SHALL perform every database read and write through the Server_Client created for the current request, and SHALL create no other database client, so that RLS decides which rows each request can read and write.
7. THE production client bundles of the Web_App (the browser-served files emitted by `pnpm build`) SHALL contain zero occurrences of each LLM_Config variable name, each LLM_Config variable value configured in the build environment, the full text of each prompt, and each file name of a Pipeline_API module.
8. THE Pipeline_API SHALL contain zero explicit `any` type annotations, and `pnpm lint` SHALL report zero errors for the Pipeline_API files.
9. THE Pipeline_API SHALL write all source comments, prompts, error messages, and documentation in English.
10. IF a module that is imported into a client component (a file marked `'use client'`) imports a module under `apps/web/src/lib/llm/` or `apps/web/src/lib/pipeline/` that begins with `import 'server-only'`, THEN `pnpm build` SHALL fail with an error that names the offending import, and SHALL emit no production build output for that build.

### Requirement 2: LLM configuration and secrets

**User Story:** As an operator, I want the model and keys configured by environment variables with safe failure, so that a deprecated model needs no code change and a missing key never crashes the app.

#### Acceptance Criteria

1. WHEN THE LLM_Config module reads its variables, THE LLM_Config module SHALL trim leading and trailing whitespace from each value and SHALL treat a variable as blank when the trimmed value has 0 characters. THE LLM_Config module SHALL read `GROQ_API_KEY` as a non-blank string of at most 512 characters, and SHALL read `LLM_MODEL` as a non-blank string of at most 200 characters that defaults to `openai/gpt-oss-120b` when unset or blank.
2. WHERE both `GOOGLE_GENERATIVE_AI_API_KEY` and `LLM_FALLBACK_MODEL` are set to non-blank strings, THE LLM_Config module SHALL enable the Google fallback of Requirement 15 criterion 4.
3. IF `GOOGLE_GENERATIVE_AI_API_KEY` or `LLM_FALLBACK_MODEL` is unset or blank, THEN THE LLM_Config module SHALL disable the Google fallback and SHALL NOT return a typed error for that reason.
4. THE LLM_Config module SHALL return either a valid configuration or a typed error that lists the name of every missing or invalid variable and contains no variable value. A variable is missing when it is unset or blank (except `LLM_MODEL`, which has a default), and invalid when it exceeds its maximum length or is rejected by criterion 9.
5. WHEN a request is answered with Result_Source `precomputed`, `stored`, or `cache`, or is a Visitor request, or is a `Scan_Route` request, THE Pipeline_API SHALL complete the request without reading any LLM_Config variable, so that the response is identical when `GROQ_API_KEY`, `LLM_MODEL`, `GOOGLE_GENERATIVE_AI_API_KEY`, and `LLM_FALLBACK_MODEL` are all unset.
6. IF a request needs the LLM_Provider and the LLM_Config module returns a typed error for a missing `GROQ_API_KEY` or for any invalid variable, THEN THE LLM_Routes SHALL respond with HTTP status 503 and the Error_Envelope code `LLM_NOT_CONFIGURED`, SHALL NOT call the Quota_Function, SHALL NOT add a Usage_Ledger row, SHALL NOT call the LLM_Provider, and SHALL NOT include any variable name or value in the response body.
7. THE Pipeline_API SHALL NOT write the value of any LLM_Config variable to any log entry, Error_Envelope message, response body, response header, or serialized error object.
8. THE Web_App SHALL NOT contain the model id `llama-3.3-70b-versatile` in any source file, default value, or `.env.example` entry, and SHALL NOT send that model id to the LLM_Provider.
9. IF `LLM_MODEL` or `LLM_FALLBACK_MODEL` equals `llama-3.3-70b-versatile` after trimming and case-insensitive comparison, THEN THE LLM_Config module SHALL return a typed error that names that variable as invalid.
10. THE file `.env.example` SHALL document `GROQ_API_KEY`, `LLM_MODEL`, `GOOGLE_GENERATIVE_AI_API_KEY`, and the new variable `LLM_FALLBACK_MODEL`, each with a placeholder value that is not a real secret and a comment line directly above it that states its purpose. THE file `.env.example` SHALL have the `GOOGLE_GENERATIVE_AI_API_KEY` and `LLM_FALLBACK_MODEL` lines commented out with a leading `#`, and SHALL NOT contain any variable name made of the prefix `NEXT_PUBLIC_` followed by an LLM_Config variable name.

### Requirement 3: Request and response contract

**User Story:** As a UI developer, I want one predictable HTTP contract for all three routes, so that the resurrection UI handles every outcome in the same way.

#### Acceptance Criteria

1. IF the HTTP method of a request to a route of the Pipeline_API is not `POST` (for example `GET`, `HEAD`, `PUT`, `PATCH`, `DELETE`, or `OPTIONS`), THEN THE route SHALL respond with HTTP status 405, the header `Allow: POST`, and the Error_Envelope code `METHOD_NOT_ALLOWED`.
2. IF the request header `Origin` is missing, or its value is not a string-for-string match of the origin of the Web_App as derived by the request-origin helper of `04-web-shell-auth`, THEN THE route SHALL respond with HTTP status 403 and the Error_Envelope code `FORBIDDEN_ORIGIN` before reading the body, because Route Handlers are not covered by the Server Action origin check.
3. IF the `Content-Type` header is missing, or its media type (compared case-insensitively, ignoring parameters such as `charset`) is not `application/json`, THEN THE route SHALL respond with HTTP status 415 and the Error_Envelope code `UNSUPPORTED_MEDIA_TYPE` before reading the body.
4. IF the body is larger than 1,024 bytes (counted on the raw bytes before decoding, so a body of exactly 1,024 bytes is accepted), THEN THE route SHALL stop reading after 1,024 bytes and SHALL respond with HTTP status 413 and the Error_Envelope code `REQUEST_TOO_LARGE`.
5. IF the body is empty, is not valid UTF-8 JSON, is not a JSON object, lacks the key `corpseId`, contains any key other than `corpseId`, or has a `corpseId` value that is not a string in the canonical UUID format of 8-4-4-4-12 hexadecimal digits (case-insensitive), THEN THE route SHALL respond with HTTP status 400 and the Error_Envelope code `INVALID_REQUEST` without querying the database.
6. WHEN a request succeeds, THE route SHALL respond with HTTP status 200 and a JSON object with `ok` set to `true`, `source` set to one value of the Result_Source (`Scan_Route` uses only `precomputed`, `stored`, or `generated`), and the fields defined in Requirements 5, 9, and 12.
7. WHEN a request fails, THE route SHALL respond with the Error_Envelope, where `code` is exactly one of the codes listed in Requirement 17 with its listed HTTP status, and `message` is English text that contains no stack trace, SQL text, environment variable value, or LLM_Config value.
8. THE Pipeline_API SHALL set `Cache-Control: private, no-store` and `Content-Type: application/json; charset=utf-8` on every response of every route, including the 405, 403, 415, 413, and 400 responses.
9. THE Pipeline_API SHALL be bound to the Request_Body fields only: the route SHALL read `original_code`, `code_hash`, and every other input from the database, and SHALL NOT accept source code, prompts, model ids, or run counts from the client through the body, the query string, or any header.
10. WHEN a request reaches a route of the Pipeline_API, THE route SHALL evaluate the checks of criteria 1 to 5 in that numeric order, SHALL respond with the first failing check only, and SHALL complete all five checks before querying the database or calling the LLM_Provider.

### Requirement 4: Identity, visibility, and Judge/Sandbox mode

**User Story:** As a judge, I want to see the precomputed results of the sample corpses without signing in, so that I can evaluate Lazarus without any LLM call being possible for me.

#### Acceptance Criteria

1. THE Pipeline_API SHALL determine the caller as a Visitor or a Member only with `getCurrentMember()` from verified Claims, and SHALL NOT use `getSession()` for an access decision.
2. THE Pipeline_API SHALL load the corpse by the `corpseId` of the Request_Body with the Server_Client of the request, so that a Visitor can read only Sample_Corpse rows and a Member can read Sample_Corpse rows and Owned_Corpse rows, and SHALL NOT use the service role key for this query.
3. WHEN the corpse is a Sample_Corpse, THE Seance_Route SHALL return the stored `seance_specs` row of that corpse and THE Reincarnate_Route SHALL return the stored `reincarnations` row of that corpse, each with HTTP status 200 and `source` set to `precomputed`, for a Visitor and for a Member, without reading the LLM_Config, without calling the LLM_Provider, without reserving quota, and without writing to the database.
4. IF the corpse is a Sample_Corpse and the stored row that the route returns (`seance_specs` for the Seance_Route, `reincarnations` for the Reincarnate_Route) does not exist, THEN THE LLM_Routes SHALL respond with HTTP status 404 and the code `NOT_PRECOMPUTED`, for a Visitor and for a Member, and SHALL NOT call the LLM_Provider, reserve quota, or write to the database.
5. IF the caller is a Visitor and the corpse is not a visible Sample_Corpse (the corpse does not exist or is not a sample), THEN THE LLM_Routes SHALL respond with HTTP status 401 and the code `AUTH_REQUIRED`, with a byte-identical response body in both cases.
6. IF the caller is a Member and the query returns no corpse (the corpse does not exist or belongs to another user), THEN THE LLM_Routes SHALL respond with HTTP status 404 and the code `NOT_FOUND`, with a byte-identical response body in both cases.
7. FOR ALL requests made by a Visitor, whatever the body, THE Pipeline_API SHALL make zero calls to the LLM_Provider, zero reads of the LLM_Config, zero reservations of quota, and zero database writes, including when the body is rejected by Requirement 3.
8. FOR ALL requests, THE Pipeline_API SHALL call the LLM_Provider only after all of these conditions hold, checked in this order: the caller is a verified Member, the corpse is an Owned_Corpse, the cache lookup of Requirement 7 missed, the eligibility checks of Requirement 6 passed, and the Quota_Function allowed the request.
9. IF `getCurrentMember()` or the corpse query raises an error that is not a "no rows" result, THEN THE LLM_Routes SHALL respond with HTTP status 500 and the code `INTERNAL_ERROR`, and SHALL NOT call the LLM_Provider, reserve quota, or write to the database.

### Requirement 5: Hex Scanner route

**User Story:** As a Member, I want to scan my corpse and store its curses, so that the diagnostic is available to the next stages without an LLM call.

#### Acceptance Criteria

1. WHEN a Member posts the id of an Owned_Corpse to `Scan_Route`, THE Scan_Route SHALL call `scanCurses(original_code, source_language)` of the Curse_Scanner and SHALL replace all stored `curses` rows of that corpse with the findings in one database transaction, so that a failure leaves the previous rows unchanged, and so that after two concurrent scans of the same corpse finish, the stored rows equal the complete findings of exactly one of the two scans, with no duplicated or mixed rows.
2. THE Scan_Route SHALL store for each finding `curse_type`, `severity`, `line_number` (the finding's `lineNumber`), `description`, and `exorcism_strategy`.
3. WHEN the scan succeeds, THE Scan_Route SHALL respond with `source` set to `generated`, `lineCount` (the number of lines of `original_code` as numbered by the Curse_Scanner), and `curses`, an array ordered by ascending `line_number` and then by ascending `curse_type` (code-unit string comparison), each element with `curseType`, `severity`, `lineNumber`, `description`, and `exorcismStrategy`; WHEN the Curse_Scanner returns zero findings, THE Scan_Route SHALL delete all stored `curses` rows of that corpse and SHALL respond with `curses` set to an empty array.
4. WHEN the corpse is a Sample_Corpse, THE Scan_Route SHALL return the stored `curses` rows in the same shape and order as criterion 3 with `source` set to `precomputed`, SHALL return an empty `curses` array when the corpse has no stored rows, and SHALL NOT scan or write.
5. IF the Curse_Scanner returns a Scan_Error, THEN THE Scan_Route SHALL respond with HTTP status 422, the code `SOURCE_SYNTAX_ERROR` for `SYNTAX_ERROR` and `SOURCE_NOT_SCANNABLE` for every other Scan_Error code, and a message that contains the decimal line number and column number when the Scan_Error provides them, and SHALL leave the stored curses unchanged.
6. THE Scan_Route SHALL NOT call the LLM_Provider, SHALL NOT read the LLM_Config, SHALL NOT call the Quota_Function, and SHALL NOT insert any row into the Usage_Ledger.
7. THE Scan_Route SHALL treat `original_code` only as text input to the Curse_Scanner and SHALL NOT execute, evaluate, or import any part of it.
8. FOR ALL Owned_Corpses, WHEN the scan runs twice on the same unchanged code, THE stored `curses` rows after the second run SHALL equal the stored rows after the first run in row count and in `curse_type`, `severity`, `line_number`, `description`, and `exorcism_strategy` (idempotence).
9. IF the database transaction of criterion 1 fails after the Curse_Scanner succeeded, THEN THE Scan_Route SHALL respond with HTTP status 500 and the code `INTERNAL_ERROR`, and SHALL leave the previously stored `curses` rows of that corpse unchanged.

### Requirement 6: Source eligibility for the LLM stages

**User Story:** As a maintainer, I want to reject code that the pipeline cannot process before any quota or provider cost is incurred, so that failures are cheap and explicit.

#### Acceptance Criteria

1. WHEN an LLM_Route needs a generation because the cache lookup returned no result, THE LLM_Route SHALL check the eligibility of `original_code` before the Quota_Function and SHALL run the checks in this order: size, scan, Entry_Candidate, stopping at the first check that fails so that exactly one error response is returned.
2. IF the UTF-8 byte length of `original_code` is greater than Max_LLM_Source_Bytes (20,000 bytes), THEN THE LLM_Route SHALL respond with HTTP status 422 and an Error_Envelope with the code `SOURCE_TOO_LARGE` and a message that states the limit of 20,000 bytes. A source of exactly 20,000 bytes SHALL pass this check.
3. IF `scanCurses` or `extractFunctionSignatures` returns a Scan_Error (an error result of the Curse_Scanner), THEN THE LLM_Route SHALL respond with HTTP status 422 and an Error_Envelope with the code `SOURCE_SYNTAX_ERROR` when the Scan_Error code is `SYNTAX_ERROR`, or the code `SOURCE_NOT_SCANNABLE` when the Scan_Error has any other code. THE LLM_Route SHALL evaluate `scanCurses` before `extractFunctionSignatures` and SHALL use the first Scan_Error returned.
4. IF `extractFunctionSignatures` succeeds and returns zero Entry_Candidates, THEN THE LLM_Route SHALL respond with HTTP status 422 and an Error_Envelope with the code `NO_ENTRY_FUNCTION`.
5. WHEN the size, scan, and Entry_Candidate checks all pass, THE LLM_Route SHALL pass every Entry_Candidate, in source order and without truncation, to the prompt of Requirement 9, and for each Entry_Candidate SHALL include its name, parameter names, `pureCandidate` value, and `impurityMarkers`, so that the LLM chooses the Entry_Function among real functions.
6. IF an eligibility check fails, THEN THE LLM_Route SHALL make 0 calls to the LLM_Provider.
7. IF an eligibility check fails, THEN THE LLM_Route SHALL NOT call the Quota_Function, so that the number of Usage_Ledger rows is the same before and after the request.
8. IF an eligibility check fails, THEN THE LLM_Route SHALL perform 0 database writes, so that no row is inserted or updated in any table, including `seance_specs`, `reincarnations`, and the Usage_Ledger.

### Requirement 7: Cache by `code_hash`

**User Story:** As a cost-conscious operator, I want an existing result reused before any LLM call, so that the same code is never paid for twice.

#### Acceptance Criteria

1. WHEN the corpse is an Owned_Corpse, THE Seance_Route SHALL look for a `seance_specs` row in this order: (1) a row whose `corpse_id` is the requested corpse, then (2) only if step (1) finds no row and the requested corpse's stored `code_hash` is a non-empty value, a row of any other corpse that the Server_Client can read and whose `code_hash` equals the requested corpse's `code_hash`, and WHERE step (2) matches more than one row, THE Seance_Route SHALL use only the most recently created matching row.
2. WHEN the lookup finds a row of the requested corpse, THE Seance_Route SHALL return it unchanged with `source` set to `stored`, and WHEN it finds a row of another corpse, THE Seance_Route SHALL insert exactly one copy for the requested corpse with `requirements_md`, `design_md`, and `invariants_json` unchanged and `approved_at` NULL, and return it with `source` set to `cache`.
3. WHEN the corpse is an Owned_Corpse and the requested corpse has a `seance_specs` row, THE Reincarnate_Route SHALL look for a `reincarnations` row in this order: (1) a row of the requested corpse, then (2) only if step (1) finds no row, a row of another readable corpse whose `code_hash` equals the requested corpse's `code_hash` and whose corpse has a `seance_specs` row with `requirements_md`, `design_md`, and `invariants_json` each equal to those of the Séance spec of the requested corpse, and WHERE step (2) matches more than one row, THE Reincarnate_Route SHALL use only the most recently created matching row.
4. WHEN the Reincarnate_Route finds a row of the requested corpse, THE Reincarnate_Route SHALL return it unchanged with `source` set to `stored`, and WHEN it finds a row of another corpse, THE Reincarnate_Route SHALL insert exactly one copy for the requested corpse with `target_stack`, `modern_code`, `pbt_test_code`, `pbt_passed`, `total_runs`, and `execution_time_ms` unchanged, because they describe the same legacy code and the same modern code, and return it with `source` set to `cache`.
5. THE Pipeline_API SHALL compute `code_hash` comparisons only from the stored `code_hash` column, which `04-web-shell-auth` computes as the lowercase hexadecimal SHA-256 digest of the UTF-8 text after CR LF normalization, and SHALL NOT trust a hash sent by the client, so that a Request_Body field other than `corpseId` has no effect on which row is returned.
6. THE Pipeline_API SHALL NOT read or copy a row that belongs to another user's private corpse, SHALL treat such a row as nonexistent in every lookup (a match on `code_hash` alone SHALL NOT make it a cache hit), and SHALL NOT use the service role key to widen the cache.
7. IF a cache lookup or a copy insert returns a database error, THEN THE route SHALL respond with HTTP status 500 and the code `PERSISTENCE_FAILED` in the Error_Envelope, SHALL NOT call the LLM_Provider, SHALL NOT reserve quota, and SHALL NOT leave a partially inserted copy row for the requested corpse.
8. WHEN a route returns a result with `source` set to `stored` or `cache`, THE route SHALL NOT read the LLM_Config, SHALL NOT call the LLM_Provider, and SHALL NOT add a row to the Usage_Ledger or otherwise reserve quota.
9. IF the lookup order of criterion 1 (Seance_Route) or criterion 3 (Reincarnate_Route) finds no row and returns no database error, THEN THE route SHALL treat the request as a cache miss, SHALL NOT insert any row at the cache stage, and SHALL continue to the next stage of its flow without returning an error.

### Requirement 8: Rate limiting and usage ledger

**User Story:** As an operator, I want a hard limit on LLM-backed requests per user and in total, so that one account cannot exhaust the provider budget.

#### Acceptance Criteria

1. WHEN an LLM_Route has passed the cache lookup of Requirement 7 and the eligibility checks of Requirement 6, THE route SHALL call the Quota_Function exactly once per request, with the route name (`seance` or `reincarnate`), SHALL wait for its result, and SHALL make the first call to the LLM_Provider only after the Quota_Function has allowed the request.
2. WHEN the Quota_Function is called, THE Quota_Function SHALL allow the request if and only if the number of Usage_Ledger rows of the calling user created in the last 60 minutes is less than 20 and the number of Usage_Ledger rows of all users created in the last 24 hours is less than 500, both counted against the database clock at the time of the call, and SHALL record exactly one Usage_Ledger row (identifying the calling user, the route name, and the reservation time) in the same atomic step when it allows the request. The 20th request of a user in a window is allowed and the 21st is denied. The 500th request of all users in a window is allowed and the 501st is denied.
3. THE Quota_Function SHALL derive the user from `auth.uid()` inside the function and SHALL NOT accept a user id as an argument, so that a caller cannot spend the quota of another user.
4. FOR ALL sets of concurrent calls, THE Quota_Function SHALL allow at most 20 reservations per user within any rolling 60 minutes and at most 500 reservations in total within any rolling 24 hours (no oversubscription).
5. IF the Quota_Function denies the request, THEN THE route SHALL respond with the Error_Envelope, HTTP status 429, and the code `RATE_LIMITED`, with the header `Retry-After` set to an integer number of seconds from 1 to 86,400, and SHALL NOT call the LLM_Provider. The `Retry-After` value SHALL be the time until the number of counted rows of the exceeded window falls below its limit, rounded up to a whole second and limited to the range 1 to 86,400. When both limits are exceeded, the value SHALL be the larger of the two times. The Quota_Function SHALL NOT record a Usage_Ledger row for a denied request.
6. THE message of a `RATE_LIMITED` response SHALL state whether the user limit, the global limit, or both were reached, and SHALL NOT state the Usage_Ledger row count of any other user, the global row count, or any user id.
7. IF the Quota_Function call returns an error, returns a value that is neither an allow nor a deny verdict, or returns no result within 5,000 ms, THEN THE route SHALL respond with the Error_Envelope, HTTP status 503, and the code `QUOTA_UNAVAILABLE`, SHALL NOT call the LLM_Provider (fail closed), and SHALL NOT write to the database.
8. IF a provider error, a Provider_Call_Timeout, the Request_Deadline, a client disconnect, or an invalid output occurs after the Quota_Function allowed the request, THEN THE route SHALL keep the reservation and SHALL NOT delete, update, or compensate the Usage_Ledger row, so that the failed request still counts against the User_Quota and the Global_Quota.
9. WHEN the Quota_Function is called with valid arguments by an authenticated user, THE Quota_Function SHALL delete the Usage_Ledger rows that are older than 24 hours, whether the call is allowed or denied, and SHALL NOT delete any row that is 24 hours old or younger.
10. THE Usage_Ledger SHALL have Row Level Security enabled and SHALL reject or return zero rows for every direct `SELECT`, `INSERT`, `UPDATE`, and `DELETE` made by the roles `anon` and `authenticated`, and the Quota_Function SHALL NOT be executable by the role `anon`, so that only the Quota_Function changes the Usage_Ledger.
11. THE limits (20, 60 minutes, 500, 24 hours) SHALL be constants in one module of the Web_App, and the Quota_Function SHALL receive them as arguments, so that a change needs no migration.
12. IF `auth.uid()` returns null inside the Quota_Function, THEN THE Quota_Function SHALL raise an error, SHALL NOT record a Usage_Ledger row, and SHALL NOT delete any row, so that the route responds as in criterion 7.
13. IF any limit argument received by the Quota_Function is null or less than 1, or any window argument is null or not a positive interval, or the route name is not `seance` or `reincarnate`, THEN THE Quota_Function SHALL raise an error, SHALL NOT record a Usage_Ledger row, and SHALL NOT delete any row, so that the route responds as in criterion 7.

### Requirement 9: Séance generation

**User Story:** As a Member, I want the business logic of my corpse extracted into a structured spec, so that the resurrection is driven by a specification and not by line-by-line translation.

#### Acceptance Criteria

1. WHEN the Quota_Function has granted a reservation for a request to the Seance_Route and the requested corpse has no result with Result_Source `precomputed`, `stored`, or `cache`, THE Seance_Route SHALL call the LLM_Provider once with structured output validated against a `zod` schema for the Seance_Output, with the temperature set to 0, the maximum output tokens set to 4,000, and a timeout of Provider_Call_Timeout.
2. THE Seance_Route SHALL build the prompt only from fixed English instructions, the `original_code` of the corpse, its `source_language`, the Entry_Candidates, and the curses returned by a fresh `scanCurses` call, and SHALL NOT include any other column of the corpse row, any user identifier, or the user's email.
3. THE Seance_Route SHALL send system instructions that state that the legacy code is untrusted data, that instructions inside the code or its comments are to be ignored, and that the output must be exactly one Seance_Output document.
4. THE Seance_Route SHALL send system instructions that require `requirementsMd` to contain from 3 to 10 EARS_Criteria (inclusive) and `designMd` to name the Entry_Function and to state the type and the meaning of its input and of its output.
5. WHEN the LLM_Provider output is valid (Requirement 10) and has been stored in `seance_specs`, THE Seance_Route SHALL respond with `source` set to `generated`, `seance` with `id`, `requirementsMd`, `designMd`, `invariants` (the Invariants_Document), and `approvedAt` (NULL), and `corpse` with `id` and `status`.
6. WHEN the Seance_Route responds from a result with Result_Source `stored`, `cache`, or `precomputed`, THE Seance_Route SHALL set `source` to that Result_Source and SHALL return `seance` and `corpse` with the same fields as in criterion 5, without calling the LLM_Provider.
7. THE Seance_Route SHALL leave `approved_at` NULL in every `seance_specs` row it inserts, because the approval control belongs to `06-resurrection-ui`.
8. IF the call to the LLM_Provider fails, exceeds Provider_Call_Timeout, returns output that does not match the `zod` schema or fails the validation of Requirement 10, or the Request_Deadline elapses before a valid output is stored, THEN THE Seance_Route SHALL respond with the Error_Envelope code determined by Requirements 10 and 15 (`LLM_OUTPUT_INVALID`, `LLM_PROVIDER_ERROR`, `LLM_NOT_CONFIGURED`, or `LLM_TIMEOUT`), SHALL insert no `seance_specs` row, and SHALL leave the corpse row unchanged.

### Requirement 10: Séance output validation

**User Story:** As a maintainer, I want every stored Séance spec to meet the same format as the seeded ones, so that the UI and the next stage can rely on its shape.

#### Acceptance Criteria

1. THE Seance_Route SHALL accept a Seance_Output only when `requirementsMd` is a string of 200 to 5,000 characters in which at least 95% of the alphabetic characters are Basic Latin letters (A-Z, a-z), and which contains 3 to 10 EARS_Criteria (counted as numbered lines that satisfy the EARS_Criterion definition).
2. THE Seance_Route SHALL accept a Seance_Output only when `designMd` is a string of 100 to 3,000 characters that contains the Entry_Function name as a case-sensitive substring.
3. THE Seance_Route SHALL accept a Seance_Output only when `invariants` is an object with exactly the keys `entry_function`, `input`, `output`, and `invariants` (no missing and no extra keys), where `entry_function`, `input`, and `output` are strings of 1 to 300 characters after trimming leading and trailing whitespace, and `invariants` is an array of 3 to 10 strings of 1 to 300 characters each after trimming. A value of the wrong type, `null`, or a missing field SHALL count as a failure of this rule.
4. THE Seance_Route SHALL accept a Seance_Output only when `entry_function` equals, in a case-sensitive exact match, the `name` of one Entry_Candidate. IF the list of Entry_Candidates is empty, THEN THE Seance_Route SHALL treat this rule as failed.
5. THE Seance_Route SHALL accept a Seance_Output only when no string value anywhere in it (including `requirementsMd`, `designMd`, and every string inside `invariants`) contains a Forbidden_Phrase as a case-insensitive substring.
6. IF the first provider output fails one or more of the rules in criteria 1 to 5, THEN THE Seance_Route SHALL make exactly one second provider call whose prompt adds the name of each failed rule (rule names only, with no text from the rejected output), subject to Requirement 15 criterion 3. THE Seance_Route SHALL validate the second output with the same rules as the first, and SHALL evaluate all five rules for each output so that the list of failed rules is complete.
7. IF the final output fails one or more of the rules in criteria 1 to 5, or the second provider call is not permitted by Requirement 15 criterion 3, THEN THE Seance_Route SHALL respond with HTTP status 502 and an Error_Envelope with the code `LLM_OUTPUT_INVALID`, SHALL write no row to the database, and SHALL NOT include any text of the rejected output in the response body.
8. THE Seance_Route SHALL compute the validation verdict (accepted, or rejected with the list of failed rules) as a pure function of the Seance_Output and the Entry_Candidates only, with no dependence on time, randomness, the database, or the network, so that the same input always gives the same verdict.

### Requirement 11: Séance persistence and corpse status

**User Story:** As a Member, I want a generated spec stored under my corpse, so that I can come back to it from The Crypt.

#### Acceptance Criteria

1. WHEN the Seance_Output has passed the Seance_Output validation of this spec, or a cache row was found for the corpse, THE Seance_Route SHALL insert exactly one `seance_specs` row with the Server_Client, with `corpse_id` set to the requested corpse, `requirements_md`, `design_md`, and `invariants_json` set to the values of the Seance_Output (or copied unchanged from the cache row), and `approved_at` NULL.
2. IF the insert fails because a row for the corpse already exists (unique violation), THEN THE Seance_Route SHALL read that row with the Server_Client, SHALL respond with HTTP status 200 and return that row with `source` set to `stored`, and SHALL NOT respond with an Error_Envelope.
3. IF the insert fails for any reason other than a unique violation, or IF the read of the existing row in criterion 2 returns no row, THEN THE Seance_Route SHALL respond with HTTP status 500 and the code `PERSISTENCE_FAILED`, and SHALL NOT change the corpse `status`.
4. WHEN a Séance spec is returned with `source` set to `generated` or `cache`, IF the corpse `status` is `INFECTED`, THEN THE Seance_Route SHALL set the corpse `status` to `IN_SEANCE` and SHALL return `IN_SEANCE` as the `status` in the response.
5. WHEN the Seance_Route returns a Séance spec, IF the corpse `status` is `IN_SEANCE`, `RESURRECTED`, or `FAILED`, THEN THE Seance_Route SHALL leave the `status` unchanged. This applies to every `source` value, including `stored`.
6. IF the status update of criterion 4 fails after the Séance spec was stored, THEN THE Seance_Route SHALL log one server-side entry that contains the corpse id and the failure reason and does not contain `original_code`, SHALL respond with HTTP status 200 and the stored Séance spec, SHALL return the unchanged `status` (`INFECTED`), and SHALL NOT delete the stored `seance_specs` row.
7. THE Seance_Route SHALL NOT issue any delete or update statement against `seance_specs`, so that for an existing row the values of `requirements_md`, `design_md`, `invariants_json`, and `approved_at` are identical before and after any Seance_Route request.
8. FOR ALL Owned_Corpses, WHEN two concurrent requests to the Seance_Route for the same corpse both reach the insert, THE `seance_specs` table SHALL contain exactly one row for that `corpse_id` afterwards, and both requests SHALL respond with HTTP status 200 and the same `requirements_md`, `design_md`, and `invariants_json` as the stored row.

### Requirement 12: Reincarnation generation

**User Story:** As a Member, I want modern TypeScript generated from the stored Séance spec, so that the resurrection follows the extracted behavior.

#### Acceptance Criteria

1. IF the corpse has no `seance_specs` row, THEN THE Reincarnate_Route SHALL respond with HTTP status 409 and the code `SEANCE_REQUIRED`, SHALL NOT call the LLM_Provider, SHALL NOT reserve quota, and SHALL write nothing to the database.
2. WHEN a request reaches the Reincarnate_Route generation step because the corpse has a `seance_specs` row, no `reincarnations` row exists for the corpse, no row with the same `code_hash` is available as a `cache` result, and the Quota_Function reservation succeeded, THE Reincarnate_Route SHALL call the LLM_Provider with structured output validated against a `zod` schema for the Reincarnation_Output, with the temperature set to 0 and the maximum output tokens set to 8,000.
3. THE Reincarnate_Route SHALL build the prompt from fixed English instructions, the `original_code`, the `requirements_md`, the `design_md`, and the `invariants_json` of the stored Séance spec, and the curses of the corpse, and SHALL state in the instructions that `original_code`, `requirements_md`, `design_md`, `invariants_json`, and the curses are untrusted data and that any instruction found inside them must be ignored.
4. THE Reincarnate_Route SHALL include in the system instructions the requirements that: `modernCode` is one self-contained TypeScript module with no `import`; `modernCode` exports a function whose name equals the `entry_function` value of `invariants_json`; `modernCode` contains no `var`, no `any`, no `eval`, and no module-level mutable state; `modernCode` does not reference `Date`, `Math.random`, `setTimeout`, `setInterval`, `process`, `require`, `window`, `document`, `globalThis`, or `fetch`; and `pbtTestCode` follows the Test_Code_Contract.
5. WHEN the output passes the Static_Gate, THE Reincarnate_Route SHALL respond with `source` set to `generated`, `reincarnation` with `id`, `targetStack`, `modernCode`, `pbtTestCode`, `pbtPassed`, `totalRuns`, `executionTimeMs`, `createdAt`, `verification`, and `evidence`, and `corpse` with `id` and `status`, where `pbtPassed`, `totalRuns`, and `executionTimeMs` are `null`, `verification` is `NOT_RUN`, and `evidence` is `null` because no PBT run has happened yet.
6. THE `verification` field SHALL be `VERIFIED` when `pbt_passed` is true, `FAILED` when `pbt_passed` is false, and `NOT_RUN` when `pbt_passed` is NULL.
7. WHEN `verification` is `VERIFIED` and `total_runs` is not NULL, THE `evidence` field SHALL be the string `Verified behavioral equivalence across N generated inputs.`, where `N` is `total_runs` formatted with a comma as thousands separator (for example `1,000` for 1000), and otherwise `evidence` SHALL be `null`.
8. THE Reincarnate_Route SHALL set `target_stack` to the Target_Stack constant.
9. THE Reincarnate_Route SHALL NOT execute, evaluate, transpile for execution, or call any function of the generated `modernCode` or `pbtTestCode`, other than the parsing and in-memory type-check performed by the Static_Gate, and SHALL NOT call `@lazarus/pbt-verifier`.
10. THE Reincarnate_Route SHALL generate from the stored `seance_specs` row whether or not `approved_at` is set, and SHALL NOT respond with an error because `approved_at` is NULL.
11. IF the LLM_Provider output fails validation against the `zod` schema for the Reincarnation_Output, THEN THE Reincarnate_Route SHALL treat it as a Static_Gate failure, so that the repair call of Requirement 13 criterion 11 and the response of Requirement 13 criterion 12 (HTTP status 502, code `LLM_OUTPUT_INVALID`, nothing written to the database, rejected output not returned) apply.

### Requirement 13: Static gate for generated code

**User Story:** As a maintainer, I want generated code checked against the exorcism rules without running it, so that obviously wrong output is never stored.

#### Acceptance Criteria

1. THE Static_Gate SHALL accept `modernCode` only when it is between 1 and 30,000 characters long and a type-check with the TypeScript compiler API, performed in memory with `strict: true`, the target `ES2022`, and the ES2022 default library declarations only (no DOM and no Node.js types), reports zero syntactic diagnostics and zero semantic diagnostics of category error, and SHALL stop the type-check after 10,000 ms and treat that case as a rejection of the type-check rule.
2. THE Static_Gate SHALL accept `modernCode` only when its parsed syntax tree contains no `import` declaration, no `export ... from` declaration, no dynamic `import()` expression, and no call to an identifier named `require`.
3. THE Static_Gate SHALL accept `modernCode` only when it exports a function declaration or function-valued constant whose name equals, in a case-sensitive exact match, the `entry_function` of the stored Invariants_Document.
4. IF the stored Invariants_Document is missing or its `entry_function` is not a non-empty string, THEN THE Static_Gate SHALL reject `modernCode` for the entry-function rule.
5. THE Static_Gate SHALL accept `modernCode` only when its parsed syntax tree contains no `var` declaration, no `any` type annotation, no call to `eval`, no `new Function` expression, no module-level `let` binding that is reassigned, no identifier `Date`, `setTimeout`, `setInterval`, `process`, `require`, `window`, `document`, `globalThis`, or `fetch`, and no member expression `Math.random`, where text inside comments and string literals does not count as a reference.
6. THE Static_Gate SHALL accept `pbtTestCode` only when it is between 1 and 10,000 characters long and parses without syntax errors as the body of a function with the parameters `fc`, `legacyFn`, `modernFn`, `assertEquivalent`, and `numRuns`.
7. THE Static_Gate SHALL accept `pbtTestCode` only when it contains no `import`, `export`, or `require`, its last top-level statement is a `return` statement of a call to `fc.property` or `fc.asyncProperty`, it contains no call to `fc.assert` or `fc.check`, and it contains no object literal property named `numRuns`, so that the run count stays under the control of the runner.
8. THE Static_Gate SHALL accept `pbtTestCode` only when it contains at least one reference to the identifier `assertEquivalent` outside comments and string literals.
9. THE Static_Gate SHALL accept a Reincarnation_Output only when no string value in it, including comments and string literals inside `modernCode` and `pbtTestCode`, contains a Forbidden_Phrase.
10. THE Static_Gate SHALL evaluate every rule of criteria 1 to 9 on each output and SHALL return the complete list of failed rule names, so that a failure of one rule does not hide a failure of another.
11. IF the first output fails the Static_Gate, THEN THE Reincarnate_Route SHALL make exactly one second provider call that adds the failed rule names and, for a type-check failure, up to 10 diagnostics with line, column, error code, and text, subject to Requirement 15 criterion 3, and SHALL apply the Static_Gate to the second output.
12. IF the second output fails the Static_Gate, THEN THE Reincarnate_Route SHALL respond with HTTP status 502 and an Error_Envelope with the code `LLM_OUTPUT_INVALID`, SHALL write no row to the `reincarnations` table or any other table except the Usage_Ledger row already recorded by the Quota_Function, and SHALL NOT include the rejected output in the response.
13. THE Static_Gate SHALL read no file other than the library declaration files shipped in the `typescript` package, SHALL write no file, and SHALL return the same verdict and the same failed rule names for identical inputs, except when the type-check timeout of criterion 1 applies.

### Requirement 14: Reincarnation persistence and corpse status

**User Story:** As a Member, I want the generated module stored with an honest verification state, so that The Crypt never shows evidence that was not produced.

#### Acceptance Criteria

1. WHEN the Reincarnation_Output passes the Static_Gate for an Owned_Corpse, THE Reincarnate_Route SHALL insert exactly one `reincarnations` row with the Server_Client, with `corpse_id` set to the requested corpse, `target_stack` set to the Target_Stack, `modern_code` and `pbt_test_code` set unchanged to the Reincarnation_Output values, and `pbt_passed`, `total_runs`, and `execution_time_ms` set to NULL, and SHALL return the inserted row with `source` set to `generated`.
2. IF the insert fails because a `reincarnations` row for the requested corpse already exists (unique violation), THEN THE Reincarnate_Route SHALL read that row with the Server_Client, discard the generated Reincarnation_Output, insert no other row, and respond with HTTP status 200 and the stored row with `source` set to `stored`.
3. IF the insert fails for any reason other than a unique violation, or IF the read of criterion 2 returns a database error or no row, THEN THE Reincarnate_Route SHALL respond with HTTP status 500 and the Error_Envelope code `PERSISTENCE_FAILED`, SHALL NOT return the generated Reincarnation_Output, and SHALL leave the corpse `status` unchanged.
4. WHEN the Reincarnate_Route is about to return a `reincarnations` row of an Owned_Corpse with `source` set to `stored`, `cache`, or `generated`, the row has `pbt_passed` equal to true, and the corpse `status` is not `RESURRECTED`, THE Reincarnate_Route SHALL set the corpse `status` to `RESURRECTED` with the Server_Client before responding, and SHALL return `status` equal to `RESURRECTED` in the response.
5. WHEN the Reincarnate_Route returns a `reincarnations` row whose `pbt_passed` is NULL or false, THE Reincarnate_Route SHALL leave the corpse `status` unchanged and SHALL issue no status update.
6. THE Pipeline_API SHALL NOT set the corpse `status` to `FAILED` on any request path, including provider failure, timeout, validation failure, Static_Gate failure, quota denial, and persistence failure, because none of these is a verification failure. The status `FAILED` is set only by `POST /api/verify` of `08-live-verification-api`, after a completed verification run found a difference.
7. IF the status update of criterion 4 fails after the reincarnation row was stored or read, THEN THE Reincarnate_Route SHALL write one server-side log entry that contains the corpse id and the failure kind and contains no source code and no Server_Only_Variables value, and SHALL respond with HTTP status 200, the reincarnation row with its `source`, and the `status` the corpse had before the update attempt.
8. THE Reincarnate_Route SHALL NOT issue a delete or an update on any existing `reincarnations` row, so that its only writes are the insert of criterion 1, the copy insert of Requirement 7 criterion 4, and the corpse `status` update of criterion 4.

### Requirement 15: Provider call policy

**User Story:** As an operator, I want bounded, predictable provider calls, so that a slow or failing provider cannot hang requests or multiply cost.

#### Acceptance Criteria

1. THE Pipeline_API SHALL call the LLM_Provider only from the LLM_Routes and only through one module, `apps/web/src/lib/llm/generate.ts`, that wraps the Vercel AI SDK structured-output function of the installed version, so that tests replace the provider with a mock language model.
2. WHEN a single provider call has been running for Provider_Call_Timeout (45,000 ms) without completing, THE Pipeline_API SHALL abort that call. The timeout of a second call SHALL be the smaller of Provider_Call_Timeout and the time remaining until the Request_Deadline.
3. THE Pipeline_API SHALL make at most 2 provider calls per request, counting the first call and one second call, whether the second call is a repair call (Requirements 10 and 13) or a fallback call (criterion 4). THE Pipeline_API SHALL use exactly one Quota_Function reservation for the whole request, regardless of whether 1 or 2 provider calls are made.
4. WHERE the Google fallback is enabled under Requirement 2 criterion 2, IF the first call fails with a provider error (a thrown error from the LLM_Provider other than an invalid-output error), a timeout under criterion 2, or HTTP status 429 or 5xx from the provider, THEN THE Pipeline_API SHALL make the second call with the Google provider and `LLM_FALLBACK_MODEL`. THE Pipeline_API SHALL NOT make a fallback call for an invalid output, for HTTP status 401 or 403 (criterion 8), or after the Request_Deadline has passed.
5. IF a provider call fails with a provider error and no second call is allowed (the first call was a repair call, or the second call has already been made) or enabled, or IF the second call also fails with a provider error, THEN THE route SHALL respond with HTTP status 502 and an Error_Envelope with the code `LLM_PROVIDER_ERROR`.
6. IF a provider call times out under criterion 2 and no second call is allowed or enabled, or IF the Request_Deadline passes, or IF the second call also times out, THEN THE route SHALL respond with HTTP status 504 and an Error_Envelope with the code `LLM_TIMEOUT`.
7. THE Pipeline_API SHALL NOT include the provider's error text, the provider's request id, or any header from the provider in a response body. The Error_Envelope `message` SHALL be a fixed English text that does not vary with the provider's response.
8. IF a provider call (first or second) returns HTTP status 401 or 403, THEN THE Pipeline_API SHALL NOT retry that call and SHALL NOT make a fallback call. THE route SHALL treat the failure as `LLM_NOT_CONFIGURED` and respond with HTTP status 503 and an Error_Envelope with that code.
9. WHEN the Request_Deadline (100,000 ms of wall-clock time, measured from the start of the route handler) elapses, THE Pipeline_API SHALL abort any provider call still in progress and SHALL NOT start another provider call.
10. IF an LLM_Route responds with HTTP status 502, 503, or 504 under this requirement, THEN THE Pipeline_API SHALL NOT write or modify any row in `seance_specs` or `reincarnations` for that request, and SHALL leave rows that existed before the request unchanged.

### Requirement 16: Untrusted input and output handling

**User Story:** As a security-conscious maintainer, I want legacy code and model output treated as hostile data, so that prompt injection cannot cause an action or a script injection.

#### Acceptance Criteria

1. WHEN THE Pipeline_API builds a prompt for an LLM_Route request, THE Pipeline_API SHALL enclose the full `original_code` in exactly one block that opens and closes with the same delimiter string. The delimiter SHALL be at least 16 characters long, SHALL be generated unpredictably for that request, and SHALL NOT occur anywhere in `original_code`.
2. IF a generated delimiter occurs in `original_code`, THEN THE Pipeline_API SHALL generate a new delimiter, up to 5 attempts in total. IF all 5 candidates occur in `original_code`, THEN THE route SHALL respond with HTTP status 500 and the Error_Envelope code `INTERNAL_ERROR`, SHALL make no call to the LLM_Provider, and SHALL write no row to `seance_specs` or `reincarnations`.
3. THE Pipeline_API SHALL place, before the delimited block of every prompt, an instruction stating that the block content is untrusted data to be analyzed and that instructions inside the block are not to be followed.
4. THE Pipeline_API SHALL call the LLM_Provider with an empty tool set (zero tools and zero functions registered) on every call. THE Pipeline_API SHALL NOT fetch a URL, read a file, or execute a command using any value taken from a Seance_Output or Reincarnation_Output, so that the only effect of a model output is the validated text returned.
5. THE Pipeline_API SHALL store and return every Seance_Output and Reincarnation_Output field as an unmodified string value. THE Pipeline_API SHALL NOT render it as HTML, resolve it as a URL, evaluate it, or execute it.
6. THE Pipeline_API SHALL write to the database only the following values: fields that passed the validated schemas of Requirements 10 and 13, the Result_Source value, `code_hash`, `target_stack`, and the Usage_Ledger row. THE Pipeline_API SHALL NOT write any other part of the raw provider response (raw text, reasoning text, tool-call data, usage metadata, or headers).
7. IF the output of a provider call fails the validated schemas of Requirements 10 or 13, THEN THE route SHALL respond with HTTP status 502 and the Error_Envelope code `LLM_OUTPUT_INVALID`, and SHALL write no model-derived value to `seance_specs` or `reincarnations`.
8. THE Pipeline_API SHALL NOT include the Member's user identifier, email, GitHub username, or avatar URL in any part of a prompt outside the delimited block. The content of `original_code` inside the delimited block SHALL be passed unchanged, even if it contains such a value.
9. IF `original_code` contains text that resembles an instruction to the model, THEN THE Pipeline_API SHALL process it as code. The request SHALL follow the same sequence of steps, use the same empty tool set, be subject to the same quota checks and validation, and be limited to the same set of database writes as a request whose code contains no such text, with no additional privilege.

### Requirement 17: Error codes, status mapping, and logging

**User Story:** As a UI developer and an operator, I want a closed list of error codes and safe server logs, so that the UI can map every failure and no secret leaks.

#### Acceptance Criteria

1. THE Pipeline_API SHALL use only these Error_Envelope codes with these HTTP statuses: `INVALID_REQUEST` 400, `AUTH_REQUIRED` 401, `FORBIDDEN_ORIGIN` 403, `NOT_FOUND` 404, `NOT_PRECOMPUTED` 404, `METHOD_NOT_ALLOWED` 405, `SEANCE_REQUIRED` 409, `REQUEST_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `SOURCE_TOO_LARGE` 422, `SOURCE_SYNTAX_ERROR` 422, `SOURCE_NOT_SCANNABLE` 422, `NO_ENTRY_FUNCTION` 422, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500, `PERSISTENCE_FAILED` 500, `LLM_OUTPUT_INVALID` 502, `LLM_PROVIDER_ERROR` 502, `LLM_NOT_CONFIGURED` 503, `QUOTA_UNAVAILABLE` 503, and `LLM_TIMEOUT` 504.
2. WHEN Scan_Route, Seance_Route, or Reincarnate_Route responds with an HTTP status of 400 or higher, THE Pipeline_API SHALL return an Error_Envelope whose `ok` is `false`, whose `code` is one of the codes in criterion 1, and whose HTTP status equals the status that criterion 1 lists for that code.
3. THE Pipeline_API SHALL return for each code one fixed English `message` of 1 to 200 characters that is identical on every occurrence of that code and contains no stack trace, SQL statement, SQLSTATE, policy name, Supabase error body, provider error text, file path, or prompt text.
4. IF an exception occurs that no other requirement of this spec maps to an Error_Envelope code, THEN THE Pipeline_API SHALL respond with HTTP status 500 and the code `INTERNAL_ERROR`, and SHALL complete the Route Handler without rethrowing the exception.
5. WHEN a request to Scan_Route, Seance_Route, or Reincarnate_Route fails with an Error_Envelope, THE Pipeline_API SHALL write exactly one server-side log line containing the route name, the error code, the corpse id, and the elapsed time as a non-negative integer number of milliseconds measured from the start of the Route Handler to the response.
6. IF the corpse id is not available when a request fails (for example, the Request_Body is missing or invalid), THEN THE Pipeline_API SHALL write the log line of criterion 5 with the corpse id field recorded as absent.
7. THE Pipeline_API SHALL NOT write `original_code`, prompt text, model output, a user's email address, any LLM_Config value, or any Server_Only_Variables value to any log line.
8. THE Pipeline_API SHALL write every Error_Envelope `message` and every log line in English.

### Requirement 18: Database migration `V3`

**User Story:** As a maintainer, I want the new database objects defined by one reviewed Flyway migration with RLS, so that the rate limit and the one-result rule are enforced by the database.

#### Acceptance Criteria

1. THE migration `db/migrations/V3__llm_pipeline_support.sql` SHALL create the table `public.llm_usage_events` with `id` (uuid, default `gen_random_uuid()`), `user_id` (uuid, NOT NULL, references `profiles(id)` with `ON DELETE CASCADE`), `route` (text, NOT NULL, `CHECK (route IN ('seance', 'reincarnate'))`), and `created_at` (timestamptz, NOT NULL, default `now()`), with an index on `(user_id, created_at)` and an index on `created_at`.
2. THE migration SHALL run `ENABLE ROW LEVEL SECURITY` on `public.llm_usage_events`, SHALL define no policy for `anon` or `authenticated`, and SHALL revoke all table privileges on it from `PUBLIC`, `anon`, and `authenticated`.
3. THE migration SHALL create `public.reserve_llm_call(p_route text, p_user_limit integer, p_user_window interval, p_global_limit integer, p_global_window interval)` as `SECURITY DEFINER` with a fixed `search_path`, returning three values: whether the request is allowed (boolean), which limit denied it (`user`, `global`, or `none`), and the retry-after seconds (integer), and SHALL serialize concurrent calls so that Requirement 8 criterion 4 holds.
4. THE migration SHALL revoke `EXECUTE` on `public.reserve_llm_call` from `PUBLIC` and `anon`, and SHALL grant it to `authenticated` only.
5. IF `auth.uid()` is NULL, or `p_route` is not `seance` or `reincarnate`, or `p_user_limit` or `p_global_limit` is NULL or less than 1, or `p_user_window` or `p_global_window` is NULL or not a positive interval, THEN THE function `public.reserve_llm_call` SHALL raise an error, SHALL insert no row into the Usage_Ledger, and SHALL delete no row, so that the route responds with `QUOTA_UNAVAILABLE` as defined in Requirement 8 criterion 7.
6. THE migration SHALL create `public.replace_corpse_curses(p_corpse_id uuid, p_curses jsonb)` as `SECURITY INVOKER`, so that RLS decides whether the caller may write. WHEN the caller may write the corpse and `p_curses` is a JSON array, THE function SHALL delete the `curses` rows of the corpse and insert one row for each element of `p_curses` (none for an empty array) in one transaction under a per-corpse advisory lock. THE migration SHALL revoke `EXECUTE` on the function from `PUBLIC` and `anon` and grant it to `authenticated`.
7. THE migration SHALL create a unique index on `seance_specs (corpse_id)` and a unique index on `reincarnations (corpse_id)`, and SHALL apply to the seeded database without error because the Foundation seed holds one row per Sample_Corpse in each table.
8. THE migration SHALL write every use of the current user id as `(select auth.uid())` where it is used in an expression of a policy, and SHALL NOT define any policy on the existing Lazarus tables.
9. THE migration SHALL NOT modify, drop, or recreate any object of `V1` or `V2`, and SHALL contain English comments only.
10. THE Verification_Suite SHALL gain tests that run under `TEST_DATABASE_URL` and are skipped when it is unset, as defined in Foundation Requirement 16, covering: `anon` cannot read, write, or execute any new object; `authenticated` cannot read or write `llm_usage_events` directly; the 21st reservation in 60 minutes by one user is denied with denying limit `user` and a retry-after from 1 to 3,600 seconds; 25 concurrent reservations by one user in 60 minutes yield exactly 20 allowed results; a denied call inserts no row; a call with an invalid argument raises an error and inserts no row; reservations of one user do not count for another user; the global limit denies with denying limit `global`; a second `seance_specs` or `reincarnations` row for one corpse is rejected; and `replace_corpse_curses` raises an error and leaves the `curses` rows unchanged for a corpse of another user, for a Sample_Corpse, and for a `p_curses` value that is not a JSON array.
11. WHEN an authenticated caller invokes `public.reserve_llm_call` with an allowed `p_route`, positive limit and window arguments, fewer than `p_user_limit` Usage_Ledger rows of that user with `created_at` inside the last `p_user_window`, and fewer than `p_global_limit` Usage_Ledger rows of all users with `created_at` inside the last `p_global_window`, THE function SHALL insert exactly one row with `user_id` equal to `auth.uid()` and `route` equal to `p_route`, and SHALL return allowed `true`, denying limit `none`, and retry-after `0`.
12. IF the count of the user's rows inside `p_user_window` is greater than or equal to `p_user_limit`, or the count of all rows inside `p_global_window` is greater than or equal to `p_global_limit`, THEN THE function `public.reserve_llm_call` SHALL insert no row and SHALL return allowed `false`, denying limit `user` when the user limit is reached (including when both limits are reached) or `global` otherwise, and a retry-after integer from 1 to 86,400 seconds equal to the time until the oldest counted row of the exceeded window leaves that window, rounded up to the next whole second. Rows with `created_at` outside the window SHALL NOT be counted.
13. IF the caller may not write the corpse passed to `public.replace_corpse_curses` (a corpse of another user, a Sample_Corpse, or an id that does not exist), or `p_curses` is not a JSON array, THEN THE function SHALL raise an error and SHALL leave all `curses` rows of the corpse unchanged.

### Requirement 19: Wording of stored and returned text

**User Story:** As a product owner, I want the pipeline to describe results as empirical evidence only, so that Lazarus never claims more than the tests show.

#### Acceptance Criteria

1. THE system instructions of the Seance_Route and of the Reincarnate_Route SHALL instruct the model to describe equivalence only as empirical evidence and never as a proof, to avoid every Forbidden_Phrase, and to state no verification outcome and no number of runs, because the Pipeline_API supplies the only verification text through `evidence`.
2. IF a string in a Seance_Output or a Reincarnation_Output contains a Forbidden_Phrase (case-insensitive substring match, including inside code comments), THEN THE Pipeline_API SHALL treat the output as invalid under Requirement 10 criterion 5 or Requirement 13 criterion 9, SHALL apply the single retry and the final `LLM_OUTPUT_INVALID` response of Requirement 10 criteria 6 and 7 or Requirement 13 criteria 11 and 12, SHALL write nothing to the database, and SHALL NOT return the rejected output.
3. THE Pipeline_API SHALL set the `evidence` string only as defined in Requirement 12 criterion 7, and SHALL NOT author any other string that states or implies a verification outcome in a response, in an Error_Envelope message, or in a stored row.
4. WHEN a response of the Reincarnate_Route has `verification` equal to `NOT_RUN`, THE Pipeline_API SHALL set `evidence` to `null` and SHALL NOT include any of the words `verified`, `tested`, `proven`, `proof`, or `equivalent` (case-insensitive, whole word) in any string value of that response other than `modernCode` and `pbtTestCode`.
5. WHEN a response of the Reincarnate_Route has `verification` equal to `FAILED`, THE Pipeline_API SHALL set `evidence` to `null` and SHALL NOT include any of the words `verified`, `proven`, or `proof` (case-insensitive, whole word) in any string value of that response other than `modernCode` and `pbtTestCode`.
6. THE Pipeline_API SHALL NOT include a Forbidden_Phrase in any string it authors itself, including every `evidence` value and every Error_Envelope message of the Scan_Route, the Seance_Route, and the Reincarnate_Route.

### Requirement 20: Tests

**User Story:** As a maintainer, I want automated tests that need no network, no key, and no database, so that the security and cost rules are checked on every `pnpm test`.

#### Acceptance Criteria

1. WHEN `pnpm test` runs, THE Web_App SHALL execute the Pipeline_API tests with Vitest in single-run mode, SHALL replace the LLM_Provider with a mock language model and the Server_Client with a fake client, and SHALL NOT require a database, a network connection, a Supabase project, or an LLM_Config variable.
2. THE tests SHALL include a property-based test (`fast-check`, explicit `numRuns` of at least 100) that generates every combination of Request_Body, corpse kind (Sample_Corpse, Owned_Corpse, corpse owned by another Member), caller identity (Visitor or Member), cache result (hit or miss), eligibility result (passed or failed), and fake Quota_Function result (allowed, denied, or error), and asserts that the mock LLM_Provider is called only when the caller is a Member, the corpse is owned, the cache missed, the eligibility checks passed, and the fake Quota_Function allowed (Requirement 4 criteria 7 and 8), and that it is called at most 2 times per request.
3. THE tests SHALL include a property-based test (`fast-check`, explicit `numRuns` of at least 100) that asserts every Visitor request, whatever the body, yields 0 calls to the mock LLM_Provider and 0 write calls on the fake client.
4. THE tests SHALL cover the Request_Body validation with one accepted example and one rejected example for each of: missing `corpseId` key, extra key, non-UUID `corpseId` value, JSON array body, body of 1,025 bytes (rejected) and body of exactly 1,024 bytes (accepted when otherwise valid), wrong content type, missing `Origin`, and `Origin` different from the request origin. Each rejected example SHALL yield an Error_Envelope with a status and code from the list of Requirement 17 criterion 1, 0 calls to the mock LLM_Provider, and 0 write calls on the fake client. The tests SHALL also include a property-based test (`fast-check`, explicit `numRuns` of at least 100) that every accepted body is a JSON object with exactly the key `corpseId` whose value is a UUID.
5. THE tests SHALL include a property-based test (`fast-check`, explicit `numRuns` of at least 100) for the Séance output validation: every value generated to satisfy Requirement 10 criteria 1 to 5 is accepted, and a value with exactly one of those rules broken is rejected, with the rejection naming the broken rule.
6. THE tests SHALL cover the Static_Gate with one rejected example for each rule of Requirement 13 criteria 1 to 3 and 5 to 9 (8 rejected examples, each asserting the name of the rule that rejected it) and one accepted example for each of the three seed languages (3 accepted examples), using the `modern_code` and `pbt_test_code` of the Foundation seed files in `db/seed/`.
7. THE tests SHALL cover each of the following, with at least one test per item: the cache order of Requirement 7, the unique-violation path of Requirement 11 criterion 2, the unique-violation path of Requirement 14 criterion 2, the status transitions of Requirement 11 criterion 4, the status transitions of Requirement 14 criteria 4 to 6, and the second-call rule of Requirement 15 criteria 3 and 4 (a repair call versus a fallback call, with a maximum of 2 provider calls per request).
8. THE tests SHALL assert that every response status and code produced by the routes, in every test of the Pipeline_API suite, is in the list of Requirement 17 criterion 1, and that no response body contains the text of a mock provider error, the text of a mock SQL error, the mock API key value, or any part of a prompt sent to the mock LLM_Provider.
9. THE tests SHALL assert that no module under `apps/web/src/lib/llm/` or `apps/web/src/lib/pipeline/` is imported, directly or through another module, by a Client Component (a file that starts with the `"use client"` directive), and the existing production-bundle test of `04-web-shell-auth` (Requirement 15 criterion 7) SHALL include the 4 LLM_Config variable names in its search list and keep passing.
10. THE tests SHALL assert, by scanning the source files of the Pipeline_API (excluding test files), that they contain no import of `@lazarus/pbt-verifier`, `node:vm`, or `node:child_process`, and no call to `eval` or `new Function`.
11. THE tests SHALL include the text `Requirement <N>` in the name of each test for every requirement number it covers, and SHALL put the traceability comment `// Feature: 05-llm-pipeline-api, Property <N>: <title>` as the first line of each property-based test, as defined in `testing-conventions.md`.
12. THE tests SHALL describe results as empirical evidence and SHALL assert, with a case-insensitive comparison, that no Forbidden_Phrase appears in any test name, assertion message, or fixture, except in fixtures whose test name states that they test the rejection of Forbidden_Phrases.
13. IF a Pipeline_API test attempts a network connection, reads an LLM_Config variable that the test did not set explicitly, or opens a database connection, THEN THE Web_App SHALL fail that test with an error that names the attempted access, and SHALL leave the other tests running.
14. WHEN `pnpm test` runs the Pipeline_API tests on a machine with no network connection and none of the LLM_Config variables set, THE Web_App SHALL complete the Pipeline_API tests within 60,000 ms with 0 failed tests and 0 skipped tests.

### Requirement 21: Documentation and scope boundary

**User Story:** As a reviewer and a new contributor, I want the pipeline documented and the scope limited, so that the review covers only this stage.

#### Acceptance Criteria

1. THE Web_App SHALL extend `apps/web/README.md` with one new section written in English, without removing or altering any pre-existing README content, that lists for each of Scan_Route, Seance_Route, and Reincarnate_Route: the route name, the Request_Body shape, the success response shape, and the four Result_Source values (`precomputed`, `stored`, `cache`, `generated`) that the LLM_Routes can report.
2. THE Web_App SHALL state in the new README section that a Visitor never triggers an LLM call and that the service role key is never used by the Pipeline_API.
3. THE Pipeline_API SHALL limit the files it adds or modifies to: files under `apps/web`, the migration `db/migrations/V3__llm_pipeline_support.sql`, the new and updated Verification_Suite tests under `db/tests/`, the update of the Foundation test that asserts the exact migration list, the `.env.example` update of Requirement 2 criterion 10, and the `pnpm-lock.yaml` update, so that a diff of the implementation against its base revision shows zero added or modified files outside this list.
4. THE Web_App SHALL list in the new README section every error code that Scan_Route, Seance_Route, or Reincarnate_Route can return in an Error_Envelope, with one English sentence per code that states the condition that produces it, so that the set of documented codes equals the set of codes defined in the Pipeline_API source with no omissions and no extra entries.
5. THE Web_App SHALL state in the new README section: the User_Quota value (20 reservations per user per rolling 60 minutes) and the Global_Quota value (500 reservations in total per rolling 24 hours); for each limit, the name of the configuration location that holds its value, so that a contributor can change it; the cache rule, defined as "a stored row of another visible corpse with the same `code_hash` is reused and no LLM call is made"; and the statement that user corpses are generated but not executed until `08-live-verification-api` enables live verification (which builds on `07-sandboxed-execution`).

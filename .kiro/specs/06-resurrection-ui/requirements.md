# Requirements Document

## Introduction

This spec adds the user interface for stages 2 to 4 of the Lazarus workflow to the existing `apps/web` application. It replaces the "Next stages" placeholder that `04-web-shell-auth` left on the corpse page with three working sections:

1. **The Hex Scanner**: the stored curses of a corpse with exact line numbers, cross-referenced with the legacy source.
2. **The Séance Chamber**: the extracted `requirements.md` (EARS notation), `design.md`, and the input/output invariants, with an approval control for the owner.
3. **The Laboratory**: the reincarnated TypeScript, the property-based test, and the verification result shown as empirical evidence with the exact run count (for example "Verified behavioral equivalence across 1,000 generated inputs."). For the owner of a corpse whose reincarnation is not verified yet, it also offers a "Verify live" control that calls the verification endpoint of `08-live-verification-api` (Requirement 18).

Two kinds of user are served:

- **Visitors (Judge/Sandbox mode)** see the precomputed results of the three Sample_Corpses. The page contains no control that calls the Pipeline_API or writes data for them, so a Visitor can never trigger a model call.
- **Members** who own a corpse can run the Hex Scanner, start the Séance, approve the generated spec, start the Reincarnation by calling the routes of `05-llm-pipeline-api`, and start a live verification of a stored reincarnation by calling the route of `08-live-verification-api`. The UI shows loading, success (generated, stored, cache hit, or executed), failure, and rate-limit states.

All displayed results are read from the database through the per-request Supabase client (Row Level Security decides what is visible). The UI never renders the body of an API response; after a successful call it refreshes the page so that the stored rows are the single source of truth.

**Prerequisites.** `01-lazarus-foundation` (schema, RLS, and three Sample_Corpses with curses, a Séance spec, and a reincarnation each), `04-web-shell-auth` (corpse page, data layer, `getCurrentMember()`, theme, `Reveal` animation), `05-llm-pipeline-api` (the routes `POST /api/scan`, `POST /api/seance`, `POST /api/reincarnate`), and `08-live-verification-api` (the route `POST /api/verify`, which in turn depends on `07-sandboxed-execution`). Specs 05 and 08 may still change. This spec uses only the route names, the request body `{ "corpseId": "<uuid>" }`, the `ok` and `source` fields of a success response, the `error.code` field of an error response, and the `Retry-After` header. Every assumption is listed in the Open Items of `design.md`.

**Supersedes.** Requirement 10 criterion 6 and Requirement 17 criterion 3 of `04-web-shell-auth` (the placeholder for the later stages).

**Out of scope** (separate specs): the Route Handlers, the model calls, the rate limit, and the cache by `code_hash` (`05-llm-pipeline-api`); running legacy or generated code, the verification route, its deadline, its limits, and its on/off switch (`03-pbt-verifier`, `07-sandboxed-execution`, `08-live-verification-api`); streaming progress (not planned in any spec: the routes return one JSON document, the UI shows an indeterminate pending message, and adding streaming later would need changes in the route specs first); re-running a verification that already has a final result; regenerating or editing an existing result; side-by-side diff of the legacy and modern code; export or download of results; any new table or migration; the service role key.

## Glossary

- **Web_App**, **Visitor**, **Member**, **Sample_Corpse**, **Owned_Corpse**, **Server_Client**, **Corpse_Page**, **Status_Badge**, **Theme_Tokens**, **Reveal_Timeline**, **Safe_Redirect_Path**, **Claims**: As defined in `04-web-shell-auth`.
- **Pipeline_API**: The three Route Handlers of `05-llm-pipeline-api`: `Scan_Route` (`POST /api/scan`), `Seance_Route` (`POST /api/seance`), and `Reincarnate_Route` (`POST /api/reincarnate`), plus the `Verify_Route` (`POST /api/verify`) of `08-live-verification-api`. This spec calls all four through the same Stage_Actions pattern.
- **Result_Source**: The `source` field of a success response of the Pipeline_API. The accepted values depend on the route: `precomputed`, `stored`, `cache`, or `generated` for the Scan_Route, Seance_Route, and Reincarnate_Route; `precomputed`, `stored`, or `executed` for the Verify_Route.
- **Error_Code**: The `error.code` value of an error response of the Pipeline_API, from the closed list of 26 codes: the 21 codes in Requirement 17 of `05-llm-pipeline-api` plus the five codes `REINCARNATION_REQUIRED`, `VERIFICATION_DISABLED`, `VERIFICATION_BUSY`, `VERIFICATION_INCONCLUSIVE`, and `SANDBOX_UNAVAILABLE` of `08-live-verification-api`.
- **Stage_Sections**: The three sections of the Corpse_Page with the ids `hex-scanner`, `seance-chamber`, and `laboratory`.
- **Stage_Overview**: The navigation block above the Stage_Sections that links to each section and shows its state in words.
- **Hex_Scanner_Panel**, **Seance_Panel**, **Laboratory_Panel**: The content of the three Stage_Sections.
- **Stored_Seance**: The row of `public.seance_specs` for a corpse (`requirements_md`, `design_md`, `invariants_json`, `approved_at`).
- **Stored_Reincarnation**: The most recent row of `public.reincarnations` for a corpse.
- **Invariants_Document**: The parsed value of `invariants_json` with the keys `entry_function`, `input`, `output`, and `invariants`.
- **Spec_Markdown**: The restricted text format of `requirements_md` and `design_md`: headings (`#` to `###`), numbered and bulleted lines, paragraphs, fenced code blocks, and inline code spans. No other markdown feature is interpreted.
- **EARS_Criterion**: A numbered or bulleted line of `requirements_md` that starts with `THE`, `WHEN`, `WHILE`, `IF`, or `WHERE` (uppercase) and contains the uppercase word `SHALL`.
- **Verification_State**: One of `VERIFIED`, `FAILED`, `NOT_RUN`, or `INCOMPLETE`, derived from `pbt_passed` and `total_runs` of a Stored_Reincarnation (Requirement 6).
- **Evidence_Text**: The sentence `Verified behavioral equivalence across N generated inputs.` where `N` is `total_runs` with a comma as the thousands separator.
- **Stage_Access**: One of `visitor` (no session), `member-viewer` (a Member looking at a corpse the Member does not own, which is a Sample_Corpse), or `owner` (a Member looking at an Owned_Corpse).
- **Stage_Controls**: The set of actions the page offers for a Stage_Access and the stored state: scan, start séance, approve spec, start reincarnation, and verify live.
- **Verify_Control**: The `verify` entry of the Stage_Controls: the "Verify live" button of the Laboratory_Panel that calls the Verify_Route (Requirement 18).
- **Stage_Actions**: The Client Component that renders a trigger control for one Pipeline_API route, sends the request, and shows its outcome.
- **Pipeline_Outcome**: The parsed result of one Pipeline_API call: a success with a Result_Source, or a failure with an Error_Code (or `NETWORK`, `CLIENT_TIMEOUT`, or `UNKNOWN`), the HTTP status, and the `Retry-After` seconds when present.
- **Client_Timeout**: The longest time the browser waits for one Pipeline_API response. It is 110,000 ms for the Scan_Route, Seance_Route, and Reincarnate_Route (longer than the 100,000 ms request deadline of `05-llm-pipeline-api`), and the named constant Verify_Client_Timeout for the Verify_Route.
- **Verify_Client_Timeout**: 70,000 ms, the Client_Timeout of the Verify_Route. It is longer than the 60 s server deadline that `08-live-verification-api` fixes for a verification request.
- **Forbidden_Terms**: The claim phrases listed in the Glossary of `05-llm-pipeline-api` and in the wording rules of `ui-components.md`. The constant array lives in `apps/web/src/lib/stages/wording.ts` and the tests iterate over it.

## Requirements

### Requirement 1: Stage sections and overview

**User Story:** As a user, I want the three resurrection stages laid out in order on the corpse page, so that I can see where a corpse stands and jump to any stage.

#### Acceptance Criteria

1. THE Corpse_Page SHALL render, below the legacy source view, the Stage_Sections in this order: Hex Scanner (`id="hex-scanner"`), Séance Chamber (`id="seance-chamber"`), and Laboratory (`id="laboratory"`), each with a heading and an accessible name.
2. THE Corpse_Page SHALL NOT render the "Next stages" placeholder of `04-web-shell-auth`, and the component `next-stages.tsx` SHALL be removed from the Web_App.
3. THE Corpse_Page SHALL render the Stage_Overview as a `nav` element with an accessible name that contains one link per Stage_Section, and each link SHALL show the stage name and its state in words.
4. THE state words SHALL be computed by one pure function from stored data only: Hex Scanner shows the number of stored curses or "No curses stored"; Séance Chamber shows "Not started", "Awaiting approval", or "Approved"; Laboratory shows "Not started" or the label of its Verification_State.
5. THE Web_App SHALL render the Stage_Overview and the Stage_Sections in the server-rendered HTML in their final visible state, so that the page is readable when JavaScript is disabled or fails to load.
6. THE Corpse_Page SHALL keep its existing header, notice, delete control, legacy source view, route, and 404 behavior unchanged.

### Requirement 2: Stage data loading

**User Story:** As a developer, I want the stage data read through the same safe path as the rest of the page, so that Row Level Security decides who can see what.

#### Acceptance Criteria

1. THE Web_App SHALL read the stage data only with the Server_Client of the current request, so that the database role is `anon` for a Visitor and `authenticated` for a Member and RLS limits the rows to Sample_Corpses and Owned_Corpses.
2. THE Corpse_Page SHALL load for each curse the id, type, severity, line number, description, and exorcism strategy, ordered by ascending line number and then ascending curse type, as part of the existing corpse query.
3. THE Web_App SHALL load the Stored_Seance of the corpse with `id`, `requirements_md`, `design_md`, `invariants_json`, and `approved_at`, and SHALL use the first row when more than one exists.
4. THE Web_App SHALL load the Stored_Reincarnation of the corpse with `id`, `target_stack`, `modern_code`, `pbt_test_code`, `pbt_passed`, `total_runs`, `execution_time_ms`, and `created_at`, using the row with the latest `created_at` when more than one exists.
5. THE Web_App SHALL parse `invariants_json` into an Invariants_Document only when it is an object with exactly the keys `entry_function`, `input`, and `output` (non-empty strings) and `invariants` (an array of strings), and SHALL otherwise treat the invariants as unreadable without failing the page.
6. THE Web_App SHALL validate every loaded row with runtime type guards, and a row with an unexpected shape SHALL raise the generic `DataError` of `04-web-shell-auth`.
7. THE Corpse_Page SHALL issue at most two queries for the stage data in addition to the existing corpse query (one for the Stored_Seance and one for the Stored_Reincarnation), run concurrently, and SHALL NOT issue one query per curse.
8. IF loading the stage data fails, THEN THE Stage_Sections SHALL show the generic error state in place of their content, SHALL log the failure on the server without database error text reaching the browser, and the Corpse_Page header and legacy source view SHALL still render.

### Requirement 3: Hex Scanner view

**User Story:** As a user, I want to see each curse with its exact line and a suggested exorcism, so that I understand what is wrong with the legacy code and where.

#### Acceptance Criteria

1. THE Hex_Scanner_Panel SHALL list every stored curse of the corpse ordered by ascending line number and then ascending curse type.
2. EACH curse entry SHALL show the curse type as a readable label, the severity (`HEX`, `BLOOD_CURSE`, or `FATAL`) as a text badge that uses the curse Theme_Token, the text "Line N", the description, and the exorcism strategy.
3. WHEN the line number N of a curse is between 1 and the number of lines of the legacy source, THE "Line N" text SHALL be a link to the same line in the legacy source view (`#source-line-N`), and OTHERWISE it SHALL be plain text.
4. THE Hex_Scanner_Panel SHALL show a summary with the total number of curses, the count per severity for the severities that occur, and the count per curse type for the types that occur.
5. THE legacy source view SHALL mark every line that has at least one curse with a visual marker that uses the curse Theme_Token and with visually hidden text "Curse on this line", so that the marker is not conveyed by color alone, and SHALL give each line an id `source-line-N`.
6. IF the corpse has no stored curses, THEN THE Hex_Scanner_Panel SHALL show the text "No curses are stored for this corpse." and, for the owner only, a hint to run the scan.
7. THE Hex_Scanner_Panel SHALL render the type, description, and strategy as text, so that markup in a stored value is displayed literally.

### Requirement 4: Séance Chamber view

**User Story:** As a user, I want to read the extracted requirements, design, and invariants, so that I can judge whether Lazarus understood the legacy behavior before code is generated.

#### Acceptance Criteria

1. THE Seance_Panel SHALL show the `requirements_md` of the Stored_Seance as Spec_Markdown, with each EARS_Criterion shown with its number and with the EARS keywords (`THE`, `WHEN`, `WHILE`, `IF`, `WHERE`, `THEN`, `SHALL`, `SHALL NOT`) in bold.
2. THE Seance_Panel SHALL show the `design_md` of the Stored_Seance as Spec_Markdown, with inline code spans shown in a monospaced element.
3. THE Seance_Panel SHALL show the Invariants_Document as: the entry function name in a monospaced element, the input description, the output description, and the invariants as a list.
4. IF the invariants are unreadable (Requirement 2 criterion 5), THEN THE Seance_Panel SHALL show the text "The stored invariants could not be read." and SHALL still show the requirements and the design.
5. THE Seance_Panel SHALL show the approval state as text: "Approved on YYYY-MM-DD" (UTC date of `approved_at`) or "Not approved yet".
6. IF the corpse has no Stored_Seance, THEN THE Seance_Panel SHALL show "No séance is stored for this corpse." and, for the owner, the start control of Requirement 8.
7. THE Spec_Markdown renderer SHALL be a pure function that produces text, code, and structure elements only: it SHALL NOT interpret HTML, links, images, or any markdown feature outside the Spec_Markdown definition, and SHALL display the characters of every line except the heading marker, the fence lines, and the backticks of code spans.

### Requirement 5: Laboratory view

**User Story:** As a user, I want to read the resurrected TypeScript and the test that checks it, so that I can inspect what Lazarus produced.

#### Acceptance Criteria

1. THE Laboratory_Panel SHALL show the evidence block of Requirement 6 first, then the `modern_code` of the Stored_Reincarnation in a read-only, monospaced code view with line numbers starting at 1 and the label "Resurrected TypeScript", then the `pbt_test_code` with the label "Property-based test".
2. THE `pbt_test_code` code view SHALL be inside a native disclosure element that is collapsed by default, and its content SHALL be present in the server-rendered HTML.
3. THE Laboratory_Panel SHALL show the `target_stack` text and the creation date (UTC, `YYYY-MM-DD`) of the Stored_Reincarnation.
4. THE Laboratory_Panel SHALL render the code as text only and SHALL preserve whitespace and long lines by horizontal scrolling inside the code view.
5. IF the corpse has no Stored_Reincarnation, THEN THE Laboratory_Panel SHALL show "No reincarnation is stored for this corpse." and, for the owner, either the start control of Requirement 8 or the reason it is not available.
6. THE code views of one page SHALL have distinct accessible names and distinct element ids.

### Requirement 6: Verification evidence

**User Story:** As a judge, I want the verification result stated as empirical evidence with the exact number of runs, so that Lazarus does not claim more than the test showed.

#### Acceptance Criteria

1. THE Web_App SHALL derive the Verification_State of a Stored_Reincarnation with one pure function: `VERIFIED` when `pbt_passed` is true and `total_runs` is a positive integer; `FAILED` when `pbt_passed` is false; `NOT_RUN` when `pbt_passed` is NULL; `INCOMPLETE` when `pbt_passed` is true and `total_runs` is NULL or not a positive integer.
2. WHEN the Verification_State is `VERIFIED`, THE evidence block SHALL show the Evidence_Text with `N` equal to `total_runs`, formatted with a comma as the thousands separator and never rounded, abbreviated, or replaced by a percentage, using the verified Theme_Token.
3. WHEN the Verification_State is `VERIFIED`, THE evidence block SHALL also show the sentence "This is empirical evidence from randomly generated inputs. Other inputs were not checked." and, when `execution_time_ms` is a non-negative integer, the text "Completed in N ms."
4. WHEN the Verification_State is `FAILED`, THE evidence block SHALL show "The modern function differed from the legacy function." using the curse Theme_Token, and WHEN `total_runs` is a positive integer it SHALL add "The check stopped after N generated inputs."
5. WHEN the Verification_State is `NOT_RUN`, THE evidence block SHALL show "Not verified yet." followed, for the owner for whom the Verify_Control is available (Requirement 8 criterion 9), by the Verify_Control, and for every other Stage_Access by the sentence "No property-based test result is stored for this module.", using the neutral Theme_Token in both cases.
6. WHEN the Verification_State is `INCOMPLETE`, THE evidence block SHALL show "A passing result is stored without a run count, so no evidence is shown." using the neutral Theme_Token.
7. THE Evidence_Text SHALL appear only when the Verification_State is `VERIFIED`, and no other state SHALL use the verified Theme_Token.
8. THE Web_App SHALL compute all evidence text from the stored columns and SHALL NOT depend on the `evidence` field of a Pipeline_API response.
9. THE Evidence_Text and every other string authored by this spec SHALL NOT contain a Forbidden_Term.

### Requirement 7: Judge/Sandbox mode

**User Story:** As a judge or anonymous visitor, I want to explore the precomputed results of the samples without signing in, so that I can evaluate Lazarus immediately and safely.

#### Acceptance Criteria

1. WHILE the Stage_Access is `visitor`, THE Stage_Sections SHALL show the stored results and SHALL contain no button, form, or other control that sends a request to the Pipeline_API or invokes a Server Action that writes data.
2. WHILE the Stage_Access is `visitor`, THE Web_App SHALL NOT render the Stage_Actions component at all (not merely hide it), and no request to a path under `/api/` SHALL be made by the page.
3. WHILE the Stage_Access is `visitor`, THE Stage_Sections SHALL show a notice that the results are precomputed and read-only, with a link to `/sign-in?next=<path>` where `<path>` is the Safe_Redirect_Path of the Corpse_Page.
4. WHILE the Stage_Access is `member-viewer`, THE Stage_Sections SHALL behave as for a `visitor` except that the notice SHALL state that sample results are precomputed and read-only and SHALL NOT offer sign-in.
5. IF a Sample_Corpse has no Stored_Seance or no Stored_Reincarnation, THEN THE corresponding section SHALL show its empty text and, for a Visitor or Member, a hint that the samples need the Foundation migrations (`pnpm db:migrate`).
6. THE Web_App SHALL determine the Stage_Access on the server from verified Claims (`getViewer()`/`getCurrentMember()`) and the corpse row, and SHALL NOT take it from a client-supplied value.

### Requirement 8: Stage controls

**User Story:** As a Member, I want the page to offer only the actions that make sense for my corpse at its current stage, so that I am never asked to do something that cannot work.

#### Acceptance Criteria

1. THE Web_App SHALL compute the Stage_Controls with one pure function from the Stage_Access, the number of stored curses, whether a Stored_Seance exists, whether it is approved, whether a Stored_Reincarnation exists, and the Verification_State of the Stored_Reincarnation (or none when it does not exist).
2. WHILE the Stage_Access is `owner`, THE Stage_Controls SHALL offer the scan (labeled "Run scan", or "Scan again" when curses are stored) in every state.
3. WHILE the Stage_Access is `owner`, THE Stage_Controls SHALL offer the start of the séance only when no Stored_Seance exists.
4. WHILE the Stage_Access is `owner`, THE Stage_Controls SHALL offer the approval (Requirement 12) only when a Stored_Seance exists and is not approved.
5. WHILE the Stage_Access is `owner`, THE Stage_Controls SHALL offer the start of the reincarnation only when a Stored_Seance exists, it is approved, and no Stored_Reincarnation exists. The approval condition is a UI-level restriction only (criterion 10).
6. WHILE the Stage_Access is `visitor` or `member-viewer`, THE Stage_Controls SHALL offer no action.
7. WHEN an action is not offered to an owner because of an earlier stage, THE section SHALL show the reason as text, for example "Approve the séance spec to enable reincarnation.", and WHEN a result already exists THE section SHALL NOT offer to regenerate it.
8. THE start controls for the séance and the reincarnation SHALL carry the note "Uses the language model. Counts toward your hourly request limit.", the scan control SHALL carry the note "Runs the deterministic scanner. No model request.", and the Verify_Control SHALL carry the note of Requirement 18 criterion 3.
9. WHILE the Stage_Access is `owner`, THE Stage_Controls SHALL offer the Verify_Control (`verify`) only when ALL of these hold: the Stage_Access is `owner` (the owner views an Owned_Corpse), a Stored_Reincarnation exists, and its Verification_State is `NOT_RUN` (`pbt_passed` is NULL). THE Stage_Controls SHALL NOT offer the Verify_Control when the Verification_State is `VERIFIED`, `FAILED`, or `INCOMPLETE`, because those are final results and `08-live-verification-api` offers no re-run, and SHALL NOT offer it to a `visitor` or a `member-viewer`.
10. THE condition "the Stored_Seance is approved" in criterion 5 SHALL be a UI-level restriction only. Requirement 12 criterion 10 of `05-llm-pipeline-api` deliberately lets the Reincarnate_Route generate a reincarnation whether or not `approved_at` is set, so a direct API client can bypass the gate; this is intended. THE gate is owned by this spec as a UI policy (human review before generation), and no backend enforcement is planned in this spec or in any other spec.

### Requirement 9: Pipeline requests from the browser

**User Story:** As a Member, I want the buttons to call the pipeline correctly and safely, so that each click does one thing and cannot be abused from the page.

#### Acceptance Criteria

1. WHEN the owner activates a start control or the Verify_Control, THE Stage_Actions component SHALL send one `POST` request to the fixed path of the route (`/api/scan`, `/api/seance`, `/api/reincarnate`, or `/api/verify`) with the header `Content-Type: application/json`, `credentials` set to `same-origin`, `cache` set to `no-store`, and a body that is the JSON object `{ "corpseId": "<uuid>" }` and nothing else.
2. THE `corpseId` SHALL come from the server-rendered corpse row passed as a prop, and the route paths SHALL be constants, never derived from stored or user-supplied data.
3. WHILE a request is pending, THE Stage_Actions component SHALL disable its control, set `aria-busy`, show the pending text ("Running the séance. This can take up to two minutes." or the equivalent for the route), and ignore further activations, so that one click sends exactly one request.
4. IF no response arrives within the Client_Timeout of the route (110,000 ms, or the Verify_Client_Timeout for the Verify_Route), THEN THE Stage_Actions component SHALL abort the request and show the `CLIENT_TIMEOUT` failure of Requirement 11.
5. WHEN the component unmounts while a request is pending, THE Stage_Actions component SHALL abort the request and SHALL NOT update state afterwards.
6. THE Stage_Actions component SHALL parse the response defensively: a response that is not JSON, or whose JSON does not have the expected shape, SHALL produce the `UNKNOWN` failure, and the parser SHALL NOT throw.
7. THE Stage_Actions component SHALL treat `ok: true` with a `source` that is one of the Result_Source values accepted for that route (a per-route list: `precomputed`, `stored`, `cache`, `generated` for the Scan_Route, Seance_Route, and Reincarnate_Route; `precomputed`, `stored`, `executed` for the Verify_Route) as a success, and a success response without a `source` valid for that route (for example `executed` from the Seance_Route, or `generated` from the Verify_Route) as `UNKNOWN`.
8. THE Stage_Actions component and every module it imports SHALL NOT import `ai`, `@ai-sdk/*`, or any `server-only` module, and SHALL NOT reference an LLM configuration variable.
9. THE Web_App SHALL NOT stream progress. Streaming is out of scope and not planned in any spec: every route of the Pipeline_API returns one JSON document, the Stage_Actions component shows an indeterminate pending message (no progress value, no partial result), and adding streaming later would need changes in the route specs first.

### Requirement 10: Success feedback and refresh

**User Story:** As a Member, I want clear confirmation of what happened, including when an existing result was reused, so that I understand whether a model request was made.

#### Acceptance Criteria

1. WHEN a call succeeds, THE Stage_Actions component SHALL call `router.refresh()` exactly once so that the Stage_Sections re-render from the database, and SHALL NOT render any part of the response body.
2. WHEN a call succeeds, THE Stage_Actions component SHALL show a message chosen by the route and the Result_Source: for `generated`, that a new result was produced; for `stored`, that the stage was already complete and the stored result is shown; for `cache`, that a stored result for identical code was reused and no model request was made; for `precomputed`, that the result is precomputed; and, for the Verify_Route only, for `executed`, that the check finished and the stored result is shown (while `stored` for the Verify_Route says that a result already existed).
3. THE success message SHALL be in an element with `role="status"` that remains visible after the refresh until the next activation of the same control.
4. WHEN a call succeeds and the activated control disappears because of the refreshed state, THE Stage_Actions component SHALL stay mounted so that the message remains, and keyboard focus SHALL move to the heading of the Stage_Section.
5. WHEN a Séance result has the Result_Source `cache`, THE Seance_Panel SHALL show the approval state from the stored row (which is "Not approved yet" for a copied row), so that the owner approves the copy before reincarnation.

### Requirement 11: Failure and rate-limit presentation

**User Story:** As a Member, I want understandable messages when something fails or I hit a limit, so that I know whether to retry, wait, or change something.

#### Acceptance Criteria

1. THE Web_App SHALL map every Error_Code of the closed list of 26 codes (the 21 codes of `05-llm-pipeline-api` Requirement 17 criterion 1 plus the five codes of `08-live-verification-api` listed in criterion 10) to a fixed English title and message in one module, and a TypeScript exhaustiveness check SHALL fail the build when the list and the map differ.
2. IF the Pipeline_Outcome is `NETWORK`, `CLIENT_TIMEOUT`, `UNKNOWN`, or an Error_Code that is not in the list, THEN THE Stage_Actions component SHALL show a generic message ("The request could not be completed. Try again later.") or the fixed message of that outcome.
3. THE Stage_Actions component SHALL NOT render the `message` text of a Pipeline_API error response, any response header other than the use of `Retry-After`, or any text of the response body.
4. IF the Error_Code is `RATE_LIMITED` or `VERIFICATION_BUSY`, THEN THE Stage_Actions component SHALL show that the request limit was reached (for `RATE_LIMITED`; criterion 11 gives the wording for the Verify_Route) or that the verification service is busy (for `VERIFICATION_BUSY`) and, when `Retry-After` is an integer from 1 to 86,400, the wait rounded up to whole seconds (under 60), whole minutes (under 3,600), or whole hours, and SHALL disable the control until that time has elapsed on the client clock; WHEN `Retry-After` is missing or invalid it SHALL show "Try again later." and SHALL NOT disable the control.
5. IF the Error_Code is `AUTH_REQUIRED`, THEN THE message SHALL include a link to `/sign-in?next=<path>` where `<path>` is the Safe_Redirect_Path of the Corpse_Page.
6. IF the Error_Code is `SOURCE_TOO_LARGE`, `SOURCE_SYNTAX_ERROR`, `SOURCE_NOT_SCANNABLE`, or `NO_ENTRY_FUNCTION`, THEN THE message SHALL state that the source cannot be processed and give the specific reason in fixed words.
7. IF the Error_Code is `LLM_OUTPUT_INVALID`, `LLM_PROVIDER_ERROR`, or `LLM_TIMEOUT`, THEN THE message SHALL state that a failed attempt can still count toward the request limit.
8. THE failure message SHALL be in an element with `role="alert"`, SHALL NOT move keyboard focus, and the control SHALL be enabled again for all failures except the active wait of criterion 4 (`RATE_LIMITED` or `VERIFICATION_BUSY` with a valid `Retry-After`).
9. THE failure messages SHALL NOT contain a Forbidden_Term, a stack trace, a SQL statement, or a provider name.
10. THE Web_App SHALL map the five codes of `08-live-verification-api` to these fixed meanings, each with its own title and message: `REINCARNATION_REQUIRED` (HTTP 409): generate the module first; `VERIFICATION_DISABLED` (503): live verification is switched off on this server and nothing was run; `VERIFICATION_BUSY` (429, with `Retry-After`): the verification service is busy and the user should try again shortly; `VERIFICATION_INCONCLUSIVE` (422): the check could not complete, for example because it ran out of time or memory, no result was stored, and the attempt may count toward the limit; `SANDBOX_UNAVAILABLE` (503): the isolated environment is not available.
11. WHEN the route is the Verify_Route and the Error_Code is `RATE_LIMITED`, THE message SHALL say that the verification limit was reached (not the request limit), and the wait handling of criterion 4 SHALL apply unchanged.

### Requirement 12: Séance approval

**User Story:** As a Member, I want to approve the extracted spec before code is generated from it, so that I stay in control of what Lazarus will build.

#### Acceptance Criteria

1. THE Web_App SHALL provide a Server Action `approveSeance` that starts with `requireMember`, validates the corpse id as a UUID, and then updates `seance_specs` setting `approved_at` to the current UTC time where `corpse_id` equals the id and `approved_at` is NULL, using the Server_Client of the request.
2. THE `approveSeance` action SHALL change no column other than `approved_at`, SHALL NOT delete or insert rows, and SHALL NOT call the Pipeline_API or any model.
3. IF the update affects zero rows (the corpse is not owned by the Member, is a sample, has no spec, or is already approved), THEN THE Web_App SHALL redirect with a non-revealing notice ("The séance spec could not be approved.") and SHALL NOT report success.
4. IF the database rejects the update, THEN THE Web_App SHALL log the error on the server and show the same generic notice without database text.
5. WHEN the update succeeds, THE Web_App SHALL redirect to `/corpses/<id>?notice=approved#seance-chamber`, and the page SHALL show the notice "The séance spec was approved." and the new approval state.
6. WHEN a Visitor invokes `approveSeance`, THE Web_App SHALL redirect to sign-in and SHALL NOT call any write method of the client.

### Requirement 13: Accessibility, motion, and layout

**User Story:** As a user with a keyboard, a screen reader, or a motion preference, I want the new sections to be as usable as the rest of the app, so that nobody is excluded.

#### Acceptance Criteria

1. THE Stage_Sections SHALL be `section` elements labeled by their headings, and the Stage_Overview SHALL be a labeled `nav`.
2. EVERY control and link added by this spec SHALL be operable with the keyboard alone and SHALL show a visible focus indicator.
3. THE pending and success messages SHALL be announced politely (`role="status"`), and the failure messages SHALL use `role="alert"`.
4. THE severity, the approval state, and the Verification_State SHALL always be conveyed by text, and color SHALL never be the only signal.
5. THE new components SHALL use the Theme_Tokens and existing shadcn/ui components, SHALL NOT use raw hex color values, and SHALL keep the contrast test of `04-web-shell-auth` passing.
6. THE Web_App SHALL animate the stage content only through the existing `Reveal` component and `useReveal` hook (opacity and transform), SHALL NOT add a new timeline, and WHILE the browser reports `prefers-reduced-motion: reduce` it SHALL show the final state immediately; the pending indicator SHALL use only CSS animation behind the `motion-safe` variant.
7. THE Stage_Sections SHALL be usable from 360 px to 1920 px viewport width without horizontal scrolling of the page body, with code views scrolling inside their own region.

### Requirement 14: Security and wording

**User Story:** As a security-conscious maintainer, I want everything model-authored or stored treated as untrusted text, so that the new screens add no injection or leak path.

#### Acceptance Criteria

1. THE Web_App SHALL render every stored or model-authored value (requirements, design, invariants, curse text, code, target stack) as text children, SHALL NOT use `dangerouslySetInnerHTML`, and SHALL NOT add a markdown or HTML rendering dependency.
2. THE Web_App SHALL perform the stage reads and the approval with the anon-key Server_Client of the request and SHALL NOT use `SUPABASE_SERVICE_ROLE_KEY` or any LLM configuration variable in any module of this spec.
3. THE Web_App SHALL build redirect targets only from a validated UUID and fixed notice codes, and SHALL add the notice codes to the fixed table of `lib/messages.ts` so that URL text is never echoed.
4. THE Web_App SHALL NOT return or render a stack trace, a SQL statement, a SQLSTATE, a policy name, or a Supabase error body in any page or action result of this spec.
5. THE strings authored by this spec SHALL describe results as empirical evidence and SHALL NOT contain a Forbidden_Term; the wording module SHALL expose `containsForbiddenTerm` for the tests.
6. THE Web_App SHALL NOT execute, evaluate, parse as code, or transpile any stored `original_code`, `modern_code`, or `pbt_test_code` in the browser or on the server for display.
7. THE modules under `apps/web/src/lib/stages/` and `apps/web/src/components/stages/` SHALL contain zero explicit `any` type annotations, and all comments and UI text SHALL be in English.

### Requirement 15: Loading, empty, and error states

**User Story:** As a user, I want predictable feedback while data loads and when nothing is stored, so that the page never looks broken or jumps.

#### Acceptance Criteria

1. THE Corpse_Page SHALL render the Stage_Sections inside a `Suspense` boundary whose fallback reserves the space of the Stage_Overview and the three sections, and the route `loading.tsx` SHALL reserve the same layout.
2. EACH Stage_Section SHALL define an empty state (Requirements 3 criterion 6, 4 criterion 6, and 5 criterion 5), and the empty states SHALL be visible to every Stage_Access.
3. IF the stage data fails to load (Requirement 2 criterion 8), THEN THE Stage_Sections SHALL show the generic `ErrorState` component of `04-web-shell-auth`.
4. WHILE a Pipeline_API request is pending, THE Stage_Actions component SHALL show the pending state of Requirement 9 criterion 3 without changing the height of the surrounding section more than the message line.
5. THE Web_App SHALL keep the existing 404 handling of the Corpse_Page for an invalid id, a missing corpse, and a corpse that is not visible.

### Requirement 16: Tests

**User Story:** As a maintainer, I want automated tests for the logic that matters most, so that regressions in gating, wording, and error handling are caught early.

#### Acceptance Criteria

1. WHEN `pnpm test` runs, THE Web_App SHALL execute the new tests with Vitest in single-run mode in the existing configuration, SHALL NOT require a database, a network connection, a Supabase project, or an LLM configuration variable, and SHALL NOT add a browser automation tool.
2. THE tests SHALL include property-based tests (`fast-check`, explicit `numRuns` of at least 100) for: the Verification_State and Evidence_Text (Requirement 6); the Stage_Controls gating, including the Verify_Control (Requirement 8 and Requirement 7 criterion 1); the Spec_Markdown parser (Requirement 4 criterion 7); the parsing of Pipeline_Outcomes for every route, which never throws, accepts only the Result_Source values of its route, and never exposes server text (Requirement 9 criteria 6 and 7 and Requirement 11 criterion 3); the retry-after formatting (Requirement 11 criterion 4); the scanner view model (Requirement 3); and the pending-state reducer, which never allows two requests in flight (Requirement 9 criterion 3).
3. THE tests SHALL cover the formatting of run counts with known examples (`1000` gives `1,000`, `100` gives `100`, `1234567` gives `1,234,567`) and SHALL assert that the Evidence_Text for `total_runs` 1000 equals `Verified behavioral equivalence across 1,000 generated inputs.`
4. THE tests SHALL render the stage components to static markup and assert: no control and no Stage_Actions markup for a Visitor and for a `member-viewer`; the controls an owner gets in each stored state; literal display of a stored value that contains `<script>`; and the absence of `dangerouslySetInnerHTML`.
5. THE tests SHALL cover the mapping of every one of the 26 Error_Codes to a message, the generic fallback for unknown codes, and the `Retry-After` handling with examples (missing, `0`, `-5`, `abc`, `1`, `59`, `60`, `3600`, `86400`, `86401`), for `RATE_LIMITED` and for `VERIFICATION_BUSY`.
6. THE tests SHALL cover `approveSeance` with the fake Supabase client: a Visitor causes no write; an owner issues one update that sets only `approved_at` with the filter on a NULL `approved_at`; zero affected rows and a database error both give the generic notice; an invalid id touches nothing.
7. THE tests SHALL cover the data layer additions (curse fields, Stored_Seance, Stored_Reincarnation, invariants parsing, unexpected shapes) with the fake client.
8. THE tests SHALL scan the non-test source files under `src/lib/stages/` and `src/components/stages/` and assert: no Forbidden_Term, no import of `ai`, `@ai-sdk/*`, or `server-only` in client modules, no LLM configuration variable name, and no `dangerouslySetInnerHTML`.
9. THE test names SHALL start with the requirement they cover (`R<n>.<m> ...`), every property-based test SHALL carry the first-line comment `// Feature: 06-resurrection-ui, Property <N>: <title>`, and the tests SHALL use the existing `fakeClient` helper where a Supabase client is needed.
10. THE tests SHALL cover the Verify_Control: pure `stageControls` table tests for every combination of Stage_Access and Verification_State (available only for `owner` with a Stored_Reincarnation in the state `NOT_RUN`); the per-route Result_Source lists (`executed` is a success only for the Verify_Route, `generated` only for the other routes); `runPipeline` for the route `verify` (path `/api/verify`, body exactly `{"corpseId":"..."}`, and a timeout of the Verify_Client_Timeout, tested with a short override and by asserting the constant is 70,000 and greater than 60,000); the success messages for `executed` and `stored`; and the exhaustive failure map with the five new codes, including the lock-until-`retryAt` behavior of `VERIFICATION_BUSY` and the "verification limit" wording of `RATE_LIMITED` for the Verify_Route.
11. THE tests SHALL render the Laboratory_Panel to static markup and assert: the markup for a `visitor` and for a `member-viewer` contains neither the Verify_Control nor any Stage_Actions markup nor the path `/api/verify`; the owner markup contains the "Verify live" button and its note only when the Stored_Reincarnation is `NOT_RUN`, and contains no "Verify live" button for `VERIFIED`, `FAILED`, and `INCOMPLETE`.

### Requirement 17: Documentation and scope boundary

**User Story:** As a reviewer and a new contributor, I want the new screens documented and the scope limited, so that the review covers only this stage.

#### Acceptance Criteria

1. THE Web_App SHALL extend `apps/web/README.md` with one English section that describes the three Stage_Sections, who sees which controls (Visitor, Member viewing a sample, owner), the meaning of the four Verification_States, when the "Verify live" control appears (owner, stored reincarnation, state `NOT_RUN`) and what its failure messages mean, the note that the approval gate is a UI-level restriction, and the troubleshooting hints (samples need `pnpm db:migrate`; the actions need the Pipeline_API of `05-llm-pipeline-api` and its configuration; "Verify live" needs `08-live-verification-api` and answers that live verification is switched off while the server keeps user execution disabled, which is the default).
2. THE Web_App SHALL limit its changes to files under `apps/web` and, only if needed, the lockfile; it SHALL NOT create or modify a migration, a file under `db/` or `packages/`, `.env.example`, or any file of another spec.
3. THE Web_App SHALL NOT create or modify the Route Handlers of the Pipeline_API, SHALL NOT call a model, and SHALL NOT add an environment variable.
4. THE Web_App SHALL NOT run, import, or evaluate legacy, generated, or test code in the browser or in its own modules. The only control that starts a verification run is the Verify_Control of Requirement 18, which sends a request to the Verify_Route of `08-live-verification-api`, and no other control SHALL start a run.
5. THE Web_App SHALL change the existing modules `code-view.tsx`, `curse-list.tsx`, the corpse page, its `loading.tsx`, `lib/data/types.ts`, `lib/data/corpses.ts`, and `lib/messages.ts` only as far as this spec requires, and SHALL update their existing tests accordingly.
6. THE Web_App SHALL NOT create or modify the Verify_Route, its limits, its deadline, or its on/off switch, SHALL NOT add a dependency, a migration, or a GSAP timeline for the Verify_Control, and SHALL reuse the existing components (`StageActions`, `Button`, `Notice`, `Reveal`).

### Requirement 18: Live verification control

**User Story:** As the owner of a reincarnated module, I want a "Verify live" control that runs the legacy and the modern function on generated inputs in an isolated environment, so that the Laboratory shows empirical evidence for my own code and not only for the samples.

#### Acceptance Criteria

1. THE Laboratory_Panel SHALL render the Verify_Control only when the Stage_Controls offer `verify` (Requirement 8 criterion 9), so that for a `visitor` and a `member-viewer` the Verify_Control and its Stage_Actions component SHALL be absent from the HTML (not merely hidden), and Sample_Corpses SHALL show the precomputed evidence only.
2. WHILE the Stage_Controls offer `verify`, THE Laboratory_Panel SHALL show the Verify_Control directly below the text "Not verified yet." of the evidence block, and SHALL NOT offer it for the Verification_States `VERIFIED`, `FAILED`, or `INCOMPLETE`.
3. THE Verify_Control SHALL be a button with the label "Verify live" and the help text "Runs the legacy and the modern function in an isolated environment on generated inputs. This can take up to a minute and counts toward a separate verification limit.", and the help text SHALL NOT state any limit value, duration other than "up to a minute", or run count, because `08-live-verification-api` owns those numbers.
4. WHEN the owner activates the Verify_Control, THE Stage_Actions component SHALL send the request of Requirement 9 criterion 1 to `/api/verify` (the entry `verify: '/api/verify'` of `PIPELINE_PATHS`) through the same pure `runPipeline` client, the same reducer, and the same double-click protection, and SHALL abort the request on unmount (Requirement 9 criteria 3 and 5).
5. THE Stage_Actions component SHALL wait for the Verify_Route at most the Verify_Client_Timeout, a named constant of 70,000 ms that is longer than the 60 s server deadline fixed by `08-live-verification-api`, and a timeout SHALL show the `CLIENT_TIMEOUT` failure.
6. WHILE a verification request is pending, THE Stage_Actions component SHALL show the pending text "Running the check. This can take up to a minute." in an element with `role="status"`, and SHALL NOT show a progress value.
7. THE Stage_Actions component SHALL read only `ok` and `source` from a success body of the Verify_Route `{ ok: true, source: 'precomputed' | 'stored' | 'executed', reincarnation: {...}, corpse: {...} }` and SHALL ignore the `reincarnation` and `corpse` objects, so that the UI renders only from database rows after `router.refresh()`.
8. WHEN the Verify_Route succeeds, THE Stage_Actions component SHALL call `router.refresh()` exactly once, SHALL move keyboard focus to the heading of the Laboratory section, and SHALL show a success message in an element with `role="status"` chosen by the Result_Source: for `executed`, "The check finished. The stored result is shown below."; for `stored`, "A result was already stored. Showing it."; for `precomputed`, "The result is precomputed. Showing it."
9. WHEN the refresh completes, THE evidence block SHALL show the persisted Verification_State with the texts of Requirement 6 (`VERIFIED` with the exact run count and the Evidence_Text, or `FAILED` with the text of Requirement 6 criterion 4), and the Verify_Control SHALL no longer be offered; THE Stage_Actions component SHALL stay mounted so that the success message remains (Requirement 10 criteria 3 and 4).
10. THE Verify_Control SHALL stay visible for the owner in the state `NOT_RUN` even when the server answers `VERIFICATION_DISABLED`; the failure message of Requirement 11 criterion 10 SHALL be shown, the control SHALL be enabled again, and no result SHALL be shown as stored.
11. WHEN the Verify_Route answers `VERIFICATION_BUSY` with a valid `Retry-After`, THE Stage_Actions component SHALL disable the Verify_Control until that time has elapsed, as for `RATE_LIMITED` (Requirement 11 criterion 4); WHEN the Verify_Route answers `VERIFICATION_INCONCLUSIVE`, THE message SHALL state that no result was stored and that the attempt may count toward the limit.
12. THE Verify_Control, its messages, and its help text SHALL NOT contain a Forbidden_Term, SHALL describe a stored result only as empirical evidence with the exact run count of Requirement 6, and SHALL NOT use the `evidence` field of the Verify_Route response.

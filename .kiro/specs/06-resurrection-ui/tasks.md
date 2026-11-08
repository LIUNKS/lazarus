# Implementation Plan

## Preconditions

- `01-lazarus-foundation` and `04-web-shell-auth` are implemented. `05-llm-pipeline-api` and `08-live-verification-api` (which depends on `07-sandboxed-execution`) may still be unfinished: the UI is built against the contract in the Open Items of `design.md`, and its tests use a fake `fetch`, so they never need the real routes. The "Verify live" control does not wait for the server: it answers `VERIFICATION_DISABLED` gracefully while live verification is switched off (the default).
- Work only inside `apps/web/` (plus the lockfile if a dependency is ever needed; none is planned). Do not touch `db/`, `packages/`, `.env.example`, or the files of other specs.
- Before using an API of Next.js, React, Supabase SSR, shadcn/ui, or GSAP, check the docs for the version in `pnpm-lock.yaml` (see `tech.md`).
- All code, comments, UI text, and docs are in English. No explicit `any`. Use Theme_Tokens, never raw hex values.
- Wording: describe results as empirical evidence with the exact run count. Do not use any Forbidden_Term in code, UI text, test names, or fixtures.
- Tests follow `testing-conventions.md`: `vitest run` only, explicit `numRuns` on every `fc.assert`, the first line of a property-based `it` body is `// Feature: 06-resurrection-ui, Property <N>: <title>`, and test names start with `R<n>.<m>`.
- Never read or print the real `.env`.

## Tasks

- [ ] 1. Data layer for the stage results
  - [ ] 1.1 Extend `src/lib/data/types.ts` and add the stage queries
    - Add `description` and `exorcismStrategy` to `CurseRow`; add `InvariantsDocument`, `SeanceSpec`, `Reincarnation`, and the guards `parseInvariants`, `parseSeanceSpec`, `parseReincarnation`
    - Add `description,exorcism_strategy` to `DETAIL_COLUMNS` in `corpses.ts` and sort curses by `(lineNumber, curseType)` in `parseDetail`
    - Write `src/lib/data/stages.ts` (`getSeanceSpec`, `getReincarnation`, `approveSeanceSpec`) and `src/lib/data/load-stages.ts` (React `cache`, both reads concurrent); resolve Open Item 11 (shared `fail()` helper)
    - _Requirements: 2.1 to 2.7, 12.1, 12.2, 14.2_
  - [ ] 1.2 Update and add data layer tests with `fakeClient`
    - Update the existing corpse tests for the new curse fields; cover the stage queries' filters, ordering, and `limit`, `parseInvariants` accept and reject cases, NULL columns, wrong types, and the generic `DataError`
    - _Requirements: 2.2 to 2.6, 16.7_

- [ ] 2. Pure view models (no `next/*`, no `react`, no `process.env`)
  - [ ] 2.1 Write `src/lib/stages/wording.ts` (`FORBIDDEN_TERMS`, `containsForbiddenTerm`) and `format.ts` (`formatRunCount`, `formatDuration`, `formatRetryAfter`)
    - _Requirements: 6.2, 6.9, 11.4, 14.5_
  - [ ] 2.2 Write `src/lib/stages/spec-markdown.ts` (`parseSpecMarkdown`, `parseInline`, `serializeInline`)
    - _Requirements: 4.1, 4.2, 4.7, 14.1_
  - [ ] 2.3 Write `src/lib/stages/verification.ts` (`buildVerificationView`, state labels)
    - _Requirements: 6.1 to 6.8_
  - [ ] 2.4 Write `src/lib/stages/scanner-view.ts` (`buildScannerView`, `countSourceLines`, `curseLabel`)
    - _Requirements: 3.1 to 3.5_
  - [ ] 2.5 Write `src/lib/stages/controls.ts` (`resolveAccess`, `stageControls`, `summarizeStages`); state in the doc comment of `stageControls` that the approval condition of the reincarnation control is a UI-level restriction only and that the Reincarnate_Route does not enforce it
    - _Requirements: 1.3, 1.4, 7.1, 7.4, 7.6, 8.1 to 8.7, 8.10_
  - [ ] 2.6 Write `src/lib/stages/errors.ts` and `pipeline-client.ts` (`PIPELINE_ERROR_CODES`, `FAILURE_PRESENTATIONS` as an exhaustive `Record`, `presentFailure`, `presentSuccess`, `parseOutcome`, `parseRetryAfter`, `runPipeline` with injected `fetch`)
    - _Requirements: 9.1, 9.2, 9.4, 9.6, 9.7, 10.2, 11.1 to 11.7, 11.9_
  - [ ] 2.7 Write `src/lib/stages/action-state.ts` (`actionReducer`, `isLocked`)
    - _Requirements: 9.3, 9.5, 11.4, 11.8_
  - [ ] 2.8 Write tests for wording, formatting, and verification
    - Property 1 (verification and evidence, `numRuns` 300); examples for `1000`, `100`, `1234567`; one example per state with the exact strings; `INCOMPLETE` case
    - _Requirements: 6.1 to 6.9, 16.2, 16.3_
  - [ ] 2.9 Write tests for the Spec_Markdown parser
    - Properties 3 and 4 (round trip and totality, EARS detection; `numRuns` 200); examples with fences, headings, unclosed fence, unbalanced backticks, `<script>` text
    - _Requirements: 4.1, 4.2, 4.7, 16.2_
  - [ ] 2.10 Write tests for the scanner view and the stage controls
    - Property 7 (scanner view, `numRuns` 200) and Property 2 (controls gating over all access and fact combinations, including every `verificationState`, `numRuns` 200); examples for the summary words and the owner reasons. Write them against the final `StageFacts` of task 2.14
    - _Requirements: 3.1 to 3.5, 7.1, 8.1 to 8.7, 8.9, 16.2_
  - [ ] 2.11 Write tests for outcome parsing, error presentation, retry formatting, `runPipeline`, and the reducer
    - Properties 5, 6, 8 (`numRuns` 200); the `Retry-After` examples of Requirement 16.5 (for `RATE_LIMITED` and `VERIFICATION_BUSY`); every one of the 26 codes has a message; unknown code and non-JSON give the generic message; `runPipeline` request shape, network failure, and timeout with a short `timeoutMs`. Write them against the final signatures of tasks 2.12 and 2.13 (`parseOutcome(route, ...)`, `presentFailure(outcome, route)`)
    - _Requirements: 9.1, 9.3, 9.4, 9.6, 9.7, 11.1 to 11.4, 16.2, 16.5_
  - [ ] 2.12 Extend the pipeline client with the `verify` route (`src/lib/stages/pipeline-client.ts`, `errors.ts`)
    - Add `verify: '/api/verify'` to `PIPELINE_PATHS`; add the named constant `VERIFY_CLIENT_TIMEOUT_MS = 70_000` (greater than the 60 s server deadline of spec 08) and `clientTimeoutFor(route)`; turn `RESULT_SOURCES` into the per-route map (`executed` only for `verify`, `generated` and `cache` only for the other routes) with `isResultSource(route, value)`; change `parseOutcome` to take the route and to ignore every field of the success body except `ok` and `source`; make `runPipeline` use `clientTimeoutFor(route)`; add the three `verify` messages to `presentSuccess`
    - _Requirements: 9.1, 9.4, 9.7, 10.2, 18.4, 18.5, 18.7, 18.8_
  - [ ] 2.13 Add the five codes of spec 08 and the route-specific wording (`src/lib/stages/errors.ts`)
    - Add `REINCARNATION_REQUIRED`, `VERIFICATION_DISABLED`, `VERIFICATION_BUSY`, `VERIFICATION_INCONCLUSIVE`, and `SANDBOX_UNAVAILABLE` to `PIPELINE_ERROR_CODES` (26 in total) and to the exhaustive `FAILURE_PRESENTATIONS` with the fixed texts of Requirement 11 criterion 10; add `ROUTE_FAILURE_OVERRIDES` so that `RATE_LIMITED` says "verification limit" for the route `verify`; change `presentFailure` to take the route; give `VERIFICATION_BUSY` the same `Retry-After` parsing and `waitSeconds` lock as `RATE_LIMITED`; make the reducer pass the route of the `finish` event to `presentFailure`; check the new texts against the Forbidden_Terms
    - _Requirements: 11.1, 11.4, 11.8, 11.9, 11.10, 11.11, 18.10, 18.11_
  - [ ] 2.14 Add the `verify` control to the pure models (`controls.ts`, `verification.ts`)
    - Add `verificationState` to `StageFacts` and `verify` to `StageControls` (available only for `owner` with a Stored_Reincarnation in the state `NOT_RUN`; `{ available: false, reason: null }` otherwise); change `summarizeStages` to read the Laboratory state from `facts.verificationState`; add the `verifyAvailable` option to `buildVerificationView` (NOT_RUN headline "Not verified yet." without the "No property-based test result is stored" sentence when the control is available); add the verify help text constant and the pending text constant
    - _Requirements: 6.5, 8.1, 8.6, 8.8, 8.9, 18.1, 18.2, 18.3, 18.6_
  - [ ] 2.15 Write tests for the verify additions (new file `src/lib/stages/verify-live.test.ts`)
    - `stageControls` table tests for `verify` over every Stage_Access and `verificationState` (`NOT_RUN`, `VERIFIED`, `FAILED`, `INCOMPLETE`, `null`); per-route source examples and one property (`numRuns` 200, first line `// Feature: 06-resurrection-ui, Property 5: Outcome parsing is total and does not echo`, route drawn from all four); `runPipeline` for `verify` (path, body exactly `{"corpseId":"..."}`, timeout constant equals 70,000 and is greater than 60,000, short override); `executed` and `stored` success messages; the five new codes and the "verification limit" wording; `VERIFICATION_BUSY` lock until `retryAt`; the success body of `verify` with extra `reincarnation` and `corpse` objects yields only the source. Test names start with `R16.10`, `R18.n`, or `R11.n`
    - _Requirements: 8.9, 9.7, 11.10, 11.11, 16.9, 16.10, 18.4, 18.5, 18.7, 18.8, 18.11_

- [ ] 3. Checkpoint: view models
  - [ ] 3.1 Run `pnpm --filter @lazarus/web lint` and `pnpm --filter @lazarus/web test`; confirm exit code 0 before building components
    - _Requirements: 16.1_

- [ ] 4. Components and page integration
  - [ ] 4.1 Extend `src/components/code-view.tsx` with `label`, `idPrefix`, and `markedLines` (defaults keep the 04 output; add line ids and the "Curse on this line" marker); make it use `countSourceLines`
    - _Requirements: 3.5, 5.6, 13.4_
  - [ ] 4.2 Write `hex-scanner-panel.tsx` (summary, entries, anchor links, empty text, owner scan control) and remove `curse-list.tsx`
    - _Requirements: 3.1 to 3.7, 7.1, 8.2, 13.4_
  - [ ] 4.3 Write `spec-markdown.tsx` and `seance-panel.tsx` (requirements, design, invariants, approval line, unreadable-invariants text, empty state, owner controls and reasons)
    - _Requirements: 4.1 to 4.7, 8.3, 8.4, 8.7, 10.5, 14.1_
  - [ ] 4.4 Write `verification-evidence.tsx` and `laboratory-panel.tsx` (evidence first, modern code, collapsed test code in `<details>`, stack and date, empty state, owner control or reason)
    - _Requirements: 5.1 to 5.6, 6.2 to 6.7, 8.5, 8.7_
  - [ ] 4.5 Write `stage-actions.tsx` (client): reducer, `runPipeline`, abort on unmount, timeout, `router.refresh()` once on success, status and alert regions, sign-in link for `AUTH_REQUIRED`, rate-limit wait timer (for `RATE_LIMITED` and `VERIFICATION_BUSY`), focus to the section heading, `data-stage-actions`, CSS-only indeterminate pending indicator (no progress value, no streaming), per-route timeout from `clientTimeoutFor(route)` (task 2.12)
    - _Requirements: 8.8, 9.1 to 9.9, 10.1 to 10.4, 11.1 to 11.9, 13.2, 13.3, 13.6, 15.4_
  - [ ] 4.6 Add `approveSeance` to `src/app/corpses/actions.ts`, `approve-seance-form.tsx` (client, `useFormStatus`), and the notice codes `approved` and `approve-failed` in `lib/messages.ts`
    - _Requirements: 12.1 to 12.6, 14.3, 14.4_
  - [ ] 4.7 Write `stage-sections.tsx` (build `StageFacts` with `verificationState` from `buildVerificationView(reincarnation).state`), `stage-overview.tsx`, `stage-section.tsx`, `readonly-notice.tsx`, and `stages-skeleton.tsx`; update `corpses/[id]/page.tsx` (Suspense, notices, scanner view for the source marks) and `loading.tsx`; remove `next-stages.tsx`; apply `Reveal` to the result blocks
    - _Requirements: 1.1 to 1.6, 2.7, 2.8, 7.1 to 7.6, 13.1, 13.5 to 13.7, 15.1 to 15.3, 15.5_
  - [ ] 4.8 Add the "Verify live" control to `laboratory-panel.tsx` and `verification-evidence.tsx`
    - Build the evidence block with `verifyAvailable` from `controls.verify.available`; for an owner with a Stored_Reincarnation, render the verify `StageActions route="verify"` at a fixed position directly below the evidence block with the label "Verify live", the help text and pending text of Requirement 18, and the Laboratory heading as `headingId`; pass `available` from `stageControls` so that the instance stays mounted after the refreshed state removes the button; render nothing for a `visitor` or `member-viewer`; extend `StageActions` only as far as the `verify` route needs (success messages, timeout, wait lock); no new dependency and no new GSAP timeline
    - _Requirements: 5.5, 6.5, 8.8, 8.9, 10.3, 10.4, 13.2, 13.3, 13.6, 17.6, 18.1 to 18.12_

- [ ] 5. Component, action, and isolation tests
  - [ ] 5.1 Write `.test.tsx` tests with `renderToStaticMarkup` for the panels and the page sections
    - Property 9 (Visitor and member-viewer markup has no controls, `numRuns` 100); owner markup in each stored state; literal display of `<script>` text; evidence block per state; resolve Open Item 12 (TSX in Vitest) first
    - _Requirements: 1.3, 1.5, 3.7, 4.4, 4.6, 5.5, 7.1 to 7.5, 8.2 to 8.8, 14.1, 16.4_
  - [ ] 5.4 Write the Laboratory markup tests for the Verify_Control (new file `src/components/stages/laboratory-panel.test.tsx`; after task 5.1 has settled Open Item 12)
    - `visitor` and `member-viewer` markup contains no "Verify live", no `data-stage-actions`, and no `/api/verify` (extend Property 9 so that its generated reincarnations include `NOT_RUN`, `numRuns` 100); owner markup with a `NOT_RUN` reincarnation contains the "Verify live" button, its note, and "Not verified yet."; owner markup for `VERIFIED`, `FAILED`, and `INCOMPLETE` contains no "Verify live" button; owner markup with no reincarnation contains no verify button; Sample_Corpse markup shows the precomputed evidence only. Test names start with `R16.11`, `R18.1`, `R18.2`, or `R6.5`
    - _Requirements: 6.5, 7.1, 7.2, 8.9, 16.4, 16.11, 18.1, 18.2, 18.3_
  - [ ] 5.2 Write tests for `approveSeance` with `fakeClient` (Visitor, owner, zero rows, database error, invalid id)
    - _Requirements: 12.1 to 12.6, 16.6_
  - [ ] 5.3 Write the static scan test over `src/lib/stages/` and `src/components/stages/` (Forbidden_Terms, forbidden imports, LLM variable names, `dangerouslySetInnerHTML`, explicit `any`)
    - _Requirements: 9.8, 14.1, 14.2, 14.5, 14.7, 16.8, 18.12_

- [ ] 6. Documentation
  - [ ] 6.1 Extend `apps/web/README.md` with the "Resurrection stages" section (sections, who sees which controls, the four verification states, troubleshooting, manual verification steps); confirm no new environment variable
    - _Requirements: 17.1 to 17.5_
  - [ ] 6.2 Extend the README section of task 6.1 for the Verify_Control, the approval gate, and streaming
    - Describe when "Verify live" appears (owner, stored reincarnation, state `NOT_RUN`) and when it does not (`VERIFIED`, `FAILED`, `INCOMPLETE`, Visitors, members viewing samples); the meaning of its failure messages (`VERIFICATION_DISABLED`: switched off on the server, which is the default; `VERIFICATION_BUSY`; `VERIFICATION_INCONCLUSIVE`; `SANDBOX_UNAVAILABLE`; `REINCARNATION_REQUIRED`) without stating limit numbers that spec 08 owns; that the approval gate is a UI-level restriction and a direct API client can bypass it by design; that streaming is not provided and not planned; add the "Verify live" step to the manual verification list; confirm no new environment variable
    - _Requirements: 8.10, 9.9, 17.1, 17.6, 18.10_

- [ ] 7. Final checkpoint
  - [ ] 7.1 Run `pnpm lint`, `pnpm build`, and `pnpm test` from the root; confirm exit code 0
    - _Requirements: 16.1_
  - [ ] 7.2 Check scope (Requirement 17: no change outside `apps/web`, no migration, no new variable, no new dependency, no new GSAP timeline), re-read Requirements 1 to 18, and list anything that only the manual verification covers (real Pipeline_API calls including a real "Verify live" with live verification switched off and on, keyboard, reduced motion, 360 px width)
    - _Requirements: 13.2 to 13.7, 17.2 to 17.6_
  - [ ] 7.3 Cross-reference with spec 08 (and 05, 07): re-read `.kiro/specs/08-live-verification-api/` and re-check the contract used here
    - Compare with Open Item 15 of `design.md`: path `/api/verify`; request body; `source` values; the five error codes with their HTTP statuses and the code that carries `Retry-After`; the separate verification limit and its `RATE_LIMITED` code; the 60 s server deadline against `VERIFY_CLIENT_TIMEOUT_MS` (70,000 ms stays; write any conflict into Open Items); that no re-run is offered for final results; that spec 05 no longer says streaming belongs to 06; that spec 05 Requirement 12 criterion 10 (generation without approval) is unchanged. Record every difference in Open Items and fix the names in `PIPELINE_ERROR_CODES`, `RESULT_SOURCES`, and the tests
    - _Requirements: 8.9, 8.10, 9.7, 9.9, 11.1, 11.10, 18.4, 18.5, 18.7, 18.11_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "2.3", "2.4", "2.6", "2.9"] },
    { "id": 2, "tasks": ["2.5", "2.7", "2.8", "2.12"] },
    { "id": 3, "tasks": ["2.13", "2.14"] },
    { "id": 4, "tasks": ["2.10", "2.11", "2.15"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["4.1", "4.5", "4.6"] },
    { "id": 7, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 8, "tasks": ["4.7", "4.8"] },
    { "id": 9, "tasks": ["5.1", "5.2", "5.3", "6.1"] },
    { "id": 10, "tasks": ["5.4", "6.2"] },
    { "id": 11, "tasks": ["7.1"] },
    { "id": 12, "tasks": ["7.2"] },
    { "id": 13, "tasks": ["7.3"] }
  ]
}
```

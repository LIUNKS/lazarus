# Implementation Plan

## Preconditions

- `04-web-shell-auth` and `06-resurrection-ui` are implemented (`Reveal`, `StageActions`, `VerificationEvidence`, `buildVerificationView`, `formatRunCount`).
- `gsap` 3.15.1 and `@gsap/react` 2.1.2 are installed in `apps/web` and include the plugins this spec uses. No dependency is added.

## Scope and conventions

- Work only inside `apps/web/`. The files of other specs that may change are listed in "Files of other specs touched" in `design.md`; no other file of another spec changes.
- All GSAP code lives in `src/animations/`. Every file that imports `gsap` starts with `'use client'`.
- Every animation runs only inside `gsap.matchMedia()` with `MOTION_QUERY`, and the server-rendered HTML stays the Final_State.
- Tests follow `testing-conventions.md`: `vitest run` only, explicit `numRuns`, the first line of a property-based `it` body is `// Feature: 09-motion-ux, Property <N>: <title>`, and test names start with `R<n>.<m>`.
- Each phase ends with a checkpoint: `pnpm --filter @lazarus/web lint` and `pnpm --filter @lazarus/web test`, then a manual check in the browser with and without reduced motion.

## Tasks

- [x] 1. Phase 1: shared motion base and Hex Scanner motion
  - [x] 1.1 Write `src/animations/gsap.ts` (plugin registration) and `src/animations/motion-math.ts` (pure functions); make `reveal.ts` and `use-reveal.ts` import through `./gsap`
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.2 Write `src/animations/motion-math.test.ts`: Properties 1, 2, and 4, the `hashTarget` examples, and the static checks for plugin imports and hex colors
    - _Requirements: 1.2, 1.7, 2.4, 2.5, 3.5_
  - [x] 1.3 Write `src/animations/scan-beam.tsx` and wrap the legacy source view of the corpse page in it
    - _Requirements: 2.1 to 2.7_
  - [x] 1.4 Write `src/animations/anchor-glide.tsx` and mount it on the corpse page
    - _Requirements: 3.1 to 3.6_
  - [x] 1.5 Write static markup tests for `ScanBeam` and `AnchorGlide`
    - _Requirements: 1.5, 2.1, 2.7_
  - [x] 1.6 Checkpoint: lint and test of `@lazarus/web`; manual check of the beam and the line links
    - Result: lint exit 0; 90 test files, 1,160 tests passed (includes `build-output.test.ts`). The visual check in a browser is left to the user (no browser runner in the repo, Open Item 1).
- [x] 2. Phase 2: Laboratory motion
  - [x] 2.1 Write `src/animations/heartbeat.tsx` and use it in `StageActions`; replace the two R13.6 checks in `test/stages-boundaries.test.ts`
    - _Requirements: 4.1 to 4.5_
  - [x] 2.2 Add `countFrame` to `motion-math.ts` with Property 3 and examples
    - _Requirements: 1.6, 5.2, 5.3_
  - [x] 2.3 Write `src/animations/evidence-arrival.tsx` and use it in `LaboratoryPanel`
    - _Requirements: 5.1 to 5.6_
  - [x] 2.4 Write static markup tests for `Heartbeat` and `EvidenceArrival`
    - _Requirements: 1.5, 4.2, 5.5_
  - [x] 2.5 Checkpoint: lint and test of `@lazarus/web`; manual check of a pending request and of the evidence block
    - Result: lint exit 0; 91 test files, 1,168 tests passed. Note for 2.2: `countFrame` was written together with the other pure functions in task 1.1; this task added its tests. The visual check in a browser is left to the user (Open Item 1).
- [x] 3. Phase 3: scroll motion
  - [x] 3.1 Add `createScrollReveal` and the `trigger` option to `reveal.ts`, `use-reveal.ts`, and `reveal-section.tsx`; use `trigger="scroll"` in `StageSectionsView`
    - _Requirements: 6.1 to 6.4_
  - [x] 3.2 Write `src/animations/scroll-progress.tsx` and mount it on the corpse page
    - _Requirements: 7.1 to 7.4_
  - [x] 3.3 Write static markup tests for the `Reveal` trigger and `ScrollProgress`
    - _Requirements: 1.5, 6.1, 7.1_
  - [x] 3.4 Checkpoint: lint and test of `@lazarus/web`; manual check of the reveal on scroll and of the bar
    - Result: lint exit 0; 92 test files, 1,171 tests passed. The visual check in a browser is left to the user (Open Item 1).
- [x] 4. Phase 4: polish
  - [x] 4.1 Write `src/animations/scramble-heading.tsx` and use it for the Morgue title
    - _Requirements: 8.1, 8.2_
  - [x] 4.2 Add the hover classes to `CorpseCard`
    - _Requirements: 8.3_
  - [x] 4.3 Write a static markup test for `ScrambleHeading`
    - _Requirements: 1.5, 8.2_
  - [x] 4.4 Final checkpoint: `pnpm exec turbo run build lint test --filter=@lazarus/web`; manual check of the whole flow with and without reduced motion
    - Result: exit 0, 6 of 6 Turborepo tasks successful; 93 test files, 1,174 tests passed. Smoke test with `next start`: the Morgue and a sample corpse page answer 200, the Morgue `h1` is plain text, and the corpse page contains the beam, the progress bar, the glow, and the full Evidence_Text. The visual check in a browser is left to the user (Open Item 1).
  - [x] 4.5 Fix: the corpse page failed with `RangeError: Maximum call stack size exceeded` in `next dev`
    - Cause: `ScanBeam`, `EvidenceArrival`, and `AnchorGlide` bound their callbacks with the `contextSafe` of `useGSAP`. A ScrollTrigger already in view calls `onEnter` synchronously inside the `matchMedia` context, which nested the two contexts; the Strict Mode remount then reverted them recursively. The static tests and the production build did not show it.
    - Fix: `withMotion` in `gsap.ts` passes the `contextSafe` of the media context; the three components use it. A static check in `motion-math.test.ts` rejects `contextSafe` outside `gsap.ts`.
    - Result: in headless Chrome against `next dev`, the three sample pages, the Morgue, and the navigation from the Morgue to a sample load without exceptions, with motion and with reduced motion; after the animations the evidence headline is exactly the Evidence_Text and no line keeps an inline opacity. Turborepo `build lint test`: build and lint pass, 1,173 of 1,175 tests pass; the 2 failures are the known `ENOENT` of `build-output.test.ts` on OneDrive (spec-execution.md), and that file passes on its own (2 of 2).
    - _Requirements: 1.3, 2.2, 3.1, 5.2_

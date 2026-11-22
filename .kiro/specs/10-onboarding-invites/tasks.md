# Implementation Plan

## Preconditions

- Specs 04, 05, 06, 08, and 09 are implemented.

## Scope and conventions

- Work only inside `apps/web/`. Files of other specs: only those listed in `design.md`.
- Server Components only; no new client module, no dependency.
- Tests follow `testing-conventions.md`; test names start with `R<n>.<m>`.

## Tasks

- [x] 1. Write `src/lib/onboarding/copy.ts` and `copy.test.ts`
  - _Requirements: 1.1 to 1.6_
- [x] 2. Write `HowItWorks` and add it to the Morgue
  - _Requirements: 2.1_
- [x] 3. Write `GitHubSignInButton`, `CapabilityList`, and `SignInInvite`; replace the read-only notice of the Morgue
  - _Requirements: 3.1 to 3.3_
- [x] 4. Write `SampleInvite` and add it to the corpse page
  - _Requirements: 4.1 to 4.3_
- [x] 5. Add the Capability_List and the Trust_Line to the sign-in page
  - _Requirements: 5.1_
- [x] 6. Write `FirstSteps` and use it on the Morgue
  - _Requirements: 6.1_
- [x] 7. Write `onboarding.test.tsx` (static markup of the components)
  - _Requirements: 1.5, 3.1, 4.1, 4.2, 6.1_
- [x] 8. Checkpoint: `pnpm exec turbo run build lint test --filter=@lazarus/web`; open the Morgue, a sample, and the sign-in page in `next dev` as a Visitor
  - Result: exit 0, 6 of 6 Turborepo tasks; 95 test files, 1,191 tests passed. In headless Chrome against `next dev` as a Visitor: the Morgue, a sample, and the sign-in page load without exceptions; the Morgue shows How it works, the samples, and the invite (6 capabilities, `next=/import`); the sample page shows the sample invite. The Member views (First steps, the member sample invite) are covered by the static markup tests only.

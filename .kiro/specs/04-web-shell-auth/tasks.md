# Implementation Plan

## Preconditions

- `01-lazarus-foundation` is implemented (workspace files, `tsconfig.base.json`, `eslint.config.mjs`, `vitest.shared.ts`, schema, seed). The root declares `typescript@^6`.
- Work only inside `apps/web/`. The only allowed change outside it is the lockfile update from `pnpm install`.
- Before using an API of Next.js, Supabase SSR, shadcn/ui, or GSAP, check the docs for the version in `pnpm-lock.yaml` (see `tech.md`).
- All code, comments, UI text, and docs are in English. No explicit `any`.
- Never read or print the real `.env`. Use placeholder values in tests.

## Tasks

- [x] 1. Scaffold the package and confirm the toolchain
  - [x] 1.1 Create `apps/web/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `turbo.json`, `eslint.config.mjs`, `vitest.config.ts`, and a minimal `src/app/layout.tsx` and `page.tsx`
    - `next.config.ts` loads the root env with `loadEnvConfig(root, dev, console, true)`, sets `distDir` from `NEXT_DIST_DIR`, and returns the security and cache headers
    - _Requirements: 1.1 to 1.6, 2.1, 13.1, 13.8_
  - [x] 1.2 Run `pnpm install` and confirm `pnpm build`, `pnpm lint`, and `pnpm test` at the root include the package and exit with code 0
    - Resolve the open items about ESLint config lookup and pnpm build-script approvals
    - _Requirements: 1.3, 1.5, 1.7_

- [x] 2. Public configuration and the 503 page
  - [x] 2.1 Write `src/lib/env.ts` (`validatePublicConfig`, `readPublicConfig`) with literal `process.env` accesses
    - _Requirements: 2.2, 2.3, 2.8_
  - [x] 2.2 Write `src/app/configuration-error/page.tsx` and the 503 rewrite in `src/proxy.ts`
    - _Requirements: 2.4, 5.5_
  - [x] 2.3 Write tests for config validation (examples and the no-leak property)
    - _Requirements: 15.4_

- [x] 3. Security and request helpers
  - [x] 3.1 Write `src/lib/security/safe-redirect.ts` and `request-origin.ts`
    - _Requirements: 6.3, 6.8, 13.4_
  - [x] 3.2 Write tests for `safeRedirectPath` (examples and the same-origin property)
    - _Requirements: 15.2_

- [x] 4. Supabase clients, session refresh, and member helpers
  - [x] 4.1 Write `src/lib/supabase/client.ts`, `server.ts`, and `proxy.ts` (`updateSession`)
    - _Requirements: 5.1 to 5.4, 14.4_
  - [x] 4.2 Finish `src/proxy.ts` with the matcher and `updateSession`
    - _Requirements: 5.3, 5.4_
  - [x] 4.3 Write `src/lib/auth/member.ts` (`getCurrentMember`, `requireMember`)
    - _Requirements: 5.6, 5.8, 7.2, 7.3, 7.5_

- [x] 5. Theme, shadcn/ui, and layout
  - [x] 5.1 Initialize Tailwind 4 and shadcn/ui; define the Theme_Tokens; add the needed components (button, badge, card, alert-dialog, input, label, textarea, select)
    - _Requirements: 3.1 to 3.3_
  - [x] 5.2 Write the root layout, header, footer, skip link, and fixed fonts
    - _Requirements: 3.4, 3.5, 3.7, 3.8_
  - [x] 5.3 Write the contrast test for the tokens
    - _Requirements: 3.6_

- [x] 6. GSAP animation foundation
  - [x] 6.1 Write `src/animations/reveal.ts`, `use-reveal.ts`, and `reveal.tsx`; apply to the header and cards
    - _Requirements: 4.1 to 4.6_

- [x] 7. Authentication flow
  - [x] 7.1 Write `/sign-in` page and the `signInWithGitHub` and `signOut` Server Actions
    - _Requirements: 6.1, 6.2, 6.5, 7.3, 7.4_
  - [x] 7.2 Write `GET /auth/callback`
    - _Requirements: 6.3, 6.4_
  - [x] 7.3 Show the profile (username, avatar) in the header
    - _Requirements: 6.6, 6.7_

- [x] 8. Data layer
  - [x] 8.1 Write `src/lib/data/types.ts` (row types and guards) and `corpses.ts` (queries)
    - _Requirements: 8.2, 9.4, 9.5, 10.1, 10.2, 12.1_
  - [x] 8.2 Write tests with a fake client for the mapping, the guards, and the query parameters
    - _Requirements: 9.5_

- [x] 9. The Morgue
  - [x] 9.1 Write status presentation, badges, `CorpseCard`, empty and error states, and the Morgue page with its loading state
    - _Requirements: 8.1, 8.5 to 8.7, 9.1 to 9.8, 14.3_
  - [x] 9.2 Write tests for the status mapping
    - _Requirements: 15.5_

- [x] 10. Corpse page
  - [x] 10.1 Write `/corpses/[id]` with `CodeView`, curse list, placeholder for the next stages, and the delete control for owners
    - _Requirements: 10.1 to 10.7_

- [x] 11. Import
  - [x] 11.1 Write `lib/import/limits.ts`, `validate.ts`, and `hash.ts`
    - _Requirements: 11.3, 11.5_
  - [x] 11.2 Write tests for validation (examples and the oracle property) and for hashing
    - _Requirements: 15.3_
  - [x] 11.3 Write the import Server Action and the form
    - _Requirements: 11.1, 11.2, 11.4, 11.6 to 11.11_

- [x] 12. The Crypt and delete
  - [x] 12.1 Write the `deleteCorpse` Server Action, the confirm dialog, and the Crypt page with pagination
    - _Requirements: 12.1 to 12.7_

- [x] 13. Error and loading states
  - [x] 13.1 Write `not-found.tsx`, `error.tsx`, `global-error.tsx`, and loading components
    - _Requirements: 14.1 to 14.3_

- [x] 14. Security and isolation tests
  - [x] 14.1 Write the visitor-cannot-write test with a fake Supabase client
    - _Requirements: 8.3, 15.6_
  - [x] 14.2 Write the static isolation test (client import graph and forbidden strings)
    - _Requirements: 2.5 to 2.7, 13.5, 17.2_
  - [x] 14.3 Write the built-output test with sentinel values
    - _Requirements: 15.7, 15.8_

- [x] 15. Documentation
  - [x] 15.1 Write `apps/web/README.md`; confirm `.env.example` needs no new variable
    - _Requirements: 16.1 to 16.4_

- [x] 16. Final checkpoint
  - [x] 16.1 Run `pnpm lint`, `pnpm build`, `pnpm test`, and `pnpm test:db` from the root; confirm exit code 0
  - [x] 16.2 Check scope (Requirement 17) and re-read Requirements 1 to 17; list anything not verifiable

## Amendments

- **Spec 08 (environment).** The requirements of this spec gained criteria 2.9 and 2.10 (server-only module for later Server_Only_Variables, and the validation of the optional `LAZARUS_SANDBOX_KILL_SWITCH`), and the glossary and criterion 16.4 were updated. No task of this spec is reopened: the implementation (`apps/web/src/lib/env-server.ts` and its tests) and the `.env.example` entry belong to tasks 1.2 and 2.3 of `08-live-verification-api`.

---
inclusion: fileMatch
fileMatchPattern: ["apps/web/src/**/*.tsx", "apps/web/src/animations/**"]
---
# UI Components, Theme & Animation Rules

## Components
- Server Components by default. Add `'use client'` only when the file needs state, effects, or browser APIs.
- Client code never references `SUPABASE_SERVICE_ROLE_KEY`, `FLYWAY_*`, or LLM keys, and never uses a `NEXT_PUBLIC_` prefix for them. Reads from the browser use the anon key and RLS.
- Build on the shadcn/ui components in `apps/web/src/components/ui/` before writing custom primitives.
- All visible text is English.

## Theme
- Use the theme tokens, not raw hex values in components. Base palette: `#09090b` background, `#e11d48` (crimson) for curses, `#10b981` (emerald) for verified properties.
- Token changes must keep the contrast test passing.

## Animation (GSAP)
- Use `gsap` with `useGSAP` from `@gsap/react` so timelines are scoped to a container and reverted on unmount.
- Reusable timelines live in `apps/web/src/animations/`. Follow the pattern in `use-reveal.ts`: wrap animations in `gsap.matchMedia()` with `(prefers-reduced-motion: no-preference)` so reduced-motion users see the server-rendered final state.
- Never hide content with CSS and rely on JS to show it. The page must be readable without the animation.

## Product wording in the UI
- Equivalence results are empirical evidence. Show the exact run count (for example "Verified behavioral equivalence across 1,000 generated inputs"). Never write "proof", "guaranteed", or "100%".
- Anonymous visitors see precomputed results only. Do not render controls that trigger live LLM calls or database writes for them.

# Design Document

## Overview

All GSAP code stays in `apps/web/src/animations/`. The stage panels and pages remain Server Components; they wrap their existing markup in small client components from that folder, or mount a client component that renders nothing. The server-rendered HTML of every panel is unchanged, so the static-markup tests of `04-web-shell-auth` and `06-resurrection-ui` keep checking the Final_State.

The math that decides timing and text (beam duration, crossing time, count frames, link filtering) lives in one pure module, `motion-math.ts`, which imports neither `gsap` nor React and is covered by property-based tests. The client components only measure the DOM and hand the numbers to GSAP.

## Versions and APIs

| Item | Version | Source |
|---|---|---|
| `gsap` | 3.15.1 | `pnpm-lock.yaml`. The package ships ScrollTrigger, ScrollToPlugin, DrawSVGPlugin, and ScrambleTextPlugin as `gsap/<Name>` with type declarations in `gsap/types`. |
| `@gsap/react` | 2.1.2 | `useGSAP(func, { scope, dependencies, revertOnUpdate })`. The callback receives `(context, contextSafe)`. |

APIs used: `gsap.matchMedia().add(query, fn)`, `gsap.timeline`, `gsap.fromTo`, `ScrollTrigger.create({ trigger, start, once, onEnter })`, `scrollTrigger: { start: 0, end: 'max', scrub }`, `ScrollTrigger.refresh()`, `scrollTo: { y: Element, offsetY, autoKill }`, `drawSVG: '0% 100%'`, `scrambleText: { text, chars, revealDelay, speed }`.

## Module layout

```text
apps/web/src/animations/
├── gsap.ts               'use client'. Registers useGSAP, ScrollTrigger, ScrollToPlugin, DrawSVGPlugin, ScrambleTextPlugin once; re-exports them.
├── motion-math.ts        Pure. MOTION_QUERY, LINE_LINK_SELECTOR, sweepDuration, crossingTime, countFrame, hashTarget, shouldGlide.
├── motion-math.test.ts   Properties 1 to 4 and examples.
├── reveal.ts             (04) createReveal; adds createScrollReveal. Imports gsap through ./gsap.
├── use-reveal.ts         (04) Adds the `trigger` option.
├── reveal-section.tsx    (04) Adds the `trigger` prop.
├── scan-beam.tsx         Phase 1. Wraps the legacy source view.
├── anchor-glide.tsx      Phase 1. Renders nothing; one document click listener.
├── heartbeat.tsx         Phase 2. SVG pending indicator.
├── evidence-arrival.tsx  Phase 2. Wraps VerificationEvidence.
├── scroll-progress.tsx   Phase 3. Fixed bar.
└── scramble-heading.tsx  Phase 4. The Morgue h1.
```

`gsap.ts` also exports `withMotion(setup)`: it runs `setup` inside `gsap.matchMedia()` with `MOTION_QUERY`, passes it the `contextSafe` of that media context, and returns the cleanup for `useGSAP`. Callbacks must be made safe with this function, not with the `contextSafe` of `useGSAP`. A ScrollTrigger whose element is already in view calls `onEnter` synchronously while the media context is still being built; a callback bound to the outer `useGSAP` context then nests the two contexts inside each other, and the next revert (React Strict Mode remounts every component in development) recurses until `RangeError: Maximum call stack size exceeded`. This happened in the first version of phases 1 and 2 and is fixed by `withMotion`.

Server Components never import a value from a `'use client'` module other than a component, because such an import becomes a client reference. That is why `LINE_LINK_SELECTOR` lives in `motion-math.ts` and `AnchorGlide` reads it itself.

## Pure functions (`motion-math.ts`)

- `MOTION_QUERY = '(prefers-reduced-motion: no-preference)'`.
- `LINE_LINK_SELECTOR = 'a[href^="#source-line-"], nav[aria-label="Resurrection stages"] a[href^="#"]'`.
- `sweepDuration(lineCount)`: `clamp(0.9 + 0.03 * max(0, lineCount), 1.2, 3.2)`. A non-finite count gives 1.2. Non-decreasing in `lineCount`.
- `crossingTime({ center, viewHeight, beamHeight, duration })`: the beam's top edge moves linearly from `-beamHeight` to `viewHeight` over `duration`, so its center meets `center` at progress `(center + beamHeight / 2) / (viewHeight + beamHeight)`. The result is the progress clamped to `[0, 1]` times `duration`. A non-finite input or a non-positive travel gives 0.
- `countFrame(text, target, current)`: replaces the first occurrence of `formatRunCount(target)` in `text` with `formatRunCount(clamp(round(current), 0, target))`. If the formatted target does not occur, returns `text`. `countFrame(text, n, n) === text` for every text.
- `hashTarget(href)`: for `#<id>` with a non-empty id returns the decoded id, otherwise `null`.
- `shouldGlide({ button, metaKey, ctrlKey, shiftKey, altKey, defaultPrevented })`: true only for an unmodified primary-button click that no other handler prevented.

## Components

### ScanBeam (Requirement 2)

Props: `children`, `markedLines: readonly number[]`, `lineCount: number`, `idPrefix = 'source'`. Renders `<div ref class="relative">{children}<div aria-hidden class="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"><div data-scan-beam class="absolute inset-x-0 top-0 h-16 bg-linear-to-b from-transparent via-curse/20 to-transparent opacity-0" /></div></div>`. Only the beam layer clips, so the focus outline of the source view is never cut off. The page passes an array (`[...scannerView.markedLines]`) because the prop crosses the server-to-client boundary.

Inside `useGSAP` and `MOTION_QUERY`, one `ScrollTrigger.create({ trigger: root, start: 'top 75%', once: true, onEnter })`. `onEnter` (wrapped with `contextSafe`) measures `root.offsetHeight`, the beam height, and `offsetTop + offsetHeight / 2` of each `#<idPrefix>-line-<n>` (the wrapper is the offset parent), then builds one timeline:

- `set(lines, { opacity: 0.35 })` at 0;
- the beam: `opacity` 0 to 1, `y` from `-beamHeight` to `viewHeight` with `ease: 'none'` over `sweepDuration(lineCount)`, `opacity` back to 0;
- per line, at `crossingTime(...)`: `fromTo(line, { opacity: 0.35, x: -6 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power2.out', immediateRender: false })`;
- `clearProps: 'opacity,transform'` on the lines at the end.

### AnchorGlide (Requirement 3)

Renders `null`. Inside `useGSAP` and `MOTION_QUERY`, adds one `click` listener on `document` and removes it in the cleanup. The handler: `shouldGlide(event)`, `event.target.closest(LINE_LINK_SELECTOR)`, `hashTarget(href)`, `document.getElementById(id)`. If any step fails, it returns without calling `preventDefault`. Otherwise it calls `preventDefault`, `history.pushState(null, '', '#' + id)` (the App Router integrates native `pushState` calls), and `gsap.to(window, { duration: 0.7, ease: 'power2.inOut', scrollTo: { y: target, offsetY: 80, autoKill: true }, onComplete })`. `offsetY: 80` matches `scroll-mt-20` of the stage sections. `onComplete` focuses the target with `preventScroll` (adding `tabindex="-1"` until `blur` when the target has no tabindex) and, for an `li` inside a code view, plays `fromTo(target, { opacity: 0.4, x: -8 }, { opacity: 1, x: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)', clearProps: 'opacity,transform' })`.

### Heartbeat (Requirement 4)

`<svg aria-hidden viewBox="0 0 120 24" class="h-6 w-40 text-muted-foreground"><path d="M0 12 H40 L46 4 L52 20 L58 2 L64 22 L70 12 H120" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" /></svg>`. Inside `MOTION_QUERY`: a timeline with `repeat: -1` that draws the path (`drawSVG` from `'0% 0%'` to `'0% 100%'`, 1.1 s) and erases it from the start (`'100% 100%'`, 0.5 s). The animation does not depend on time elapsed since the request started. Outside the query the full path is visible.

`StageActions` replaces `<span aria-hidden="true" class="... motion-safe:animate-pulse" />` with `<Heartbeat className="mt-2" />`. Nothing else in `StageActions` changes.

### EvidenceArrival (Requirement 5)

Props: `children`, `runCount: number | null`, `tone: StatusTone`. Renders `<div ref class="relative">{children}<div data-evidence-glow aria-hidden class="pointer-events-none absolute inset-0 rounded-lg opacity-0 ring-2 ring-verified shadow-[0_0_32px] shadow-verified/40" /></div>` (the glow only for `verified`). `useGSAP` with `dependencies: [runCount, tone]` and `revertOnUpdate: true`, so a refresh after a live verification replays the new stored result. Inside `MOTION_QUERY`, a `ScrollTrigger.create({ trigger: root, start: 'top 85%', once: true, onEnter })`:

- count: when `runCount !== null` and the first `h3` in the scope contains `formatRunCount(runCount)`, set `aria-label` to its text, tween a plain object `{ value: 0 }` to `runCount` over 1.2 s (`power2.out`), write `countFrame(original, runCount, value)` into `h3.textContent` on update, and on complete (and in the cleanup) write the original text back and remove `aria-label`. The `h3` of `VerificationEvidence` has a single text child, so React keeps updating it by `textContent` and the change does not break reconciliation.
- glow, only for `verified`: `opacity` 0 to 1 to 0 over 1.4 s, starting 0.3 s after `onEnter` so the reveal finishes first.

`LaboratoryPanel` computes the view once (`const view = buildVerificationView(...)`) and renders `<EvidenceArrival runCount={view.runCount} tone={view.tone}><VerificationEvidence view={view} /></EvidenceArrival>`.

### Scroll reveal (Requirement 6)

`createScrollReveal(targets, options)` creates one `gsap.from(element, { ...REVEAL_FROM, duration, ease: 'power2.out', clearProps: 'opacity,transform', scrollTrigger: { trigger: element, start: 'top 92%', once: true } })` per element. `useReveal(scope, selector, { trigger })` chooses it when `trigger === 'scroll'`. `Reveal` passes the prop through; `StageSectionsView` uses `trigger="scroll"`.

### ScrollProgress (Requirement 7)

`<div ref aria-hidden class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-foreground/70 opacity-0" />`. Inside `MOTION_QUERY`: `gsap.set(bar, { opacity: 1 })` and `gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } })`, plus a `ResizeObserver` on `document.body` that calls `ScrollTrigger.refresh()` once per animation frame, disconnected in the cleanup. The bar uses a neutral token because crimson and emerald are reserved for curses and verified results.

### ScrambleHeading (Requirement 8)

Renders `<h1 ref className>{text}</h1>`. Inside `MOTION_QUERY`: set `aria-label={text}`, `gsap.to(h1, { duration: 1.1, scrambleText: { text, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&*+', revealDelay: 0.25, speed: 0.5 }, onComplete })`; `onComplete` and the cleanup set `textContent = text` and remove `aria-label`. The Morgue page replaces its `h1` with `<ScrambleHeading text="The Morgue" className="text-3xl font-semibold" />`.

Card hover is CSS only: the `Card` in `CorpseCard` gets `transition-[translate,border-color,background-color] duration-200 hover:border-ring/60 motion-safe:hover:-translate-y-0.5` next to its existing `hover:bg-accent/40`. Tailwind 4 writes the `translate` property, which does not collide with the `transform` that the load reveal sets on the outer `li`.

## Files of other specs touched (additive)

| File | Owner | Change |
|---|---|---|
| `src/animations/reveal.ts`, `use-reveal.ts`, `reveal-section.tsx` | 04 | Import through `./gsap`; add the `scroll` trigger. The default stays `load`. |
| `src/app/corpses/[id]/page.tsx` | 04/06 | Wrap the legacy `CodeView` in `ScanBeam`; mount `AnchorGlide` and `ScrollProgress`. |
| `src/app/(morgue)/page.tsx` | 04 | `ScrambleHeading` instead of the `h1`. |
| `src/components/corpse-card.tsx` | 04 | Hover classes on the `Card`. |
| `src/components/stages/stage-sections.tsx` | 06 | `trigger="scroll"` on the `Reveal`. |
| `src/components/stages/stage-actions.tsx` | 06 | `Heartbeat` instead of the pulsing bar. |
| `src/components/stages/laboratory-panel.tsx` | 06 | Compute the view once; wrap it in `EvidenceArrival`. |
| `test/stages-boundaries.test.ts` | 06 | Replace the two R13.6 checks (see Supersedes in `requirements.md`). |

## Correctness properties

1. **Sweep duration range and order.** For every line count, `sweepDuration` is in `[1.2, 3.2]`, and `a <= b` implies `sweepDuration(a) <= sweepDuration(b)`. (Requirement 2.4)
2. **Crossing time range and order.** For valid geometry, `crossingTime` is in `[0, duration]` and non-decreasing in `center`. (Requirement 2.5)
3. **Count frames end in the Final_State.** For every text and target, `countFrame(text, target, target) === text`; for every `current`, the result differs from `text` at most inside the first occurrence of the formatted target; and a text without that occurrence is returned unchanged. (Requirements 1.6, 5.2, 5.3)
4. **Only plain primary clicks glide.** `shouldGlide` is true if and only if `button === 0` and no modifier key is pressed and `defaultPrevented` is false. (Requirement 3.5)

## Testing

- `motion-math.test.ts`: Properties 1 to 4 with `numRuns` 200, plus examples (`countFrame('… 1,000 generated inputs.', 1000, 37)`, `hashTarget('#source-line-7')`, `hashTarget('#')`, `hashTarget('/x#y')`).
- Static markup (`renderToStaticMarkup`) of each new component: the children are unchanged, Decorations are `aria-hidden`, the heading text of `ScrambleHeading` is the Final_State. `useGSAP` does not run during server rendering, so this checks exactly what a user without JavaScript gets.
- The existing tests of `04` and `06` must keep passing without edits, except the two R13.6 checks named above.
- `test/isolation.test.ts` already checks that only Client Components import `gsap`; a new check in `motion-math.test.ts` reads every file in `src/` and asserts that `gsap/<Plugin>` is imported only by `animations/gsap.ts` (Requirement 1.2), and that no file in `src/animations/` has a raw hex color (Requirement 1.7).
- Manual check per phase in the browser with `pnpm --filter @lazarus/web dev`, once with motion and once with reduced motion emulated in the browser developer tools.

## Open items

1. Without a browser test runner in the repo, the timing of the animations is checked by hand. The pure functions that decide the timing are tested. The static markup tests cannot catch client-only failures: the context recursion above passed every test and the production build, and appeared only in `next dev` (Strict Mode). Every change to a Motion_Module must therefore be opened once in `next dev`, not only in a production build.

# Requirements Document

## Introduction

This spec uses the GSAP plugins that ship with the installed `gsap` package (3.15.1: ScrollTrigger, ScrollToPlugin, DrawSVGPlugin, ScrambleTextPlugin) to make the four-stage workflow easier to follow on the corpse page and the Morgue. Every animation shows something the page already contains: where the stored curses are, where a link goes, that a request is still running, and that a stored result has arrived. No animation adds information, changes a stored value, or suggests progress that the server does not report.

The work is delivered in four phases, each one usable on its own:

1. **Hex Scanner motion:** a scan beam that passes over the legacy source and marks the cursed lines as it crosses them, and a smooth scroll from a "Line N" link to that line.
2. **Laboratory motion:** a heartbeat line as the pending indicator of the stage controls, and an arrival animation for the verification evidence (a count up to the stored run count, and an emerald glow for a verified result).
3. **Scroll motion:** the stage content is revealed when it scrolls into view instead of all at once on load, and a thin reading-progress bar shows the position on the corpse page.
4. **Polish:** the Morgue title decodes itself on first load, and corpse cards lift slightly on hover.

**Prerequisites.** `04-web-shell-auth` (theme tokens, `Reveal`, `useReveal`, `createReveal`, the Morgue and corpse pages) and `06-resurrection-ui` (the stage panels, `StageActions`, `VerificationEvidence`, `buildVerificationView`).

**Supersedes.** Requirement 13 criterion 6 of `06-resurrection-ui` ("SHALL NOT add a new timeline" and "the pending indicator SHALL use only CSS animation") and the two static checks in `apps/web/test/stages-boundaries.test.ts` that enforce it. They are replaced by Requirement 1 and Requirement 4 of this spec.

**Out of scope:** page transitions between routes; animating the delete of a corpse in The Crypt (the delete is a Server Action form that redirects, so there is no client list to animate); a curse counter in the Hex Scanner summary (the count is part of a sentence that the tests of `06-resurrection-ui` check as text); any new dependency, migration, route, or server code; any change to stored data or API responses.

## Glossary

- **Web_App**, **Corpse_Page**, **Morgue_Page**, **Theme_Tokens**, **Reveal_Timeline**: As defined in `04-web-shell-auth`.
- **Stage_Sections**, **Stage_Overview**, **Stage_Actions**, **Hex_Scanner_Panel**, **Laboratory_Panel**, **Evidence_Text**: As defined in `06-resurrection-ui`.
- **Motion_Module**: A file in `apps/web/src/animations/` that imports `gsap` or `@gsap/react`. Every Motion_Module is a Client Component.
- **Motion_Query**: The media query `(prefers-reduced-motion: no-preference)`. An animation runs only while it matches.
- **Final_State**: What the server-rendered HTML shows without JavaScript. Every animation starts from a temporary state and ends in the Final_State.
- **Decoration**: An element that exists only for an animation, carries no text a user needs, and is marked `aria-hidden="true"`.
- **Scan_Beam**: The Decoration that moves down over the legacy source view.
- **Cursed_Line**: A line of the legacy source view that has at least one stored curse (`markedLines` of the scanner view).
- **Line_Link**: A "Line N" link of the Hex_Scanner_Panel (`href="#source-line-N"`) or a link of the Stage_Overview (`href="#<stage id>"`).
- **Heartbeat**: The SVG line that the Stage_Actions show while a request is pending.
- **Evidence_Arrival**: The animation of the verification evidence block when it scrolls into view.
- **Progress_Bar**: The Decoration fixed at the top of the viewport whose width follows the scroll position of the Corpse_Page.

## Requirements

### Requirement 1: Motion rules for every animation

**User Story:** As a user with a motion preference, a screen reader, or a slow connection, I want the animations to be optional and harmless, so that the page works the same without them.

#### Acceptance Criteria

1. THE Web_App SHALL import `gsap`, `@gsap/react`, and every GSAP plugin only from Motion_Modules, and every Motion_Module SHALL start with the `'use client'` directive.
2. THE Web_App SHALL register the GSAP plugins it uses in one module, `apps/web/src/animations/gsap.ts`, and the other Motion_Modules SHALL import `gsap` and the plugins through it.
3. THE Motion_Modules SHALL create every animation, event listener, and ScrollTrigger inside `useGSAP` (with a `scope` when the component renders an element), and animations started later from a callback (an event handler or a ScrollTrigger `onEnter`) SHALL be wrapped with the `contextSafe` function of the `gsap.matchMedia()` context that created the callback, never with the one of `useGSAP`, so that everything is reverted when the component unmounts and a revert never recurses.
4. WHILE the Motion_Query does not match, THE Web_App SHALL run no animation and SHALL show the Final_State, and a Line_Link SHALL keep its native jump.
5. THE Web_App SHALL render all content in its Final_State in the server-rendered HTML, so that the page is readable when JavaScript is disabled or fails to load. Only a Decoration MAY be invisible in the Final_State.
6. THE animations SHALL change only `transform` and `opacity` of HTML elements, the stroke drawing of the Heartbeat path, and the text of an element whose only child is text; and every element with changed text SHALL carry an `aria-label` with its Final_State text while the text is changing, and SHALL end with exactly its Final_State text.
7. THE animations SHALL use Theme_Tokens for color and SHALL NOT contain a raw hex color.
8. THE Web_App SHALL NOT add a dependency for this spec.

### Requirement 2: Scan beam over the legacy source

**User Story:** As a judge opening a sample corpse, I want to see the scanner pass over the legacy code and light up the cursed lines, so that I understand at a glance where the curses are.

#### Acceptance Criteria

1. THE Corpse_Page SHALL wrap the legacy source view in a Scan_Beam component that receives the Cursed_Line numbers and the id prefix of the lines.
2. WHEN the legacy source view first scrolls into view, THE Scan_Beam SHALL move once from the top to the bottom of the view, and SHALL NOT run again on the same page load.
3. WHILE the Scan_Beam is moving, each Cursed_Line SHALL be shown dimmed until the moment the center of the Scan_Beam crosses the center of the line, and SHALL then return to its Final_State with a short horizontal nudge.
4. THE duration of the movement SHALL be computed by a pure function of the number of source lines that grows with the line count and stays between 1.2 and 3.2 seconds.
5. THE crossing time of a line SHALL be computed by a pure function of the line position, the view height, the beam height, and the duration, and SHALL stay between 0 and the duration.
6. IF the legacy source has no Cursed_Line, THEN THE Scan_Beam SHALL still move once and SHALL change no line.
7. THE Scan_Beam SHALL be a Decoration and SHALL NOT intercept pointer events.

### Requirement 3: Smooth scroll for line and stage links

**User Story:** As a user reading the curse list, I want "Line N" to take me smoothly to that line and show me which line it is, so that I do not lose my place.

#### Acceptance Criteria

1. WHEN a user activates a Line_Link whose target exists on the page, THE Web_App SHALL prevent the native jump, scroll the window to the target with an offset that keeps the target below the top edge, and add the link's fragment to the browser history.
2. WHEN the scroll to a line of a code view ends, THE Web_App SHALL play a short highlight on that line (opacity and horizontal nudge only).
3. WHEN the scroll ends, THE Web_App SHALL move keyboard focus to the target without scrolling again, and a target that is not focusable SHALL receive `tabindex="-1"` only for as long as it has focus.
4. IF the user scrolls by hand during the smooth scroll, THEN THE Web_App SHALL stop the smooth scroll.
5. IF the target of a Line_Link does not exist, or the link is activated with a modifier key or a button other than the primary one, THEN THE Web_App SHALL leave the native behavior unchanged.
6. THE skip link and every link outside the Line_Link selectors SHALL keep their native behavior.

### Requirement 4: Heartbeat pending indicator

**User Story:** As a member waiting for a scan, séance, reincarnation, or verification, I want a clear sign that the request is still running, so that I do not click again or leave.

#### Acceptance Criteria

1. WHILE a Stage_Actions request is pending, THE Stage_Actions SHALL show the Heartbeat inside the pending notice in place of the pulsing bar.
2. THE Heartbeat SHALL be a Decoration drawn with `currentColor` and a muted Theme_Token, and SHALL repeat its drawing until the component unmounts.
3. THE Heartbeat SHALL stay indeterminate: it SHALL NOT show a percentage, a count, or any movement that depends on time elapsed, because the routes report no progress.
4. WHILE the Motion_Query does not match, THE Heartbeat SHALL show the complete line without movement.
5. THE pending text, its `role="status"` announcement, the button, and the request behavior of the Stage_Actions SHALL stay unchanged.

### Requirement 5: Evidence arrival in the Laboratory

**User Story:** As a judge, I want the verification result to stand out when I reach it, so that the empirical evidence is the moment I remember.

#### Acceptance Criteria

1. THE Laboratory_Panel SHALL wrap the verification evidence block in an Evidence_Arrival component that receives the run count shown in the text (`runCount` of the verification view) and the tone.
2. WHEN the evidence block first scrolls into view, or WHEN its run count or tone changes after a page refresh, and the run count is not null, THE Evidence_Arrival SHALL count the number in the headline from 0 up to the stored run count, formatted with `formatRunCount`, and SHALL end with the exact Evidence_Text or headline of the Final_State.
3. THE count SHALL change only the first occurrence of the formatted run count in the headline, and IF the headline does not contain it, THEN THE Evidence_Arrival SHALL not change the text.
4. WHEN the evidence block first scrolls into view and the tone is `verified`, THE Evidence_Arrival SHALL fade an emerald glow Decoration in and out once.
5. THE Evidence_Arrival SHALL NOT add the glow for any other tone, and SHALL NOT change the state label, the details, or the tone of the block.
6. THE count SHALL replay a stored result only; it SHALL NOT run while a verification request is pending and SHALL NOT be presented as live progress.

### Requirement 6: Stage content revealed on scroll

**User Story:** As a user, I want each part of a stage to appear as I reach it, so that the animation is not spent on content I cannot see yet.

#### Acceptance Criteria

1. THE Reveal component SHALL accept a `trigger` of `load` (the default, the current behavior) or `scroll`.
2. WHEN `trigger` is `scroll`, THE Reveal_Timeline SHALL animate each matching element once, when its top edge enters the lower part of the viewport, with the same `opacity` and `y` values as on load.
3. THE Stage_Sections SHALL use the Reveal with `trigger="scroll"`.
4. THE page header and the Morgue cards SHALL keep `trigger="load"`.

### Requirement 7: Reading progress on the corpse page

**User Story:** As a user on a long corpse page, I want to see how far down I am, so that I know how much is left.

#### Acceptance Criteria

1. THE Corpse_Page SHALL render a Progress_Bar fixed at the top edge of the viewport, above the page content, that does not intercept pointer events.
2. THE width of the Progress_Bar SHALL follow the scroll position of the page from 0 at the top to full width at the bottom, through a `transform: scaleX()` change only.
3. WHEN the height of the page changes (for example when the stage sections finish streaming or a `details` element opens), THE Progress_Bar SHALL recompute its range.
4. WHILE the Motion_Query does not match, THE Progress_Bar SHALL stay invisible.

### Requirement 8: Morgue title and card hover

**User Story:** As a first-time visitor, I want the Morgue to feel alive on arrival, so that the theme of the product is clear.

#### Acceptance Criteria

1. WHEN the Morgue_Page loads, THE title "The Morgue" SHALL decode once from scrambled characters to its text in at most 1.2 seconds, and SHALL end with exactly "The Morgue".
2. THE title SHALL stay the only `h1` of the page and SHALL keep its accessible name "The Morgue" during the animation.
3. WHEN a pointer hovers a corpse card, THE card SHALL lift by a few pixels through a CSS transition behind the `motion-safe` variant and SHALL highlight its border with the neutral `ring` token (crimson and emerald stay reserved for curses and verified results), and SHALL keep its current link, focus, and background behavior.

# Design Document

## Overview

All text and numbers live in one pure module, `apps/web/src/lib/onboarding/copy.ts`. The components in `apps/web/src/components/onboarding/` are Server Components that render that data; none of them is a client module. The pages read the Live_Flags on the server and pass them down as plain booleans.

## Pure module (`lib/onboarding/copy.ts`)

Imports only pure modules: `IMPORT_LIMITS`, `LIMITS`, `VERIFICATION_LIMITS`, `formatRunCount`.

- `IMPORT_SIZE_LABEL`: `${IMPORT_LIMITS.maxBytes / 1024} KB`, the unit the import form already uses ("100 KB").
- `MODEL_SOURCE_LABEL`: `${formatRunCount(LIMITS.maxLlmSourceBytes)} bytes` ("20,000 bytes"). Bytes, not KB, because the limit is a decimal count and the import limit is binary.
- `capabilities(live)`: `{ lead, text }[]` (Import, Scan, Extract, Reincarnate, optional Verify, Keep).
- `usageNote(live)`: one sentence with `LIMITS.userQuota.limit` and, while a flag is on, `VERIFICATION_LIMITS.userQuota.limit`. Both windows are 3,600 s, which the tests check, so "per hour" is correct.
- `TRUST_LINE`, `STAGES` (four `{ name, text }`), `FIRST_STEPS` (four strings).

## Components

| Component | Used by | Content |
|---|---|---|
| `GitHubSignInButton({ next })` | invite, sample invite | `<form action={signInWithGitHub}>` with the hidden `next` and a `Button`. |
| `CapabilityList({ live })` | invite, sign-in page | `<ul>` of `capabilities(live)`, the lead in `font-medium`. |
| `HowItWorks()` | Morgue | `<ol>` of `STAGES` in a 4-column grid on wide screens. |
| `SignInInvite({ live })` | Morgue (Visitor) | Card: heading "Resurrect your own code", list, button, Trust_Line, usage note. |
| `SampleInvite({ signedIn })` | corpse page (sample) | Visitor: button and Trust_Line. Member: link to `/import`. |
| `FirstSteps()` | Morgue (Member, no corpse) | `<ol>` of `FIRST_STEPS`, link to `/import`, `MODEL_SOURCE_LABEL`. |

## Files of other specs touched

| File | Owner | Change |
|---|---|---|
| `src/app/(morgue)/page.tsx` | 04 | `HowItWorks`; `SignInInvite` instead of the read-only `Notice`; sample heading text for visitors; `FirstSteps` instead of "Nothing buried yet". |
| `src/app/sign-in/page.tsx` | 04 | `CapabilityList` and Trust_Line. |
| `src/app/corpses/[id]/page.tsx` | 04/06/09 | `SampleInvite` after the stage sections for a sample. |

## Testing

- `copy.test.ts`: numbers come from the constants; the Verify item and the verification limit follow the flags (all four combinations); no Forbidden_Term in any text; both quota windows are one hour; the sign-in action passes no `scopes` option.
- `onboarding.test.tsx`: static markup of each component with `signInWithGitHub` mocked; the invite has `next=/import`; the member sample invite has no form.
- Manual check in `next dev` as a Visitor and as a Member.

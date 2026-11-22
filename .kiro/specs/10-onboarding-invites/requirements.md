# Requirements Document

## Introduction

A visitor of the Morgue sees three sample corpses and a read-only notice, and nothing tells them what signing in adds. This spec tells visitors and new members what they can do with their own code, with the real limits of the application, at the places where they decide:

1. **How it works:** the four stages in one strip at the top of the Morgue.
2. **Sign-in invite:** in place of the read-only notice of the Morgue, a block for visitors that lists what a member can do, the GitHub sign-in button, and what GitHub shares.
3. **Sample invite:** at the end of a sample corpse page, a short invitation to run the same stages on one's own code.
4. **Sign-in page:** the same list of capabilities and the same trust line.
5. **First steps:** for a member with no corpse yet, the steps of a first resurrection in place of the bare empty state of the Morgue.

**Prerequisites.** `04-web-shell-auth` (Morgue, sign-in page, `signInWithGitHub`, `EmptyState`), `05-llm-pipeline-api` (`LIMITS`), `06-resurrection-ui` (corpse page, `formatRunCount`, `FORBIDDEN_TERMS`), `08-live-verification-api` (`VERIFICATION_LIMITS`, `effectiveExecution`, `effectiveSampleExecution`), `09-motion-ux` (`ScrambleHeading` on the Morgue).

**Out of scope:** new routes, data, or migrations; changes to the limits; client components or animations; the Crypt empty state.

## Glossary

- **Visitor**, **Member**, **Sample_Corpse**, **Morgue_Page**, **Corpse_Page**: As defined in `04-web-shell-auth`.
- **Forbidden_Terms**: As defined in `06-resurrection-ui` (`apps/web/src/lib/stages/wording.ts`).
- **Capability_List**: The ordered list of what a Member can do, computed by one pure function from the limit constants and the Live_Flags.
- **Live_Flags**: `ownCode` (the server decision `effectiveExecution().enabled`) and `samples` (`effectiveSampleExecution().enabled`), read on the server for each request.
- **Trust_Line**: The sentence that says what Lazarus receives from GitHub at sign-in.

## Requirements

### Requirement 1: Facts come from the code

**User Story:** As a judge, I want the numbers on the page to be the real limits, so that the invitation is honest.

#### Acceptance Criteria

1. THE Capability_List SHALL take every number from the constants `IMPORT_LIMITS`, `LIMITS`, and `VERIFICATION_LIMITS`, and SHALL NOT repeat a number as a literal.
2. THE Capability_List SHALL state the import size limit (`IMPORT_LIMITS.maxBytes`) and, as a separate fact, the source size limit of the Séance and the Reincarnation (`LIMITS.maxLlmSourceBytes`).
3. THE Capability_List SHALL include a live verification item only WHILE a Live_Flag is true: for the Member's own code WHILE `ownCode` is true, otherwise for the samples WHILE `samples` is true.
4. THE usage note SHALL state the per-account limit of new Séance and Reincarnation generations, and the per-account limit of live verifications only WHILE a Live_Flag is true.
5. THE Trust_Line SHALL say that Lazarus asks GitHub for the public profile and the email addresses only and gets no access to repositories, which matches the default `user:email` scope of the Supabase GitHub provider, and THE sign-in call SHALL NOT request additional scopes.
6. No text of this spec SHALL contain a Forbidden_Term.

### Requirement 2: How it works

1. THE Morgue_Page SHALL show, below its title and description, an ordered list of the four stages (The Morgue, Hex Scanner, Séance Chamber, Laboratory), each with one sentence, for every viewer.

### Requirement 3: Sign-in invite on the Morgue

1. WHILE the viewer is a Visitor, THE Morgue_Page SHALL NOT show the read-only notice, and SHALL show, directly below the sample section (so the samples stay the first content), a section with a heading, the Capability_List, a GitHub sign-in button whose `next` is `/import`, the Trust_Line, and the usage note.
2. THE sample section SHALL say below its heading, for a Visitor, that the samples are read-only with precomputed results.
3. WHILE the viewer is a Member, THE Morgue_Page SHALL NOT show the invite.

### Requirement 4: Sample invite on a corpse page

1. WHILE a Visitor views a Sample_Corpse, THE Corpse_Page SHALL show, after the stage sections, an invitation with a GitHub sign-in button whose `next` is `/import` and the Trust_Line.
2. WHILE a Member views a Sample_Corpse, THE Corpse_Page SHALL show, after the stage sections, a link to `/import` instead.
3. THE Corpse_Page of an Owned_Corpse SHALL NOT show either invitation.

### Requirement 5: Sign-in page

1. THE sign-in page SHALL show the Capability_List and the Trust_Line next to its existing button, and SHALL keep its redirect behavior.

### Requirement 6: First steps

1. WHILE a Member has no corpse, THE Morgue_Page SHALL show, in place of the "Nothing buried yet" empty state, the four steps of a first resurrection, a link to `/import`, and the source size limit of the Séance and the Reincarnation.

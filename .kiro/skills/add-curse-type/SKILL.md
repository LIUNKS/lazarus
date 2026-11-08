---
name: add-curse-type
description: Step-by-step procedure to add a new curse type (a new Hex Scanner detection) to Lazarus without leaving the scanner, the database, the tests, and the docs out of sync. Use when the user asks to detect a new legacy JavaScript pattern.
---

# Add a curse type

A curse type is stored in four places that must agree: the scanner, its tests, the `curses` table, and the written rules. Missing one breaks a CHECK constraint or a test at runtime, so work through the list in order.

Placeholders: `<NEW_TYPE>` is the upper-case identifier (for example `WITH_STATEMENT`), `<kebab>` is its lower-case form with hyphens (`with-statement`).

## 0. Confirm scope
- Ask the user for: the pattern to detect, its severity (`HEX`, `BLOOD_CURSE`, or `FATAL`), and the source languages it applies to (`es3`, `es5-jquery`, `legacy-node`).
- This changes a contract that spec `02-scanner-and-verifier` defines ("the six Curse_Types"). Update that spec's `requirements.md` and `design.md` first (or ask the user to approve the change), then implement.

## 1. Scanner (`packages/mcp-curse-scanner/src/scanner/`)
1. `types.ts`: add `'<NEW_TYPE>'` to the `CurseType` union.
2. `constants.ts`:
   - Append the type to `CURSE_TYPE_ORDER`. The order is part of the output contract (findings sort by position, then by this order), so append at the end.
   - Add the entry to `CURSE_TABLE` with `severity`, `description`, and `exorcismStrategy`. Texts are printable ASCII, 10 to 500 characters, different from every other text, contain no interpolation of source content, and contain none of the banned phrases (`100%`, `mathematical proof`, `mathematically proven`, `guaranteed`).
3. `detectors.ts`: add the detection inside `createDetectors` and report with `ctx.record('<NEW_TYPE>', node.start)`. One finding per `(curseType, start offset)`.
4. Keep it deterministic: no timestamps, paths, or randomness in any result.

## 2. Scanner tests (`packages/mcp-curse-scanner/test/`)
1. `support/corpus/<kebab>.ts`: export `<NEW_TYPE>_CASES` built with `kase(requirementId, name, source, [at(type, line, column)])`. Include positive cases and negative cases (code that looks similar and must not be reported). Follow `support/corpus/prototype-pollution.ts`.
2. `support/curse-corpus.ts`: import the cases and add them to the combined list.
3. `unit/detect-<kebab>.test.ts`: copy the shape of `unit/detect-prototype-pollution.test.ts`.
4. Add `'<NEW_TYPE>'` to the type lists in `support/clean-corpus.ts` and in `property/determinism.property.test.ts` (`ORDER`). Check `fc` generators that inject curses still produce valid programs.
5. README of the package: the `Detection rules` table has one row per curse type in order. Add the row.
6. Run `pnpm --filter @lazarus/mcp-curse-scanner test` and `pnpm lint`.

## 3. Database (never edit `V1__create_lazarus_schema.sql`)
1. Create a new migration `db/migrations/V<N>__add_<kebab>_curse_type.sql` that drops and re-adds the constraint `curses_curse_type_check` with the full list including `<NEW_TYPE>`. Follow the `add-flyway-migration` skill.
2. Update the lists in `db/tests/schema.test.ts` (test `R10.5`), `db/tests/seed.test.ts`, and `db/tests/support/js-analysis.ts` (the type union and the `switch` that checks a line).
3. Run `pnpm test:db` (needs the local database described in `db/local/`).

## 4. Written rules
- `.kiro/steering/product.md` (list of curses in "The Hex Scanner") and `.kiro/steering/database-and-exorcism.md` (the `curse_type` CHECK in section 1, item 3).
- Search the repo for a leftover list: `grep` for `PROTOTYPE_POLLUTION` outside `node_modules`. When this skill was written, `apps/web` did not enumerate the types, so a new match there means a UI list to update.

## 5. Report
Say which of the steps ran, the test counts, and anything you could not run (for example `pnpm test:db` without a database).

---
name: resurrect-corpse
description: The four-stage Lazarus workflow (scan, seance, reincarnation, property-based verification) applied by hand to one legacy JavaScript function, using the lazarus-curse-scanner MCP tools. Use when the user wants to resurrect, analyze, or demo a legacy JS module.
---

# Resurrect a corpse

Reference sample: `db/seed/query-string-parser/` (files `legacy.js`, `modern.ts`, `test-code.js`, `sample.json`). Read it once before starting; it shows the expected shape of every artifact.

## Input rules
- Legacy JavaScript only: `es3`, `es5-jquery`, or `legacy-node`. Anything else is out of scope.
- The unit under test is a classic script that declares the entry function as a top-level `function` declaration. It does not reference `module`, `exports`, `require`, `$`, `jQuery`, `window`, `document`, or `global`. If the user's code does, say what blocks verification and propose a smaller pure function to extract.

## Stage 1: Hex Scanner (deterministic)
1. Call the MCP tool `scan_ast_curses` with `{ source, sourceLanguage }`. It returns curses with `curseType`, `severity`, `lineNumber`, `column`, `description`, `exorcismStrategy`.
2. Call `extract_function_signatures` with the same arguments. Pick the entry function. `pureCandidate` and `impurityMarkers` are a static heuristic, not proof of purity.
3. Report the findings exactly as returned. Do not invent curses the scanner did not report. If a call returns `ok: false`, show its error code.

## Stage 2: Séance (spec extraction)
Write three artifacts for the entry function:
- `requirements.md` in EARS notation: `WHEN ... THE <fn> SHALL ...`, `IF ... THEN ...`, `WHERE ...`. One observable behavior per criterion.
- `design.md`: entry function name, input, output, purity statement, and how each curse is removed.
- Invariants: `{ input, output, list[] }` with properties that hold for every valid input (for example determinism, idempotence, key never appears).

## Stage 3: Reincarnation
- One self-contained TypeScript module that exports the entry function under the same name. No `import` declarations. Strict mode, no `any`.
- Remove each reported curse with the `exorcismStrategy` as a starting point: `const` and `let` instead of `var`, strict equality, no global writes, no dynamic evaluation, safe key handling.
- Keep behavior identical, including thrown error names.

## Stage 4: Property-based verification
- Write the test body following the `Test_Code_Contract` in `.kiro/steering/database-and-exorcism.md`: it receives `fc`, `legacyFn`, `modernFn`, `assertEquivalent`, `numRuns`; has no `import`, `export`, or `require`; never hardcodes the run count; ends with `return fc.property(...)`.
- Use `assertEquivalent(input)` so both functions get independent deep copies and outcomes are compared by the documented rules (deep equality, thrown values by `name`).
- Run it with the runner in `db/harness/` (`runPbtTestCode`) until `packages/pbt-verifier` exists. Use 100 to 1,000 runs and a fixed seed.
- Executing user-imported code needs the isolated sandbox from spec `07-sandboxed-execution`. Without it, run only sample or user-approved code, and never use `node:vm` as a security boundary.

## Reporting
- State the result as empirical evidence with the exact run count and seed, for example "Verified behavioral equivalence across 1,000 generated inputs (seed 20260102)". On failure, show the counterexample.
- Do not write "proof", "100%", or "guaranteed". See `#writing-and-claims`.

## Caution: shipping a new sample corpus
The three sample corpses are inserted by `V2__seed_sample_corpses.sql`, which `db/seed/generate-seed.ts` generates and Flyway checksums. Adding a fourth sample would change that file. Do not regenerate it. Ask the user how to ship a new sample (for example a new migration).

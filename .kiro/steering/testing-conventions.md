---
inclusion: fileMatch
fileMatchPattern: ["**/*.test.ts", "**/*.test.tsx", "db/tests/**"]
---
# Testing Conventions (Vitest + fast-check)

## Running tests
- Use `vitest run` (single execution). Never start watch mode from the agent.
- Per package: `pnpm --filter <package-name> test`. For the whole repo: `pnpm test`. Database tests: `pnpm test:db`.

## Property-based tests
- Use `fast-check` and pass an explicit `numRuns` to every `fc.assert`. Typical values in this repo are 100 to 300.
- Put the traceability comment as the first line inside the `it` body, in this exact format:
  - `// Feature: <spec-folder-name>, Property <N>: <short title>`
  - `// Feature: <spec-folder-name>, Supporting check: <short title>` for checks that support a property without being one.
  - Example: `// Feature: 02-scanner-and-verifier, Property 7: UTF-8 size rule`
- Name each test with the requirement it covers, for example `R12.2 accepts a source if and only if ...`.
- Use a fixed `seed` with `fc.sample` when a test needs a reproducible corpus.
- Test properties of behavior (determinism, ordering, ranges, round trips), not a restatement of the implementation.

## Equivalence checks (JS to TS)
- Compare outcomes with the rules in `database-and-exorcism.md`: structural deep equality (`NaN` equals `NaN`, `+0` differs from `-0`), thrown values compare by `name`, and a return never equals a throw.
- Pass independent deep copies of each input to the legacy and the modern function.
- Run counts for live verification stay between 100 and 1,000.

## Wording
- Describe results as empirical evidence with the exact number of runs. Do not write "proof" or "100%" in test names, messages, or fixtures.

---
inclusion: manual
---
# Writing & Claims Guide

Attach this file (`#writing-and-claims`) when you write the README, `docs/`, UI copy, the hackathon submission, or any text that describes what Lazarus proves.

## Language
- Everything is in English: UI text, comments, documentation, specs, commit messages.
- Plain sentences, active voice. One term per concept (see the glossary below).

## What Lazarus may claim
- The Hex Scanner is deterministic: the same source gives the same findings with the same line numbers.
- The Laboratory reports **empirical evidence**: legacy and modern functions agreed on N generated inputs. Always give the exact N and, when relevant, the seed. Example: "Verified behavioral equivalence across 1,000 generated inputs".
- A failing run is a result, not an error to hide. Show the counterexample that `fast-check` found.

## What Lazarus must not claim
These phrases are rejected by the seed generator and by `db/tests/seed.test.ts`, and are reviewed by the `guard-sensitive-writes` hook in user-facing files:
- `100%`
- `mathematical proof`
- `mathematically proven`
- `guaranteed`

Also avoid, for the same reason: "proves", "bug-free", "perfect translation", "zero regressions". The product name "Empirical Proof of Life" is a title and stays as it is; do not use "proof" as a claim about correctness.

## Scope statements to keep honest
- Supported sources: legacy JavaScript only (ES3, ES5/jQuery, legacy Node). Python 2, PHP 5, and COBOL are out of scope.
- Live PBT runs only for code that can run in-process in the JS runtime. User-imported code runs only inside the sandbox described in `07-sandboxed-execution`, and the sandbox README states its limits. `node:vm` is not a security boundary.
- Anonymous visitors see precomputed results for the sample corpses. They never trigger LLM calls or database writes.
- Say which parts are implemented. Do not describe a spec that has open tasks as a working feature.

## Glossary (use these terms)
| Term | Meaning |
|---|---|
| Corpse | A legacy JS module stored in Lazarus (`corpses` table). Sample corpses have `is_sample = true`. |
| Curse | A finding of the Hex Scanner, with a type, severity, and exact line. |
| Séance | Extraction of the business logic into a spec (EARS requirements, design, invariants). |
| Reincarnation | The generated TypeScript module and its property-based test. |
| Morgue / Crypt | The public sample list / the signed-in user's private history. |
| Equivalence evidence | The number of generated inputs on which legacy and modern code agreed. |

## Kiro usage write-ups
When you describe how Kiro was used, cite concrete artifacts: the spec folder, the hook file, the steering file, the MCP tool call. A claim without an artifact to point at does not belong in the write-up.

---
inclusion: always
---
# Product Overview: Lazarus

Lazarus is an autonomous legacy JavaScript resurrection platform built for Kiroween 2026 (Resurrection Category).
All UI text, code comments, documentation, and generated Specifications MUST be in **English**.

Instead of fragile line-by-line LLM translation ("vibe coding"), Lazarus resurrects dead JavaScript modules (ES3 / ES5 / jQuery / old Node) into strict, modern TypeScript through a 4-stage workflow:

1. **The Morgue (Dashboard & Ingestion):**
   - **Frictionless Judge/Sandbox Mode:** Instant anonymous, read-only access without login, featuring 3 pre-loaded legacy JS "Sample Corpses" (`is_sample = true` in Supabase). Anonymous sessions never write to the database and never trigger live LLM calls; they view precomputed results for the samples.
   - **GitHub OAuth (Supabase Auth):** Optional sign-in allowing authenticated users to import custom legacy JS files and persist their private resurrection history in "The Crypt".
2. **The Hex Scanner (Deterministic Curse Diagnostics):**
   - Scans legacy JS using an AST static analyzer (`packages/mcp-curse-scanner`) to detect "Curses" with exact line numbers: `GLOBAL_POLLUTION` (mutable global state), `VAR_HOISTING`, `IMPLICIT_COERCION`, `CALLBACK_HELL`, `EVAL_INJECTION`, `PROTOTYPE_POLLUTION`.
3. **The Séance Chamber (Spec-Driven Extraction):**
   - Extracts core business logic ("the soul") into structured Kiro Specs (`requirements.md` in EARS notation, `design.md`, and input/output invariants).
4. **The Laboratory (Reincarnation & Empirical Proof of Life):**
   - Generates modern, pure TypeScript from the extracted Specs and runs **Property-Based Testing (PBT)** with `fast-check` to empirically verify behavioral equivalence between the legacy JS function and the TypeScript implementation across N randomly generated inputs (e.g., 1,000 runs).
   - Results are reported as empirical evidence, never as a mathematical proof.

## Scope Limits
- Supported source languages: legacy JavaScript only (ES3, ES5/jQuery, legacy Node). Python 2 and PHP 5 are out of scope.
- Live PBT execution is limited to code that can run in-process in the JS runtime (see execution safety rules in `database-and-exorcism.md`).

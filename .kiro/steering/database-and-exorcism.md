---
inclusion: fileMatch
fileMatchPattern: ["db/**", "packages/**", "apps/web/src/lib/**", "apps/web/src/app/api/**"]
---
# Database Schema (Flyway + RLS) & Legacy Exorcism Rules

## 1. Schema (all changes via `db/migrations/V<N>__<description>.sql`)
Use `uuid` PKs with `gen_random_uuid()` defaults and `timestamptz` timestamps.

1. `public.profiles`: `id` (UUID PK, `REFERENCES auth.users(id) ON DELETE CASCADE`), `email`, `github_username`, `avatar_url`, `created_at`. Do NOT create a standalone `users` table. Populate it with a trigger on `auth.users` insert; the trigger function must be `SECURITY DEFINER` with a fixed `search_path`.
2. `public.corpses`: `id`, `user_id` (nullable, FK to `profiles`), `is_sample` (BOOLEAN NOT NULL DEFAULT false), `title`, `source_language`, `original_code`, `code_hash` (TEXT, indexed, SHA-256 cache key), `repo_url`, `status`, `created_at`.
   - `CHECK (is_sample = true OR user_id IS NOT NULL)`: only sample rows may have no owner.
   - `CHECK (source_language IN ('es3', 'es5-jquery', 'legacy-node'))`
   - `CHECK (status IN ('INFECTED', 'IN_SEANCE', 'RESURRECTED', 'FAILED'))`
3. `public.curses`: `id`, `corpse_id` (FK, ON DELETE CASCADE), `curse_type`, `severity`, `line_number`, `description`, `exorcism_strategy`.
   - `CHECK (severity IN ('HEX', 'BLOOD_CURSE', 'FATAL'))`
   - `CHECK (curse_type IN ('GLOBAL_POLLUTION', 'VAR_HOISTING', 'IMPLICIT_COERCION', 'CALLBACK_HELL', 'EVAL_INJECTION', 'PROTOTYPE_POLLUTION'))`
4. `public.seance_specs`: `id`, `corpse_id` (FK, ON DELETE CASCADE), `requirements_md`, `design_md`, `invariants_json`, `approved_at`.
5. `public.reincarnations`: `id`, `corpse_id` (FK, ON DELETE CASCADE), `target_stack`, `modern_code`, `pbt_test_code`, `pbt_passed` (BOOLEAN), `total_runs` (INT), `execution_time_ms` (INT), `created_at`.

Index every `corpse_id` foreign key and `corpses.user_id`.

## 2. Row Level Security (MANDATORY on every table)
Run `ENABLE ROW LEVEL SECURITY` on `profiles`, `corpses`, `curses`, `seance_specs`, and `reincarnations`. Write `auth.uid()` as `(select auth.uid())` in policies for query-plan caching.

- `profiles`: authenticated users `SELECT` and `UPDATE` only their own row (`id = (select auth.uid())`). Inserts happen only through the trigger.
- `corpses`:
  - Public read: `anon` and `authenticated` can `SELECT` rows where `is_sample = true`.
  - Owner access: authenticated users can `SELECT`, `INSERT`, `UPDATE`, `DELETE` rows where `user_id = (select auth.uid())`. `INSERT` / `UPDATE` must also require `is_sample = false` in `WITH CHECK`.
  - Anonymous users have NO write access. Do not treat `user_id IS NULL` as public.
- `curses`, `seance_specs`, `reincarnations` have no `user_id`; policies must go through the parent corpse:
  - Public read when `EXISTS (SELECT 1 FROM corpses c WHERE c.id = corpse_id AND c.is_sample = true)`.
  - Owner `SELECT` / `INSERT` / `UPDATE` / `DELETE` when `EXISTS (SELECT 1 FROM corpses c WHERE c.id = corpse_id AND c.user_id = (select auth.uid()))`.
- Sample rows are created by migrations (which run as the DB owner and bypass RLS). The service role key bypasses RLS and is used only in server-side Route Handlers.

## 3. Exorcism & PBT Verification Rules
- Strip mutable global state, `var` declarations, implicit coercions, `eval`, and deprecated APIs from resurrected code.
- Legacy JS snippets and resurrected TS modules must each expose a deterministic, pure entry function so `packages/pbt-verifier` can call `legacyFn(input)` and `modernFn(input)` side by side inside `fc.assert(fc.property(...))`.
- Report results as empirical evidence with the exact run count, e.g. "Verified behavioral equivalence across 1,000 generated inputs". Never claim "100%" or "mathematical proof".
- **Sample source format.** `original_code` is a classic script (not a module) that declares the entry function as a top-level `function` declaration and never references `module`, `exports`, `require`, `$`, `jQuery`, `window`, `document`, or `global`. `modern_code` is one self-contained TypeScript module that exports the entry function under the same name and contains no `import` declarations.
- **`pbt_test_code` contract (`Test_Code_Contract`).** The stored text is the body of a function with the parameters `fc`, `legacyFn`, `modernFn`, `assertEquivalent`, and `numRuns`. It contains no `import`, `export`, or `require`, and ends with `return fc.property(...)` (or `fc.asyncProperty(...)`). It never hardcodes a run count (the `numRuns` parameter is available if the body needs it). The runner (the `db/harness/` runner in the Foundation, `packages/pbt-verifier` later) evaluates the body, then calls `fc.check(property, { numRuns, seed })` itself. `assertEquivalent(input)` calls `legacyFn` and `modernFn` with independent deep copies of `input` and throws when the outcomes differ.
- **Outcome comparison.** Two returned values are equivalent when they are structurally deeply equal regardless of the realm that created them (`NaN` equals `NaN`, `+0` differs from `-0`). Two thrown values are equivalent when their `name` properties are equal. A returned value and a thrown value are never equivalent.
- Execution safety: `node:vm` is not a security boundary. Live execution runs only for sample corpses by default. Running user-imported legacy code requires an isolated Worker (or equivalent) with a timeout, no filesystem or network access, and a memory limit; design this in its own spec before enabling it.

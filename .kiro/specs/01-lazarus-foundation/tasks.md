# Implementation Plan

Work order follows dependencies. Requirement numbers refer to `requirements.md`.

- [x] 1. Monorepo scaffolding (R1 to R5)
  - [x] 1.1 Root files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`; confirm `.gitignore` rules
  - [x] 1.2 `pnpm install`; confirm TypeScript resolves to 6.x
  - [x] 1.3 `scripts/workspace-task.ts` and root `build`/`test`/`lint` scripts; verify they exit 0 with no packages
- [x] 2. Env template and Migration_Runner (R5 to R7)
  - [x] 2.1 Update `.env.example` (add `TEST_DATABASE_URL`, keep placeholders with `your-`)
  - [x] 2.2 `db/flyway.conf` and `scripts/db-migrate.ts`; `db:migrate` script with `dotenv-cli`
- [x] 3. Local test database (R16)
  - [x] 3.1 `db/local/docker-compose.yml`, `db/harness/supabase-stub.sql`, `scripts/test-db.ts`
- [x] 4. Schema migration V1 (R9 to R15)
  - [x] 4.1 Tables, constraints, indexes
  - [x] 4.2 Profile trigger function and trigger
  - [x] 4.3 Grants, RLS enablement, policies, `flyway_schema_history` revoke
  - [x] 4.4 Apply to the local database with Flyway and smoke check
- [x] 5. Harness runner (R20)
  - [x] 5.1 `db/harness/deep-equivalent.ts`, `pbt-runner.ts`, `typecheck.ts`
- [x] 6. Sample sources and seed generator (R17 to R20)
  - [x] 6.1 Three samples under `db/seed/` (legacy, modern, test code, spec text, invariants, curses, representative inputs)
  - [x] 6.2 `db/seed/generate-seed.ts`; generate `V2__seed_sample_corpses.sql`
  - [x] 6.3 Re-run Flyway on the local database; confirm 3 samples
- [x] 7. Verification_Suite (R16 and the requirement tests)
  - [x] 7.1 Support helpers (connection, roles, users, cleanup, Flyway invocation, scratch databases)
  - [x] 7.2 Static tests: R1 to R5, R7 config checks, R6 runner (fake Flyway)
  - [x] 7.3 Migration tests: R7.7 to R7.9, R8
  - [x] 7.4 Schema tests: R9 to R11
  - [x] 7.5 RLS tests: R12 to R15, R16.5, R16.6
  - [x] 7.6 Seed tests: R17 to R20
  - [x] 7.7 Skip and connection-failure behavior: R16.7, R16.9
- [x] 8. Final checkpoint
  - [x] 8.1 `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:db` all green; scope check against R21; coverage check of R1 to R21

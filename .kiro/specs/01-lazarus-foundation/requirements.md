# Requirements Document

## Introduction

This spec defines the foundation of Lazarus, the autonomous legacy JavaScript resurrection platform described in the steering documents. It covers two deliverables:

1. The **monorepo scaffolding**: root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, shared strict TypeScript configuration, ESLint, Vitest, and the `db:migrate` script.
2. The **database layer** in `db/`: Flyway configuration, `V1__create_lazarus_schema.sql` (tables, constraints, indexes, profile trigger, Row Level Security) and `V2__seed_sample_corpses.sql` (three executable legacy JavaScript sample corpses with curses, Séance specs, resurrected TypeScript, and fast-check property test code).

The steering documents `product.md`, `tech.md`, `structure.md`, `database-and-exorcism.md` and the file `.env.example` are the source of truth for stack, versions, schema, and RLS.

Out of scope (separate later specs): `packages/mcp-curse-scanner`, `packages/pbt-verifier`, and `apps/web`.

## Glossary

- **Foundation**: The set of deliverables defined by this spec: root monorepo configuration, `db/` directory contents, and the Verification_Suite.
- **Workspace_Root**: The repository root directory `lazarus/`.
- **Workspace_Package**: A directory matched by a glob in `pnpm-workspace.yaml` that contains its own `package.json`.
- **Build_Pipeline**: The Turborepo task graph defined in `turbo.json`.
- **Migration_Runner**: The `db:migrate` script in the root `package.json`, including any helper script it invokes before Flyway.
- **Flyway**: The Flyway CLI that applies versioned SQL migrations from `db/migrations/`.
- **Flyway_Config**: The file `db/flyway.conf`.
- **Env_Template**: The file `.env.example` at the Workspace_Root.
- **Direct_Connection**: A Supabase Postgres connection on port 5432 to the database host.
- **Session_Pooler**: A Supabase pooler connection on port 5432 that holds session-level state.
- **Transaction_Pooler**: A Supabase pooler connection on port 6543, which does not support session-level advisory locks.
- **Schema**: The set of tables, constraints, indexes, functions, triggers, and policies created by `V1__create_lazarus_schema.sql`.
- **Profiles_Table**: The table `public.profiles`.
- **Corpses_Table**: The table `public.corpses`.
- **Curses_Table**: The table `public.curses`.
- **Seance_Specs_Table**: The table `public.seance_specs`.
- **Reincarnations_Table**: The table `public.reincarnations`.
- **Child_Tables**: The set of Curses_Table, Seance_Specs_Table, and Reincarnations_Table.
- **Lazarus_Tables**: The set of Profiles_Table, Corpses_Table, and Child_Tables.
- **Profile_Trigger**: The trigger on `auth.users` and its function that insert a row into Profiles_Table.
- **RLS_Policies**: The Row Level Security policies defined on Lazarus_Tables.
- **Anon_Role**: The Postgres role `anon` used for unauthenticated requests.
- **Authenticated_Role**: The Postgres role `authenticated` used for signed-in requests, with `auth.uid()` identifying the user.
- **Owner**: The authenticated user whose `auth.uid()` equals `corpses.user_id` of the corpse in question.
- **Sample_Corpse**: A row in Corpses_Table with `is_sample = true`.
- **Curse_Type**: One of `GLOBAL_POLLUTION`, `VAR_HOISTING`, `IMPLICIT_COERCION`, `CALLBACK_HELL`, `EVAL_INJECTION`, `PROTOTYPE_POLLUTION`.
- **Entry_Function**: The single deterministic, pure, named top-level function of a Sample_Corpse that can be called as `fn(input)` and whose name is recorded in `invariants_json`.
- **Seed_Migration**: The file `db/migrations/V2__seed_sample_corpses.sql`.
- **Schema_Migration**: The file `db/migrations/V1__create_lazarus_schema.sql`.
- **Verification_Suite**: The Vitest tests delivered by the Foundation that verify the Schema, RLS_Policies, and Seed_Migration against a migrated Postgres database.
- **Empirical_Evidence**: A property-based testing result expressed as an exact number of generated inputs and a pass or fail outcome.
- **Test_Code_Contract**: The format of `reincarnations.pbt_test_code` and the outcome comparison rules defined in `.kiro/steering/database-and-exorcism.md`, section 3. The runner in `db/harness/` and, in a later spec, `packages/pbt-verifier` both implement it.

## Requirements

### Requirement 1: Monorepo workspace layout

**User Story:** As a developer, I want a pnpm and Turborepo monorepo at the repository root, so that later specs can add packages and the web app without reworking the tooling.

#### Acceptance Criteria

1. THE Foundation SHALL provide a `package.json` at the Workspace_Root that is valid JSON and has the field `private` set to the boolean `true`.
2. THE Foundation SHALL provide a `pnpm-workspace.yaml` at the Workspace_Root that lists the globs `apps/*` and `packages/*` and no other globs.
3. THE Foundation SHALL provide a `turbo.json` at the Workspace_Root that is valid JSON and defines the tasks `build`, `test`, and `lint`.
4. WHEN the root script `build`, `test`, or `lint` runs, THE Build_Pipeline SHALL run the script of the same name in every Workspace_Package that defines it, and SHALL NOT fail for a Workspace_Package that does not define it.
5. IF the script `build`, `test`, or `lint` of a Workspace_Package exits with a non-zero code, THEN THE Build_Pipeline SHALL exit with a non-zero code and SHALL print the name of the failing Workspace_Package.
6. WHILE no Workspace_Package exists, WHEN the root script `build`, `test`, or `lint` runs, THE Build_Pipeline SHALL run the Foundation's own checks defined in Requirement 3 and SHALL exit with code 0 if those checks pass.
7. WHILE no Workspace_Package exists, IF a Foundation check run by the root script `build`, `test`, or `lint` fails, THEN THE Build_Pipeline SHALL exit with a non-zero code.
8. THE Foundation SHALL provide a `.gitignore` at the Workspace_Root such that `git check-ignore` reports `.env`, `.env.local`, `node_modules/`, and `.turbo/` (the Turborepo cache output) as ignored.
9. THE Foundation SHALL provide a `.gitignore` at the Workspace_Root such that `git check-ignore` does not report `.kiro/` or `.env.example` as ignored.

### Requirement 2: Engine constraints

**User Story:** As a developer, I want Node and pnpm versions enforced, so that every contributor and CI run uses a supported runtime.

#### Acceptance Criteria

1. THE root `package.json` SHALL declare `engines.node` as `>=24`.
2. THE root `package.json` SHALL declare `engines.pnpm` as `>=9`.
3. THE Foundation SHALL provide an `.npmrc` at the Workspace_Root that contains the setting `engine-strict=true`.
4. IF `pnpm install` runs under a Node.js version lower than 24, THEN pnpm SHALL abort the installation before installing any dependency, exit with a non-zero exit code, and print an error message identifying the Node.js engine mismatch, the required range `>=24`, and the detected version.
5. IF `pnpm install` runs under a pnpm version lower than 9, THEN pnpm SHALL abort the installation before installing any dependency, exit with a non-zero exit code, and print an error message identifying the pnpm engine mismatch, the required range `>=9`, and the detected version.
6. THE Foundation SHALL NOT contain any runtime version specifier, in `package.json` or in any other configuration file at the Workspace_Root or in the CI configuration, that resolves to a Node.js 20.x release.

### Requirement 3: Root scripts

**User Story:** As a developer, I want standard root scripts, so that I can build, test, lint, and migrate with the same commands in every environment.

#### Acceptance Criteria

1. THE root `package.json` SHALL define the scripts `build`, `test`, `lint`, and `db:migrate`, each with a non-empty command string that runs when invoked as `pnpm <script name>` from the Workspace_Root.
2. WHEN `pnpm build` runs, THE Build_Pipeline SHALL execute the `build` script of every Workspace_Package that defines it and SHALL exit with code 0 if every executed `build` script exits with code 0.
3. WHEN `pnpm test` runs, THE Build_Pipeline SHALL execute Vitest for the Verification_Suite and the `test` script of every Workspace_Package that defines one.
4. WHEN `pnpm lint` runs, THE root `lint` script SHALL run both ESLint and `tsc --noEmit`, SHALL exit with a non-zero code if either reports one or more errors, and SHALL exit with code 0 if both report zero errors.
5. WHEN `pnpm test` runs, THE Foundation SHALL run Vitest in single-run mode (no watch mode), SHALL terminate the Vitest process after the last test completes, and SHALL exit with code 0 if all tests pass and a non-zero code if one or more tests fail.
6. IF the `build` or `test` script of any Workspace_Package exits with a non-zero code, THEN THE Build_Pipeline SHALL exit with a non-zero code and SHALL print the name of each failing Workspace_Package.
7. WHEN `pnpm db:migrate` runs, THE root `db:migrate` script SHALL invoke the Migration_Runner as specified in Requirement 6 and SHALL exit with the exit code of the Flyway process.

### Requirement 4: Shared strict TypeScript, ESLint, and Vitest configuration

**User Story:** As a developer, I want one strict TypeScript and lint baseline, so that all packages enforce zero `any` from the start.

#### Acceptance Criteria

1. THE Foundation SHALL provide a shared base TypeScript configuration at the Workspace_Root with `"strict": true`.
2. THE Foundation SHALL provide an ESLint configuration at the Workspace_Root that reports `@typescript-eslint/no-explicit-any` with severity `error`.
3. WHEN a TypeScript file (`.ts` or `.tsx`) in any Workspace_Package or in `apps/web` contains an explicit `any` type annotation, THE `pnpm lint` command SHALL report a `@typescript-eslint/no-explicit-any` violation for that file and exit with a non-zero code.
4. WHEN all TypeScript files in the lint scope contain zero explicit `any` annotations and zero type errors, THE `pnpm lint` command SHALL exit with code 0.
5. WHEN a Workspace_Package TypeScript configuration extends the shared base TypeScript configuration, THE Workspace_Package SHALL inherit `"strict": true` unless the package explicitly overrides it.
6. THE Foundation SHALL provide a Vitest configuration at the Workspace_Root that Workspace_Packages can extend.
7. THE Foundation SHALL write all comments, documentation, and configuration descriptions in English.
8. THE root `package.json` SHALL declare `typescript` as a devDependency with the range `^6`, so that the importable JavaScript compiler API stays available to later packages (`packages/pbt-verifier` uses `createProgram` and `transpileModule`). The Foundation SHALL NOT install `typescript` 7.x.

### Requirement 5: Environment template consistency

**User Story:** As a developer, I want `.env.example` to match what the scripts and configuration read, so that I can configure a new machine by copying one file.

#### Acceptance Criteria

1. THE Env_Template SHALL contain, for every environment variable name that the Migration_Runner, the Flyway_Config, and the Verification_Suite reference, at least one line of the form `NAME=<value>`, either active or commented out with a leading `#`.
2. THE Env_Template SHALL contain only placeholder values, where each value of a variable whose name contains `KEY`, `PASSWORD`, or `URL` contains the text `your-`, and SHALL NOT contain any value that is a real credential.
3. THE Env_Template SHALL document each of `FLYWAY_URL`, `FLYWAY_USER`, and `FLYWAY_PASSWORD` with an assignment line and at least one comment line that states the variable's purpose.
4. THE Env_Template SHALL document the Direct_Connection and the Session_Pooler as the two supported `FLYWAY_URL` forms, each with a comment line that names the form and an example `FLYWAY_URL` value that specifies port 5432.
5. THE Env_Template SHALL contain a comment that states the Transaction_Pooler on port 6543 is not supported for `FLYWAY_URL`.
6. IF the Verification_Suite reads a variable whose name is not present in the Env_Template, THEN THE Foundation SHALL add to the Env_Template an assignment line for that variable with a placeholder value and at least one comment line that states its purpose.
7. THE Env_Template SHALL name `SUPABASE_SERVICE_ROLE_KEY`, every `FLYWAY_*` variable, and `GROQ_API_KEY` exactly as written here, and SHALL NOT contain any variable name that consists of the prefix `NEXT_PUBLIC_` followed by any of those names.

### Requirement 6: Migration runner

**User Story:** As a developer, I want `pnpm db:migrate` to load my `.env` and run Flyway, so that I can migrate Supabase without exporting variables by hand.

#### Acceptance Criteria

1. WHEN `pnpm db:migrate` runs and the checks in criteria 3, 4, and 5 pass, THE Migration_Runner SHALL load the `.env` file from the Workspace_Root with `dotenv-cli` and then run `flyway -configFiles=db/flyway.conf migrate` exactly once.
2. THE root `package.json` SHALL list `dotenv-cli` as a devDependency.
3. IF `FLYWAY_URL`, `FLYWAY_USER`, or `FLYWAY_PASSWORD` is unset, is an empty string, or contains only whitespace after loading `.env`, THEN THE Migration_Runner SHALL exit with a non-zero code before invoking Flyway and print the name of each missing variable, one per variable, without printing any variable value.
4. IF the port in `FLYWAY_URL` is 6543, THEN THE Migration_Runner SHALL exit with a non-zero code before invoking Flyway and print a message that the Transaction_Pooler is not supported.
5. IF the Flyway CLI is not available on PATH, THEN THE Migration_Runner SHALL exit with a non-zero code before invoking Flyway and print a message that names Flyway as the missing prerequisite.
6. THE Migration_Runner SHALL NOT print the value of `FLYWAY_PASSWORD` to standard output or standard error, including when Flyway fails or any check in criteria 3, 4, or 5 fails.
7. WHEN the Flyway process exits, THE Migration_Runner SHALL exit with the same exit code as the Flyway process.

### Requirement 7: Flyway configuration

**User Story:** As a developer, I want a secret-free Flyway configuration, so that it is safe to commit.

#### Acceptance Criteria

1. THE Flyway_Config SHALL set `flyway.locations` to `db/migrations`.
2. THE Flyway_Config SHALL NOT contain any line, whether active or commented out, that defines `flyway.url`, `flyway.user`, or `flyway.password`.
3. THE Flyway_Config SHALL NOT contain any credential value, where a credential value is a database password, an access token, an API key, or a connection URL with a user name or password embedded in it.
4. THE Flyway_Config SHALL set `flyway.validateOnMigrate` to `true`.
5. THE Flyway_Config SHALL set `flyway.cleanDisabled` to `true`.
6. THE Flyway_Config SHALL NOT contain the port number 6543 in any connection string, host value, or comment.
7. WHEN Flyway runs with `FLYWAY_URL`, `FLYWAY_USER`, and `FLYWAY_PASSWORD` set to non-empty values in the environment, THE Flyway SHALL connect to the database using those three values.
8. IF Flyway runs with `FLYWAY_URL`, `FLYWAY_USER`, or `FLYWAY_PASSWORD` unset or empty, THEN THE Flyway SHALL exit with a non-zero exit code, print an error indicating that the connection settings are missing, and apply no migrations.
9. IF Flyway runs `migrate` and the checksum of an already-applied migration differs from the checksum of its file in `db/migrations`, THEN THE Flyway SHALL exit with a non-zero exit code, print a validation error, and apply no pending migrations.

### Requirement 8: Migration versioning, ordering, and idempotence

**User Story:** As a developer, I want deterministic migration ordering and safe re-runs, so that every environment reaches the same schema.

#### Acceptance Criteria

1. THE Foundation SHALL name every file in `db/migrations/` with the pattern `V<N>__<description>.sql`, where `<N>` is a positive integer without leading zeros and `<description>` is 1 to 100 characters from lowercase letters, digits, and underscores.
2. THE Foundation SHALL provide exactly two files in `db/migrations/`: `V1__create_lazarus_schema.sql` and `V2__seed_sample_corpses.sql`.
3. WHEN Flyway migrates an empty database, THE Flyway SHALL apply `V1__create_lazarus_schema.sql` before `V2__seed_sample_corpses.sql`, record both as successfully applied in version order (V1, then V2), and exit with code 0.
4. WHEN `pnpm db:migrate` runs against a database where V1 is applied and V2 is not, THE Flyway SHALL apply only `V2__seed_sample_corpses.sql` and leave every row in Lazarus_Tables that existed before the run unchanged.
5. WHEN `pnpm db:migrate` runs against a database where both migrations are already applied, THE Flyway SHALL apply zero migrations, exit with code 0, and leave every row in Lazarus_Tables unchanged.
6. WHEN `pnpm db:migrate` runs twice in a row against an empty database, THE database SHALL contain exactly 3 Sample_Corpse rows after the second run, and both runs SHALL exit with code 0.
7. IF a statement in a migration fails, THEN THE Flyway SHALL roll back all changes made by that migration, record no successful entry for it, keep every previously applied migration intact, exit with a non-zero code, and report an error that identifies the failing migration file.
8. IF the content of an applied migration file differs from its recorded checksum, THEN THE Flyway SHALL fail validation before applying any pending migration, apply zero migrations, leave the database unchanged, exit with a non-zero code, and report an error that identifies the changed file.

### Requirement 9: Table definitions

**User Story:** As a developer, I want the five core tables defined as specified in the steering document, so that later specs can rely on a stable schema.

#### Acceptance Criteria

1. THE Schema_Migration SHALL create Profiles_Table with columns `id`, `email`, `github_username`, `avatar_url`, and `created_at`, where `id` is a UUID primary key that references `auth.users(id)` with `ON DELETE CASCADE`, and `email`, `github_username`, and `avatar_url` are nullable.
2. THE Schema_Migration SHALL create Corpses_Table with columns `id`, `user_id`, `is_sample`, `title`, `source_language`, `original_code`, `code_hash`, `repo_url`, `status`, and `created_at`, where `user_id` is nullable and references `profiles(id)` in Profiles_Table with `ON DELETE CASCADE`, and `is_sample` is `BOOLEAN NOT NULL DEFAULT false`.
3. THE Schema_Migration SHALL create Curses_Table with columns `id`, `corpse_id`, `curse_type`, `severity`, `line_number`, `description`, and `exorcism_strategy`, where `corpse_id` is `NOT NULL` and references `corpses(id)` in Corpses_Table with `ON DELETE CASCADE`.
4. THE Schema_Migration SHALL create Seance_Specs_Table with columns `id`, `corpse_id`, `requirements_md`, `design_md`, `invariants_json`, and `approved_at`, where `corpse_id` is `NOT NULL` and references `corpses(id)` in Corpses_Table with `ON DELETE CASCADE`.
5. THE Schema_Migration SHALL create Reincarnations_Table with columns `id`, `corpse_id`, `target_stack`, `modern_code`, `pbt_test_code`, `pbt_passed`, `total_runs`, `execution_time_ms`, and `created_at`, where `corpse_id` is `NOT NULL` and references `corpses(id)` in Corpses_Table with `ON DELETE CASCADE`.
6. THE Schema_Migration SHALL define the primary key `id` of Corpses_Table, Curses_Table, Seance_Specs_Table, and Reincarnations_Table with type `uuid` and the default `gen_random_uuid()`, and SHALL define the `id` of Profiles_Table with type `uuid` and no default.
7. THE Schema_Migration SHALL define the columns `profiles.created_at`, `corpses.created_at`, `seance_specs.approved_at`, and `reincarnations.created_at` with type `timestamptz`, and SHALL NOT define any column of type `timestamp without time zone` in Lazarus_Tables.
8. THE Schema_Migration SHALL NOT create a table named `users` in the `public` schema.
9. THE Schema_Migration SHALL create Profiles_Table, Corpses_Table, Curses_Table, Seance_Specs_Table, and Reincarnations_Table in the `public` schema, so that `public.profiles`, `public.corpses`, `public.curses`, `public.seance_specs`, and `public.reincarnations` each exist after the migration is applied.
10. THE Schema_Migration SHALL define the following column types: `code_hash` as `TEXT`; `pbt_passed` as `BOOLEAN`; `total_runs`, `execution_time_ms`, and `line_number` as `INTEGER`; `invariants_json` as `jsonb`; and every other non-key, non-timestamp column listed in criteria 1 to 5 as `text`.
11. WHEN a row is deleted from `auth.users`, THE database SHALL delete the matching Profiles_Table row, every Corpses_Table row owned by that user, and every Child_Tables row attached to those corpses, and SHALL NOT delete Sample_Corpse rows or any data of other users.

### Requirement 10: Check constraints and indexes

**User Story:** As a developer, I want data integrity enforced by the database, so that invalid values cannot be stored regardless of the caller.

#### Acceptance Criteria

1. THE Schema_Migration SHALL define on Corpses_Table the constraint `CHECK (is_sample = true OR user_id IS NOT NULL)`.
2. THE Schema_Migration SHALL define on Corpses_Table the constraint `CHECK (source_language IN ('es3', 'es5-jquery', 'legacy-node'))`.
3. THE Schema_Migration SHALL define on Corpses_Table the constraint `CHECK (status IN ('INFECTED', 'IN_SEANCE', 'RESURRECTED', 'FAILED'))`.
4. THE Schema_Migration SHALL define on Curses_Table the constraint `CHECK (severity IN ('HEX', 'BLOOD_CURSE', 'FATAL'))`.
5. THE Schema_Migration SHALL define on Curses_Table the constraint `CHECK (curse_type IN ('GLOBAL_POLLUTION', 'VAR_HOISTING', 'IMPLICIT_COERCION', 'CALLBACK_HELL', 'EVAL_INJECTION', 'PROTOTYPE_POLLUTION'))`.
6. THE Schema_Migration SHALL create an index on `corpses.user_id`.
7. THE Schema_Migration SHALL create an index on `corpses.code_hash`.
8. THE Schema_Migration SHALL create an index on the `corpse_id` column of each table in Child_Tables.
9. IF an insert or update into Corpses_Table sets `is_sample` to `false` and `user_id` to `NULL`, THEN THE database SHALL reject the statement with a check constraint violation and SHALL leave all existing rows unchanged and insert no new row.
10. IF an insert or update sets `source_language`, `status`, `severity`, or `curse_type` to a value that is not an exact, case-sensitive match to an entry in the allowed list of its CHECK constraint in this requirement, THEN THE database SHALL reject the statement with a check constraint violation and SHALL leave all existing rows unchanged and insert no new row.
11. IF an insert or update sets `is_sample`, `source_language`, `status`, `severity`, or `curse_type` to `NULL`, THEN THE database SHALL reject the statement with a not-null or check constraint violation and SHALL leave all existing rows unchanged and insert no new row.

### Requirement 11: Profile provisioning trigger

**User Story:** As an authenticated user, I want a profile row created when I sign up, so that I can own corpses without extra setup.

#### Acceptance Criteria

1. WHEN a row is inserted into `auth.users`, THE Profile_Trigger SHALL, within the same transaction as that insert, insert exactly one row into Profiles_Table with `id` equal to the new user's `id`.
2. WHEN a row is inserted into `auth.users`, THE Profile_Trigger SHALL copy the `email` column into Profiles_Table `email`, the `user_name` value of `raw_user_meta_data` into `github_username`, and the `avatar_url` value of `raw_user_meta_data` into `avatar_url`.
3. IF the `email` column, the `user_name` value, or the `avatar_url` value of the new `auth.users` row is NULL or absent, THEN THE Profile_Trigger SHALL still insert the Profiles_Table row and SHALL store NULL in the corresponding column.
4. THE Profile_Trigger function SHALL be declared `SECURITY DEFINER` with a `search_path` fixed in the function definition, so that name resolution does not depend on the caller's session `search_path`.
5. IF a Profiles_Table row with the same `id` already exists, THEN THE Profile_Trigger SHALL leave the existing row unchanged, SHALL NOT raise an error, and SHALL allow the `auth.users` insert to complete.
6. THE Schema_Migration SHALL revoke `EXECUTE` on the Profile_Trigger function from `PUBLIC`, Anon_Role, and Authenticated_Role, so that none of these roles can call the function directly.

### Requirement 12: Row Level Security enablement and anonymous write denial

**User Story:** As a security-conscious maintainer, I want RLS on every table and no anonymous writes, so that the anon key cannot modify data.

#### Acceptance Criteria

1. THE Schema_Migration SHALL run `ENABLE ROW LEVEL SECURITY` on each table in Lazarus_Tables, so that after the migration completes every table in Lazarus_Tables reports row level security as enabled.
2. THE RLS_Policies SHALL write every use of the current user id, in every `USING` and `WITH CHECK` expression, as `(select auth.uid())`, and SHALL NOT contain any bare `auth.uid()` call outside a `select` subquery.
3. THE Schema_Migration SHALL NOT define any policy on any table in Lazarus_Tables that applies to Anon_Role, either by naming Anon_Role or by omitting a role list so that it applies to all roles, for the commands `INSERT`, `UPDATE`, `DELETE`, or `ALL`.
4. THE Schema_Migration SHALL NOT grant `INSERT`, `UPDATE`, or `DELETE` privileges on any table in Lazarus_Tables to Anon_Role, whether directly or through the `PUBLIC` pseudo-role.
5. IF Anon_Role issues an `INSERT`, `UPDATE`, or `DELETE` against any table in Lazarus_Tables, THEN THE database SHALL reject the statement with a permission denied error (SQLSTATE 42501) and SHALL leave the row count and the column values of every row in every table in Lazarus_Tables unchanged.
6. THE RLS_Policies SHALL NOT include `user_id IS NULL` in any `USING` or `WITH CHECK` expression, so that rows whose `user_id` is NULL are not readable or writable by Anon_Role or by any authenticated user through that condition.
7. THE Schema_Migration SHALL revoke all privileges on `public.flyway_schema_history` from `PUBLIC`, Anon_Role, and Authenticated_Role, so that Flyway's migration history is not readable through the Supabase Data API.

### Requirement 13: Corpses_Table policies

**User Story:** As a visitor or signed-in user, I want to read sample corpses and manage only my own corpses, so that the sandbox is public and my history is private.

#### Acceptance Criteria

1. THE RLS_Policies SHALL allow Anon_Role and Authenticated_Role to `SELECT` rows of Corpses_Table where `is_sample = true`.
2. THE RLS_Policies SHALL allow Authenticated_Role to `SELECT`, `INSERT`, `UPDATE`, and `DELETE` rows of Corpses_Table where `user_id = (select auth.uid())`.
3. THE RLS_Policies SHALL require `is_sample = false` and `user_id = (select auth.uid())` in the `WITH CHECK` clause of every `INSERT` and `UPDATE` policy on Corpses_Table.
4. WHILE Anon_Role is active, THE RLS_Policies SHALL return zero rows of Corpses_Table where `is_sample = false`.
5. WHILE Authenticated_Role is active, THE RLS_Policies SHALL return zero rows of Corpses_Table where `is_sample = false` and `user_id` differs from `(select auth.uid())`.
6. IF an Authenticated_Role user inserts a Corpses_Table row with `is_sample = true` or with `user_id` differing from `(select auth.uid())`, THEN THE RLS_Policies SHALL reject the statement with a row-level security violation error and insert zero rows.
7. IF an Authenticated_Role user updates a Sample_Corpse or a corpse owned by another user, THEN THE RLS_Policies SHALL affect zero rows, raise no error, and leave the targeted rows unchanged.
8. IF an Authenticated_Role user deletes a Sample_Corpse or a corpse owned by another user, THEN THE RLS_Policies SHALL affect zero rows, raise no error, and leave the targeted rows in Corpses_Table.
9. IF an Authenticated_Role user updates an owned corpse so that `user_id` becomes another user's id or `is_sample` becomes `true`, THEN THE RLS_Policies SHALL reject the statement with a row-level security violation error and leave the corpse's `user_id` and `is_sample` values unchanged.
10. IF Anon_Role inserts a row into Corpses_Table, THEN THE database SHALL reject the statement with a permission denied error (SQLSTATE 42501) and insert zero rows.
11. IF Anon_Role updates or deletes rows of Corpses_Table, THEN THE database SHALL reject the statement with a permission denied error (SQLSTATE 42501) and leave all rows unchanged.

### Requirement 14: Child table policies

**User Story:** As a signed-in user, I want rows attached to my corpses protected like the corpses themselves, so that no other user can read or change my Séance and Reincarnation data.

#### Acceptance Criteria

1. IF an `EXISTS` subquery finds a parent corpse with `c.id = corpse_id` and `c.is_sample = true`, THEN THE RLS_Policies SHALL allow Anon_Role and Authenticated_Role to `SELECT` the matching rows of each table in Child_Tables.
2. IF an `EXISTS` subquery finds a parent corpse with `c.id = corpse_id` and `c.user_id = (select auth.uid())`, THEN THE RLS_Policies SHALL allow Authenticated_Role to `SELECT`, `INSERT`, `UPDATE`, and `DELETE` the matching rows of each table in Child_Tables.
3. THE RLS_Policies SHALL repeat the owner `EXISTS` condition from criterion 2 in the `WITH CHECK` clause of every `INSERT` and `UPDATE` policy on Child_Tables, and in the `USING` clause of every `UPDATE` and `DELETE` policy on Child_Tables.
4. WHILE Anon_Role is active, THE RLS_Policies SHALL return zero rows from a `SELECT` on Child_Tables for rows whose parent corpse has `is_sample = false`, without raising an error.
5. WHILE Authenticated_Role is active, THE RLS_Policies SHALL return zero rows from a `SELECT` on Child_Tables for rows whose parent corpse has `is_sample = false` and a `user_id` different from `(select auth.uid())`, without raising an error.
6. IF an Authenticated_Role user inserts a Child_Tables row whose `corpse_id` references a Sample_Corpse, a corpse owned by another user, or a non-existent corpse, THEN THE RLS_Policies SHALL reject the statement with an error and leave the table unchanged.
7. IF an Authenticated_Role user updates or deletes a Child_Tables row whose parent corpse is a Sample_Corpse or is owned by another user, THEN THE RLS_Policies SHALL affect zero rows, raise no error, and leave the row's stored values unchanged.
8. IF an Authenticated_Role user updates an owned Child_Tables row so that `corpse_id` references a Sample_Corpse, a corpse owned by another user, or a non-existent corpse, THEN THE RLS_Policies SHALL reject the statement with an error and leave the row's original `corpse_id` unchanged.
9. IF Anon_Role issues an `INSERT` on any table in Child_Tables, THEN THE database SHALL reject the statement with a permission denied error (SQLSTATE 42501) and leave the table unchanged.
10. IF Anon_Role issues an `UPDATE` or `DELETE` on any table in Child_Tables, THEN THE database SHALL reject the statement with a permission denied error (SQLSTATE 42501) and leave the stored rows unchanged.

### Requirement 15: Profiles_Table policies

**User Story:** As a signed-in user, I want to read and update only my own profile, so that my account data stays private.

#### Acceptance Criteria

1. THE RLS_Policies SHALL allow Authenticated_Role to `SELECT` and `UPDATE` rows of Profiles_Table only where `id = (select auth.uid())`, enforced through the `USING` clause of each policy.
2. THE RLS_Policies SHALL include `id = (select auth.uid())` in the `WITH CHECK` clause of the `UPDATE` policy on Profiles_Table.
3. THE Schema_Migration SHALL allow Profiles_Table rows to be created only by the Profile_Trigger, by defining no `INSERT` or `DELETE` policy on Profiles_Table for Anon_Role or Authenticated_Role and by granting no `INSERT` or `DELETE` privilege on Profiles_Table to Anon_Role, Authenticated_Role, or the `PUBLIC` pseudo-role (revoking any such privilege granted by default).
4. WHILE Anon_Role is active, THE RLS_Policies SHALL return zero rows, without raising an error, for any `SELECT` on Profiles_Table.
5. WHILE Authenticated_Role is active, THE RLS_Policies SHALL return zero rows of Profiles_Table whose `id` differs from `(select auth.uid())`, and SHALL return exactly one row where `id = (select auth.uid())` and that row exists.
6. IF an Authenticated_Role user updates a Profiles_Table row whose `id` differs from `(select auth.uid())`, THEN THE RLS_Policies SHALL affect zero rows, raise no error, and leave that row's column values unchanged.
7. IF an Authenticated_Role user updates the own profile `id` to a different value, THEN THE RLS_Policies SHALL reject the statement with an error indicating a row-level security violation and SHALL leave the row's original `id` and all other column values unchanged.
8. IF Authenticated_Role attempts an `INSERT` or `DELETE` on Profiles_Table, THEN THE RLS_Policies SHALL leave the row count and all existing row values of Profiles_Table unchanged.
9. IF Anon_Role attempts an `INSERT`, `UPDATE`, or `DELETE` on Profiles_Table, THEN THE database SHALL reject the statement with a permission denied error (SQLSTATE 42501) and leave the row count and all column values of Profiles_Table unchanged.

### Requirement 16: Verification suite for the database layer

**User Story:** As a maintainer, I want automated tests for the schema, RLS, and seed data, so that security properties are verified and not only reviewed by reading SQL.

#### Acceptance Criteria

1. WHEN `pnpm test` runs from Workspace_Root, THE Foundation SHALL execute the Verification_Suite with Vitest and SHALL exit with a non-zero exit code if at least one non-skipped test fails.
2. WHEN the Verification_Suite runs against a database migrated by Flyway, THE Verification_Suite SHALL contain at least one test for each acceptance criterion of Requirements 8 to 15 that describes observable database behavior, where observable means the outcome is determined by a statement result, an affected-row count, a returned row set, or a catalog query, and each such test name SHALL include the requirement number and the criterion number it verifies.
3. THE Verification_Suite SHALL test RLS behavior by executing statements under Anon_Role and under Authenticated_Role with at least two distinct simulated users, each with a distinct `auth.uid()` that equals the `id` of a user row the Verification_Suite created.
4. WHEN a Verification_Suite run ends, whether every test passed or at least one test failed, THE Verification_Suite SHALL delete every row it created in Lazarus_Tables and in the user table it created for the simulated users, so that zero rows with identifiers recorded at creation remain and every Sample_Corpse row is unchanged from its state before the run.
5. FOR ALL tables in Lazarus_Tables, THE Verification_Suite SHALL execute at least one `INSERT`, one `UPDATE`, and one `DELETE` statement under Anon_Role and SHALL verify that each statement is rejected with a permission denied error (SQLSTATE 42501), and that the Sample_Corpse rows, the Child_Tables rows attached to them, and the rows created by the Verification_Suite are identical before and after the statement.
6. FOR ALL ordered pairs of distinct simulated users A and B, where B owns at least one corpse with at least one row in each table of Child_Tables, THE Verification_Suite SHALL verify under Authenticated_Role as user A that `SELECT` on the corpses of B and on their Child_Tables rows returns zero rows, that `UPDATE` and `DELETE` on them affect zero rows, that an `INSERT` into any table of Child_Tables with a `corpse_id` of a corpse of B is rejected, and that those rows of B are identical before and after the statements.
7. IF any database connection variable that the Verification_Suite reads is unset or empty, THEN THE Verification_Suite SHALL report every database test as skipped with a message that names each missing variable, SHALL NOT report any of them as passed, and SHALL NOT report them as failed.
8. THE Verification_Suite SHALL NOT modify or delete any row it did not create, and SHALL NOT read any row other than the rows it created and the rows of Sample_Corpse data and their Child_Tables rows.
9. IF all database connection variables are set and the Verification_Suite cannot establish a database connection within 10 seconds, THEN THE Verification_Suite SHALL report the database tests as failed with a message indicating that the connection failed, and SHALL NOT report them as skipped.

### Requirement 17: Sample corpse seed data

**User Story:** As a judge or anonymous visitor, I want three pre-loaded legacy JavaScript samples, so that I can explore Lazarus without signing in.

#### Acceptance Criteria

1. WHEN the Seed_Migration runs, THE Seed_Migration SHALL insert exactly 3 rows into Corpses_Table, each with `is_sample = true` and `user_id` set to `NULL`.
2. THE Seed_Migration SHALL assign the three Sample_Corpse rows the `source_language` values `es3`, `es5-jquery`, and `legacy-node`, one value per row.
3. THE Seed_Migration SHALL set `status` to `RESURRECTED` for each of the 3 Sample_Corpse rows.
4. THE Seed_Migration SHALL set `code_hash` of each Sample_Corpse to the 64-character lowercase hexadecimal SHA-256 digest of its `original_code` encoded as UTF-8.
5. THE Seed_Migration SHALL give each Sample_Corpse a `title` of 1 to 200 characters that contains at least one non-whitespace character and differs from the `title` of the other two Sample_Corpse rows (case-sensitive comparison).
6. THE `original_code` of each Sample_Corpse SHALL parse without syntax errors as a classic script under the grammar of its `source_language` (ES3 for `es3`, ES5 for `es5-jquery` and `legacy-node`), SHALL define exactly one Entry_Function as a top-level `function` declaration, and SHALL NOT reference `module`, `exports`, or `require`.
7. THE Entry_Function of each Sample_Corpse SHALL be deterministic and pure: the Entry_Function SHALL NOT read or write global state, the DOM, the network, the file system, timers, `Date`, or `Math.random`, and SHALL return deeply equal values when called twice with the same input.
8. THE `original_code` of each Sample_Corpse SHALL execute to completion in a JavaScript runtime in which `$`, `jQuery`, `window`, `document`, and `global` are undefined, without raising a ReferenceError. The `es5-jquery` sample uses jQuery-era idioms (for example `var` self-references, prototype methods, and callback style) without calling the jQuery library.
9. THE `original_code` of each Sample_Corpse SHALL NOT contain ES2015 or later syntax (including `let`, `const`, arrow functions, template literals, classes, default parameters, destructuring, spread, `for...of`, and modules), and WHERE `source_language` is `es3`, THE `original_code` SHALL NOT use ES5 additions (including `Array.prototype.forEach`, `Array.prototype.map`, `Object.keys`, `JSON`, and `Function.prototype.bind`).
10. WHEN the Verification_Suite evaluates the `original_code` of a Sample_Corpse in-process, THE Entry_Function SHALL return a value other than `undefined` within 1000 milliseconds, without throwing, for each of at least 10 distinct representative inputs that include at least one empty or boundary input.
11. IF any insert performed by the Seed_Migration fails, THEN THE Seed_Migration SHALL roll back all of its inserts, leave Corpses_Table with zero rows added by the Seed_Migration, and report a failure to the migration runner.
12. THE Seed_Migration SHALL NOT contain conditional logic that tests whether Sample_Corpse rows already exist, because repeat-run safety comes from Flyway applying each versioned migration once per database (Requirement 8 criterion 6).

### Requirement 18: Sample curse seed data

**User Story:** As a judge, I want each sample to carry realistic curses with exact line numbers, so that the Hex Scanner results can be shown without scanning live.

#### Acceptance Criteria

1. THE Seed_Migration SHALL insert between 2 and 10 Curses_Table rows for each Sample_Corpse.
2. THE Seed_Migration SHALL use only values from the Curse_Type list for `curse_type` and only the values `HEX`, `BLOOD_CURSE`, and `FATAL` for `severity`.
3. THE Seed_Migration SHALL set `line_number` of each curse to an integer between 1 and N, where N is the number of lines in the `original_code` of the parent corpse, lines are separated by the newline character `\n`, and the first line is line 1.
4. WHEN the Verification_Suite reads the line at `line_number` in the `original_code` of the parent corpse, THE Seed_Migration SHALL have stored a `line_number` whose line contains at least one construct from the following list for the `curse_type` of that curse: `GLOBAL_POLLUTION` is an assignment to an identifier that has no declaration, or to a property of `window` or `global`; `VAR_HOISTING` is a `var` declaration; `IMPLICIT_COERCION` is the operator `==` or `!=`; `CALLBACK_HELL` is a callback function expression nested inside at least 2 other callback function expressions; `EVAL_INJECTION` is a call to `eval` or a `new Function` expression; `PROTOTYPE_POLLUTION` is an assignment to `__proto__`, or an assignment to an object property whose key comes from a variable.
5. THE Seed_Migration SHALL include each of the 6 Curse_Type values in at least one curse across the three Sample_Corpse rows.
6. THE Seed_Migration SHALL provide for each curse a `description` and an `exorcism_strategy`, each with a length of 10 to 500 characters after trimming leading and trailing whitespace.

### Requirement 19: Sample Séance spec seed data

**User Story:** As a judge, I want each sample to include extracted EARS requirements and invariants, so that the Séance Chamber output can be shown without calling an LLM.

#### Acceptance Criteria

1. WHEN the Seed_Migration runs, THE Seed_Migration SHALL insert exactly 3 Seance_Specs_Table rows in total, with exactly 1 row per Sample_Corpse, and SHALL set the `corpse_id` of each row to the `id` of its Sample_Corpse.
2. THE `requirements_md` of each Séance spec SHALL be English text of 200 to 5,000 characters that contains 3 to 10 numbered acceptance criteria in EARS notation, where each criterion starts with one of `THE`, `WHEN`, `WHILE`, `IF`, or `WHERE` (uppercase) and contains the uppercase word `SHALL`.
3. THE `design_md` of each Séance spec SHALL be English text of 100 to 3,000 characters that names the Entry_Function and states the type and meaning of its input and of its output.
4. THE `invariants_json` of each Séance spec SHALL be valid JSON whose top level is an object containing the keys `entry_function`, `input`, `output`, and `invariants`, where `entry_function` is a non-empty string, `input` and `output` are non-empty strings that describe the Entry_Function's input and output, and `invariants` is an array of 3 to 10 strings, each 1 to 300 characters long.
5. THE `entry_function` value in `invariants_json` SHALL equal, in a case-sensitive exact match, the name of the Entry_Function defined in the `original_code` of the parent Sample_Corpse.
6. THE Seed_Migration SHALL set `approved_at` of each Séance spec of a Sample_Corpse to a non-null timestamp that is not later than the time at which the Seed_Migration completes.

### Requirement 20: Sample reincarnation seed data

**User Story:** As a judge, I want each sample to include resurrected TypeScript and its property-based test, so that equivalence evidence can be shown without live execution.

#### Acceptance Criteria

1. THE Seed_Migration SHALL insert exactly 1 Reincarnations_Table row for each Sample_Corpse, with the row's `corpse_id` referencing that Sample_Corpse.
2. THE `target_stack` of each Reincarnations_Table row SHALL be a string of 1 to 100 characters that contains the case-insensitive substring "TypeScript".
3. THE `modern_code` of each Reincarnations_Table row SHALL compile under TypeScript `strict` mode with 0 compiler errors and SHALL export a function whose name is identical (case-sensitive) to the Entry_Function name of the parent Sample_Corpse. THE `modern_code` SHALL be one self-contained module with no `import` declaration.
4. THE `modern_code` of each Reincarnations_Table row SHALL NOT contain the `var` keyword, the `any` type, a call to `eval`, or any module-level binding declared with `let` that is reassigned after module initialization.
5. THE `pbt_test_code` of each Reincarnations_Table row SHALL follow the Test_Code_Contract: it SHALL return a fast-check property that, for each generated input, calls the legacy Entry_Function and the modern function with that same input through `assertEquivalent`, so that the outputs are asserted to be deeply equal.
6. THE `total_runs` of each Reincarnations_Table row SHALL be an integer from 100 to 1000 inclusive. THE `pbt_test_code` SHALL NOT hardcode a run count, because the runner controls it through `fc.check`, and `total_runs` SHALL equal the `numRuns` value that the runner passed to `fc.check` when it recorded `pbt_passed`.
7. THE `pbt_passed` and `execution_time_ms` values of each Reincarnations_Table row SHALL be recorded from one actual execution of `pbt_test_code`, by the runner in `db/harness/`, against the `original_code` of the parent Sample_Corpse and the row's `modern_code`, and `execution_time_ms` SHALL be an integer from 1 to 600000.
8. WHEN the Verification_Suite executes the `pbt_test_code` of a Sample_Corpse through the runner in `db/harness/` with its stored `total_runs` as `numRuns`, THE Verification_Suite SHALL report a pass for each row that has `pbt_passed = true`.
9. IF a row has `pbt_passed = false`, THEN THE Seed_Migration SHALL NOT insert that row and SHALL abort with an error identifying the Sample_Corpse, leaving no Reincarnations_Table rows inserted by the migration.
10. THE Seed_Migration SHALL NOT include the strings `100%`, `mathematical proof`, `mathematically proven`, or `guaranteed` (compared case-insensitively) in any text column of the seeded rows.
11. WHERE a seeded text column describes a property-based test outcome, THE text SHALL state the outcome as Empirical_Evidence and SHALL include the exact number of generated inputs, equal to the row's `total_runs`.
12. THE Seed_Migration SHALL set `pbt_passed` to `true` for each of the 3 Reincarnations_Table rows.

### Requirement 21: Scope boundary and documentation language

**User Story:** As a reviewer, I want this spec to stay small, so that the review covers only the foundation.

#### Acceptance Criteria

1. THE Foundation SHALL limit its deliverables to the following: the root monorepo configuration files (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.gitignore`, `tsconfig.base.json` and other `tsconfig*.json` files at the Workspace_Root, `eslint.config.mjs`, and the Vitest configuration files at the Workspace_Root), the `scripts/` directory (Migration_Runner and test database setup), the `db/` directory (`db/migrations/`, `db/flyway.conf`, `db/local/`, `db/seed/`, `db/harness/`, and `db/tests/`), the Verification_Suite, and updates to the Env_Template. Any file created or modified by the Foundation that is not in this list is out of scope.
2. THE Foundation SHALL NOT create, modify, or delete any file under `packages/mcp-curse-scanner`, `packages/pbt-verifier`, or `apps/web`.
3. THE Foundation SHALL write all SQL comments, seed text, test descriptions, and documentation in English, with zero natural-language sentences or comments in any other language. Code identifiers and proper nouns are excluded from this rule.

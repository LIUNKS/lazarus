# How Lazarus uses Kiro

This document lists every Kiro artifact in the repository, what it does, and how to check it. Counts are a snapshot from 2026-11-08; run `node scripts/hooks/spec-status.mjs` for the current spec progress.

## Overview

| Kiro feature | Where | What it does for Lazarus |
|---|---|---|
| Specs | `.kiro/specs/01` to `08` | Each feature is written as requirements, design, and tasks before code. |
| Steering | `.kiro/steering/` (8 files) | Project rules the agent loads always, by file pattern, or on request. |
| Hooks | `.kiro/hooks/` (5 files) and `scripts/hooks/` | Guard rails and automatic checks around the agent's work. |
| MCP | `.kiro/settings/mcp.json` | Exposes the Hex Scanner to the agent as two tools. |
| Skills | `.kiro/skills/` (3 skills) | Step-by-step procedures for recurring, error-prone work. |

## Specs

| Spec | Subject | Status (snapshot) |
|---|---|---|
| `01-lazarus-foundation` | Monorepo, database schema, RLS, seed data | Complete |
| `02-scanner-and-verifier` | `packages/mcp-curse-scanner`: AST scanner and MCP server | Complete (3 optional tasks left) |
| `03-pbt-verifier` | Equivalence runner with `fast-check` | Not started |
| `04-web-shell-auth` | Next.js shell, GitHub sign-in, Morgue, Crypt, import | Complete |
| `05-llm-pipeline-api` | Séance and Reincarnation Route Handlers, cache, rate limit | Not started |
| `06-resurrection-ui` | The stages in the web UI | Not started |
| `07-sandboxed-execution` | Worker sandbox for running imported legacy code | Not started |
| `08-live-verification-api` | Live verification endpoint | Not started |

How the specs are written (checkable in any `tasks.md`):
- Every task cites the requirement criteria it implements (`_Requirements: ..._`).
- Correctness properties in `design.md` are numbered. Property tests carry `// Feature: <spec>, Property <N>: <title>` and the scanner has a test that enforces this format (`test/unit/test-conventions.test.ts`).
- Specs state preconditions and scope, so a spec cannot quietly edit another spec's files.

### Implementation order

The source of truth is the **Preconditions** section at the top of each `tasks.md`; this table is a reading of them. Check the spec itself before you start.

| Spec | Needs (from its Preconditions) | Notes |
|---|---|---|
| `03-pbt-verifier` | 01 | Work stays inside `packages/pbt-verifier/`. |
| `07-sandboxed-execution` | 01, 03 | If `packages/pbt-verifier` is missing, the plan says to stop and ask. It also adds one subpath export to `pbt-verifier`. |
| `05-llm-pipeline-api` | 01, 04 | Adds migration `V3` and depends on the scanner package. It does not use `pbt-verifier`. Its database tests need `TEST_DATABASE_URL`. |
| `06-resurrection-ui` | 01, 04 | Built against a contract, with a fake `fetch`, so it can start before 05 and 08 exist. The "Verify live" control answers `VERIFICATION_DISABLED` while live verification is off, which is the default. |
| `08-live-verification-api` | 01, 03, 04, 05, 07 | Last of the chain. Adds a quota migration and the `POST /api/verify` route. Needs `TEST_DATABASE_URL` and the Flyway CLI for the database tests. |

Order used in this project: **03, 07, 05, 08**, with **06** in any slot after 04. A shorter path to a working demo is 05 and 06, because the sample corpses already carry stored results; the chain 03, 07, 08 adds live verification, which is switched off by default.

Rules that apply to every spec in this list are in `.kiro/steering/spec-execution.md`, and the `spec-status-on-start` hook prints the current progress at the start of each session.

## Steering

| File | Inclusion | Subject |
|---|---|---|
| `product.md` | always | Product definition, the four stages, scope limits |
| `tech.md` | always | Runtime, libraries, LLM usage limits, secrets |
| `structure.md` | always | Repository layout and rules |
| `database-and-exorcism.md` | fileMatch (`db/**`, `packages/**`, `apps/web/src/lib/**`, `apps/web/src/app/api/**`) | Schema, RLS, `Test_Code_Contract`, equivalence rules |
| `ui-components.md` | fileMatch (`apps/web/src/**/*.tsx`, animations) | Theme tokens, GSAP with reduced motion, UI wording |
| `testing-conventions.md` | fileMatch (test files, `db/tests/**`) | Vitest and `fast-check` conventions |
| `spec-execution.md` | fileMatch (`.kiro/specs/**`) | How to run a spec task and when it counts as done |
| `writing-and-claims.md` | manual (`#writing-and-claims`) | Allowed and banned claims, glossary |

## Hooks

| Hook | Trigger | Effect |
|---|---|---|
| `guard-sensitive-writes` | PreToolUse on `fs_write`, `str_replace`, `fs_append` | Blocks edits to an existing Flyway migration and server secrets in client code. Asks before touching `.env*`, `pnpm-lock.yaml`, or user-facing files that contain a banned claim. |
| `scanner-tests-on-save` | PostFileSave in `packages/mcp-curse-scanner` | Runs the scanner test suite. |
| `verify-after-task` | PostTaskExec | Runs `pnpm lint` and the tests of changed packages under `packages/`. |
| `spec-status-on-start` | SessionStart | Prints the task progress of every spec into the session. |
| `migration-checklist` | PostFileCreate on `db/migrations/V*.sql` | Reminds the agent of the RLS, index, and immutability rules. |

The commands live in `scripts/hooks/*.mjs` so they can be read and run by hand.

## MCP: `lazarus-curse-scanner`

- Registered in `.kiro/settings/mcp.json`; the server is `packages/mcp-curse-scanner/dist/index.js`.
- Tools: `scan_ast_curses` and `extract_function_signatures`, both in `autoApprove` because they are read-only and deterministic.
- The same analyzer is also a library (`scanCurses`, `extractFunctionSignatures`). Spec `05-llm-pipeline-api` plans to use it from the web app, so the agent and the product would report the same findings. That dependency is not in `apps/web` yet.

## Skills

| Skill | Use |
|---|---|
| `resurrect-corpse` | Run the four-stage workflow on one legacy function. |
| `add-curse-type` | Add a detection to the scanner, tests, database constraint, and docs together. |
| `add-flyway-migration` | Write a migration with RLS, indexes, and safe naming. |

## How each piece was checked

These checks were run on 2026-11-08. They do not replace trying the hooks inside a live Kiro session.

| Artifact | Check | Result |
|---|---|---|
| MCP server | A client from `@modelcontextprotocol/sdk` connected over stdio, listed the tools, and called `scan_ast_curses` on a small source | Two tools listed; the call returned findings |
| `guard-write.mjs` | Run with sample payloads for each rule (existing and new migration, `.env`, `.env.example`, lockfile, `NEXT_PUBLIC_` secret, secret in client and in server code, banned claim in UI, docs, and a test file, invalid JSON) | Each case produced the intended block, question, or pass |
| `spec-status.mjs` | Run against the real specs | One line per spec with counts and the next open task |
| `verify-task.mjs` | Run against the working tree | `pnpm lint` passed; the scanner package tests passed |
| Scanner suite | `pnpm --filter @lazarus/mcp-curse-scanner test` | 50 test files, 711 tests passed |

Open item: `pnpm test` at the root fails in `apps/web/test/build-output.test.ts` on the OneDrive working copy, where Turbopack could not write its cache. The other 173 web tests pass. See `spec-execution.md`.

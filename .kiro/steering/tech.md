---
inclusion: always
---
# Technology Stack, Tooling & Runtime Standards

## Runtime & Monorepo
- **Node.js:** `>=24` (Active LTS). Node 20 reached end of life on 2026-04-30; do not target it. Set `engines.node` in the root `package.json` accordingly.
- **Package manager / monorepo:** `pnpm` (`>=9`) with `pnpm-workspace.yaml` and **Turborepo** (`turbo.json`).
- **Prerequisites to install locally:** `pnpm` and the Flyway CLI (neither ships with the repo).
- **Language:** Strict TypeScript (`"strict": true`, zero `any`). All UI text and code comments in **English**.
- **TypeScript version:** use `typescript@^6` across the monorepo. TypeScript 7.0 is the native (Go) port and ships no importable JavaScript compiler API, which `packages/pbt-verifier` needs (`createProgram`, `transpileModule`). Do not upgrade to 7.x until a release ships an importable API and the tools that load `typescript` as a library support it.
- **Versions:** the ranges below name the major version to install (e.g. `ai@^7`). After the first install, the lockfile (`pnpm-lock.yaml`) is the source of truth. Before using an API of a fast-moving library (Vercel AI SDK, Next.js, Supabase SSR), check the docs for the installed version instead of assuming.

## Standard Commands
- `pnpm build`: builds all packages and `apps/web` via Turborepo.
- `pnpm test`: runs unit tests and Property-Based Tests across workspaces with **Vitest**.
- `pnpm lint`: ESLint plus `tsc --noEmit`.
- `pnpm db:migrate`: loads `.env` with `dotenv-cli`, then runs the **Flyway CLI** (`flyway -configFiles=db/flyway.conf migrate`). The Flyway CLI must be installed and on PATH. Flyway does not read `.env` on its own.

## Core Libraries
- **Frontend & API (`apps/web`):** Next.js 16 (App Router), React 19.
- **UI:** `shadcn/ui` (Radix UI + Tailwind CSS), dark gothic/forensic theme (`#09090b` background, `#e11d48` crimson for curses, `#10b981` emerald for verified properties).
- **Animations:** **GSAP** (`gsap` + `@gsap/react`, `useGSAP` hook for context-safe cleanup).
- **AI / LLM (live web mode):** **Vercel AI SDK** (`ai@^7`) with the Groq provider (`@ai-sdk/groq@^4`), optional `@ai-sdk/google` fallback. Call it only from Next.js Route Handlers (streaming text and structured output; check the installed version's docs for the exact function names). Model id comes from `LLM_MODEL` (default `openai/gpt-oss-120b`); key from `GROQ_API_KEY`. Groq retired `llama-3.3-70b-versatile` on 2026-08-16, so do not use it; check Groq's deprecations page before changing the model. Cache results by SHA-256 `code_hash` in Supabase.
- **Database & Auth:** **Supabase** (`@supabase/ssr`, `@supabase/supabase-js`) with Row Level Security enabled on every table.
- **Migrations:** **Flyway** (`db/migrations/V<N>__<description>.sql`). Connect through the direct connection or Session Pooler on port 5432, never the Transaction Pooler (6543), because Flyway needs session advisory locks (`pg_advisory_lock`). Never put the DB password in `db/flyway.conf`.
- **PBT engine (`packages/pbt-verifier`):** `fast-check` + `vitest`, comparing legacy JS against resurrected TS over 100 to 1,000 generated inputs.
- **MCP server (`packages/mcp-curse-scanner`):** `@modelcontextprotocol/sdk` + `acorn`, registered in `.kiro/settings/mcp.json`. Exposed tool names must match `autoApprove` exactly: `scan_ast_curses`, `extract_function_signatures`. The server entry is disabled in `mcp.json` until `dist/index.js` exists; enable it after the first build.

## LLM Usage Limits
- Anonymous (Judge/Sandbox) visitors MUST NOT trigger LLM calls. They see the precomputed Séance and Reincarnation results seeded for the sample corpses.
- Authenticated users may call `/api/seance` and `/api/reincarnate`, and each Route Handler MUST enforce a per-user rate limit (the limit value and storage are decided in the spec) before calling Groq.
- Check the SHA-256 `code_hash` cache first and call the LLM only on a cache miss.

## Secrets
- `SUPABASE_SERVICE_ROLE_KEY`, `FLYWAY_*`, and LLM keys are server-only. Never import them in client components or expose them with a `NEXT_PUBLIC_` prefix.
- Only `.env.example` is committed. It documents every variable with placeholder values.

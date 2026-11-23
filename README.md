# Lazarus

**Lazarus resurrects legacy JavaScript (ES3, ES5/jQuery, legacy Node) into strict TypeScript, and then checks with property-based tests that the new code behaves like the old code.**

Built with [Kiro](https://kiro.dev) for **Kiroween 2026**, category **Resurrection**.

- **Live app:** https://lazarus.jgcamiloaga.me/
- **How Kiro was used:** [`docs/kiro-usage.md`](docs/kiro-usage.md)
- **License:** [MIT](LICENSE)

## Try it in one minute (no sign-in needed)

1. Open https://lazarus.jgcamiloaga.me/. This page is **The Morgue**.
2. Open one of the three sample corpses:

   | Sample | Legacy style | Entry function | Curses it carries |
   |---|---|---|---|
   | Invoice totals calculator | ES3 | `computeInvoiceTotal` | `GLOBAL_POLLUTION`, `VAR_HOISTING`, `IMPLICIT_COERCION` |
   | Query string parser | ES5 / jQuery era | `parseQueryString` | `PROTOTYPE_POLLUTION`, `VAR_HOISTING`, `IMPLICIT_COERCION` |
   | Batch calculator | Legacy Node callbacks | `calculateBatch` | `CALLBACK_HELL`, `EVAL_INJECTION`, `VAR_HOISTING` |

3. Scroll through the stages on the corpse page: the **Hex Scanner** marks each curse on its exact line, the **Séance Chamber** shows the extracted spec, and the **Laboratory** shows the TypeScript module, its property-based test, and the result: "Verified behavioral equivalence across 1,000 generated inputs."

Visitors get read-only access. Nothing is written to the database and no language model is called; the sample results were computed ahead of time and stored by the database migrations.

To run the stages on your own code, select **Sign in with GitHub**. See [What a signed-in member can do](#what-a-signed-in-member-can-do).

## The problem

Old JavaScript is still running in production: ES3 scripts, jQuery plugins, Node callbacks from 2012. Rewriting it is risky because nobody remembers every edge case, and the tests are usually missing. Asking a language model to translate the file line by line gives code that looks modern, but nothing tells you whether it still does the same thing.

Lazarus treats the rewrite as a pipeline with a check at the end:

1. Find the problems with a deterministic analyzer, not a model.
2. Write down what the code does as a spec before generating anything.
3. Generate TypeScript from that spec.
4. Run the old function and the new function on the same randomly generated inputs and compare the results.

Codemods and tools like `ts-migrate` transform the syntax and add types. Lazarus adds the behavioral check: the result is evidence from generated inputs, with the exact run count, and a failing run shows the input where the two versions disagree.

## The four stages

| Stage | What happens | How it works |
|---|---|---|
| **1. The Morgue** | Ingestion and dashboard. Visitors see the samples; members also import their own files and keep a private history in **The Crypt**. | Next.js App Router, Supabase Auth with GitHub, Row Level Security on every table. |
| **2. The Hex Scanner** | Detects six curses with exact line numbers: `GLOBAL_POLLUTION`, `VAR_HOISTING`, `IMPLICIT_COERCION`, `CALLBACK_HELL`, `EVAL_INJECTION`, `PROTOTYPE_POLLUTION`. | `packages/mcp-curse-scanner`: an `acorn` AST analyzer. It never runs the code it reads, and the same source always gives the same findings. |
| **3. The Séance Chamber** | Extracts the business logic ("the soul") into a spec: `requirements.md` in EARS notation, `design.md`, and input/output invariants. The owner approves the spec before the next stage. | `POST /api/seance`: Vercel AI SDK with Groq, structured output validated with Zod. |
| **4. The Laboratory** | Generates a strict TypeScript module and a `fast-check` property test, then runs both versions on 1,000 generated inputs and compares the outcomes. | `POST /api/reincarnate` generates and type-checks the code in memory. `POST /api/verify` runs the test in `packages/sandbox-runner` (a Worker thread with fresh `node:vm` contexts and memory and time limits). |

### What a result means

"Verified behavioral equivalence across 1,000 generated inputs" means the legacy and the modern function returned equivalent outcomes (values or thrown errors) for each of the 1,000 inputs that were tried. It is empirical evidence. Inputs that were not generated were not checked. A failing run is reported as a result, with the counterexample that `fast-check` found.

## What a signed-in member can do

| Action | Limit |
|---|---|
| Import legacy JavaScript (paste or upload a `.js` file) | Up to 100 KB per file. The scanner and the model accept up to 20,000 bytes of source. |
| Run the Hex Scanner on an imported corpse | No model call, no quota. |
| Start a Séance and a Reincarnation | 20 model-backed requests per user per rolling 60 minutes, with a global ceiling of 500 per 24 hours. |
| Run a sample corpse live ("Verify live") | 10 verification runs per user per rolling 60 minutes. The result is shown and not stored. |

Results are cached by the SHA-256 hash of the code. Importing the same code twice reuses the stored result and makes no second model call. A cached result is never shared between two users.

### Implemented, with one switch off

Everything above is implemented and covered by tests. One part ships switched off on purpose: **live verification of code that a member imported.** The sandbox runs in the same process as the web server, and `node:vm` is not a security boundary, so the reviewed flag `USER_EXECUTION_ENABLED` in `apps/web/src/lib/verification/flags.ts` is `false`. With the flag off, a member's own reincarnation is generated, type-checked, and stored as "Not verified yet", and the Laboratory says that live verification is not available on this server. The threat model and the hardening to apply before turning it on are in [`packages/sandbox-runner/README.md`](packages/sandbox-runner/README.md#threat-model). Sample code was written and reviewed in the migrations, so members can run the samples live while the flag is off. The operator kill switch `LAZARUS_SANDBOX_KILL_SWITCH` stops both.

## Architecture

```text
Browser
  │  Visitor: read-only, anon key + RLS
  │  Member:  GitHub OAuth session + RLS
  ▼
apps/web  (Next.js 16, React 19, shadcn/ui, GSAP)
  ├─ The Morgue, The Crypt, Import, corpse page with the three stage panels
  └─ Route Handlers (server only)
       ├─ POST /api/scan        → @lazarus/mcp-curse-scanner (no model call)
       ├─ POST /api/seance      → Groq via Vercel AI SDK   ┐ code_hash cache,
       ├─ POST /api/reincarnate → Groq via Vercel AI SDK   ┘ per-user rate limit
       └─ POST /api/verify      → @lazarus/sandbox-runner → fast-check
  ▼
Supabase Postgres (Flyway migrations V1 to V4, RLS on every table)

Kiro IDE ──MCP (stdio)──► packages/mcp-curse-scanner/dist/index.js
          the same analyzer the product uses in /api/scan
```

The Route Handlers never use the service role key. Every query runs with the Supabase client of the request, so Row Level Security decides what each caller can read and write.

## Repository layout

```text
lazarus/
├── .kiro/
│   ├── specs/            # 11 feature specs (requirements.md, design.md, tasks.md)
│   ├── steering/         # 8 steering files (always, fileMatch, manual)
│   ├── hooks/            # 5 agent hooks
│   ├── skills/           # 3 workspace skills
│   └── settings/mcp.json # registers the lazarus-curse-scanner MCP server
├── apps/web/             # Next.js application and Route Handlers
├── packages/
│   ├── mcp-curse-scanner/  # AST scanner: library and MCP server
│   ├── pbt-verifier/       # fast-check equivalence verifier
│   └── sandbox-runner/     # isolated Worker execution for live verification
├── db/
│   ├── migrations/       # Flyway V1 to V4
│   ├── seed/             # the three sample corpses (legacy.js, modern.ts, test code)
│   └── tests/            # database suite (RLS, constraints, seed, quotas)
├── scripts/hooks/        # Node scripts run by the Kiro hooks
└── docs/kiro-usage.md    # how each Kiro feature was used
```

Each package has its own README with the details: [web app](apps/web/README.md), [scanner](packages/mcp-curse-scanner/README.md), [verifier](packages/pbt-verifier/README.md), [sandbox](packages/sandbox-runner/README.md).

## Tech stack

- Node.js 24 or newer, pnpm, Turborepo, strict TypeScript 6
- Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui, GSAP with `@gsap/react`
- Supabase (Postgres, Auth with GitHub, Row Level Security), Flyway migrations
- Vercel AI SDK 7 with Groq (`openai/gpt-oss-120b` by default) and an optional Google fallback
- `acorn` and `@modelcontextprotocol/sdk` for the scanner, `fast-check` and Vitest for testing

## Run it locally

### Prerequisites

- Node.js 24 or newer and pnpm 9 or newer
- The [Flyway CLI](https://documentation.red-gate.com/fd/command-line-184127404.html) on your `PATH`
- A Supabase project
- Optional: a Groq API key (needed only for new Séance and Reincarnation results)
- Optional: Docker, for the local test database

### Steps

```bash
git clone https://github.com/LIUNKS/lazarus.git
cd lazarus
pnpm install
cp .env.example .env        # then fill in the values
pnpm db:migrate             # applies V1 to V4, including the three sample corpses
pnpm build
pnpm --filter @lazarus/web dev   # http://localhost:3000
```

`.env.example` documents every variable. The browser needs only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `SUPABASE_SERVICE_ROLE_KEY`, `FLYWAY_*`, `GROQ_API_KEY`, and the other model variables are server-only.

Flyway must connect through the direct connection or the Session Pooler on port 5432. The Transaction Pooler on port 6543 does not work, because Flyway needs session advisory locks.

GitHub sign-in needs a GitHub OAuth app and the Supabase redirect allowlist. The steps are in [`apps/web/README.md`](apps/web/README.md#github-sign-in-setup).

Without a Groq key the app still serves the samples, the scanner, and every stored or cached result.

### Commands

| Command | What it does |
|---|---|
| `pnpm build` | Builds every package and the web app through Turborepo. |
| `pnpm test` | Runs the unit and property-based tests of every workspace with Vitest. |
| `pnpm lint` | ESLint and `tsc --noEmit`. |
| `pnpm db:migrate` | Loads `.env` and runs Flyway on `db/migrations`. |
| `pnpm test:db` | Starts a disposable Postgres with Docker and runs the database suite. |

## Tests

The repository holds 178 test files: 50 in the scanner, 9 in the verifier, 12 in the sandbox runner, 97 in the web app, and 10 in the database suite. 160 property tests carry a `// Feature: <spec>, Property <N>` tag that links them to a numbered correctness property in the `design.md` of their spec.

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs `pnpm lint`, `pnpm build`, and `pnpm test`, and runs the database suite against a disposable Postgres 17 with the Flyway CLI.

## How Kiro was used

Lazarus was built spec by spec in Kiro IDE. In short:

- **Specs:** 11 specs in `.kiro/specs/`, each with EARS requirements, a design with numbered correctness properties, and tasks that cite the criteria they implement.
- **Steering:** 8 files in `.kiro/steering/`. Three load always, four load by file pattern (database, UI, tests, specs), and one (`writing-and-claims.md`) is attached by hand when writing text that makes claims.
- **Hooks:** 5 hooks in `.kiro/hooks/`. One blocks edits to applied migrations and server secrets in client code before the write happens. Others run the scanner tests on save, run lint and tests after each spec task, print spec progress at session start, and review each new migration against the RLS rules.
- **MCP:** the Hex Scanner is also an MCP server (`scan_ast_curses`, `extract_function_signatures`), so the agent and the product use the same analyzer and report the same findings.
- **Skills:** 3 procedures for recurring work: resurrecting a corpse by hand, adding a curse type, and writing a Flyway migration.
- **Property-based testing:** used for the product (the Laboratory) and for building it (160 tagged property tests).

The full write-up, with the file behind every claim, is in [`docs/kiro-usage.md`](docs/kiro-usage.md).

## Security

- Row Level Security on every table. Visitors run as `anon`, members as `authenticated`. The service role key is never used by the web app.
- Identity comes from `supabase.auth.getClaims()`, which verifies the token signature.
- The Route Handlers accept only same-origin `POST` requests with a JSON body of at most 1,024 bytes. Code, hashes, and every other input are read from the database, never from the request.
- The scanner treats code as text and never runs it.
- Imported code runs only inside the sandbox, and only when the reviewed flag is on (it ships off). See [`packages/sandbox-runner/README.md`](packages/sandbox-runner/README.md) for the threat model and its limits.

## Scope

- Source languages: legacy JavaScript only (ES3, ES5/jQuery, legacy Node).
- The Laboratory verifies one pure, deterministic entry function per corpse: a top-level named function. A function with one parameter is called as `fn(input)`. A function that declares two or more parameters is called with one generated value per parameter through `assertEquivalentArgs`, and a one-argument test of such a function ends without a verdict. A function that reads `arguments` without declaring parameters is compared as a one-parameter function.
- Live verification runs only code that can run in-process in the JavaScript runtime.

## License

[MIT](LICENSE) © 2026 LIUNKS

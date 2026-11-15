---
inclusion: always
---
# Project Structure & Architecture Conventions

```text
lazarus/
├── .kiro/
│   ├── settings/mcp.json          # Registers the `lazarus-curse-scanner` MCP server
│   ├── steering/                  # Always, conditional (fileMatch), and manual steering docs
│   ├── specs/                     # Feature specs (requirements.md, design.md, tasks.md)
│   ├── hooks/                     # Agent hooks (JSON); the commands they run live in scripts/hooks/
│   └── skills/                    # Workspace skills: step-by-step procedures for recurring work
├── db/
│   ├── flyway.conf                # Flyway config (no secrets; credentials come from env)
│   └── migrations/                # V1__create_lazarus_schema.sql, V2__seed_sample_corpses.sql
├── apps/
│   └── web/                       # Next.js App Router application
│       ├── src/app/               # Routes and API Route Handlers (/api/scan, /api/seance, /api/reincarnate)
│       ├── src/components/ui/     # shadcn/ui components
│       ├── src/animations/        # Reusable GSAP timelines
│       └── src/lib/supabase/      # Supabase SSR client helpers
├── packages/
│   ├── mcp-curse-scanner/         # Acorn AST analyzer and MCP server
│   └── pbt-verifier/              # fast-check + Vitest equivalence runner (JS -> TS)
├── scripts/
│   └── hooks/                     # Node scripts run by the Kiro hooks (guard-write, spec-status, verify-task)
├── docs/                          # Project documentation (kiro-usage.md)
├── .env.example                   # Required environment variables (placeholders only)
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Rules
- `.kiro/` MUST be tracked in Git and never listed in `.gitignore`.
- Hook definitions are JSON files in `.kiro/hooks/` created with the `createHook` tool. A hook that needs more than one line of shell puts the logic in `scripts/hooks/*.mjs` so it can be tested and reviewed.
- Feature work goes through Specs in `.kiro/specs/`. Keep each spec small enough to review (foundation, scanner and verifier packages, web UI as separate specs).
- Database access from the browser uses the anon key and RLS. Writes that bypass RLS (service role) happen only in server-side Route Handlers.

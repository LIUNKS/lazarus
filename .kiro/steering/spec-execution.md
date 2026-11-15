---
inclusion: fileMatch
fileMatchPattern: [".kiro/specs/**"]
---
# Spec Execution Rules

These rules apply whenever you work on a task from `.kiro/specs/<NN>-<name>/tasks.md`. They summarize the conventions the existing specs already follow.

## Before the first task
1. Read the spec's `requirements.md`, `design.md`, and `tasks.md` in full. Read the **Preconditions** and **Scope and conventions** sections of `tasks.md` first.
2. Check every precondition against the repository (for example, that a package the spec depends on exists). If one is not met, stop and ask the user. Do not create the missing piece inside this spec.
3. Specs are numbered by dependency order. A spec never edits files that another spec owns, except for the additive exceptions its own `tasks.md` lists.

## While working
- Do one task at a time, in order. Do not start the next task until the current one is finished and verified.
- Stay inside the scope paragraph of the spec. If the design and the code disagree, stop and report it. Update `design.md` only when the user agrees.
- Every task cites its requirements (`_Requirements: ..._`). Read the cited criteria before writing code, and make the test names and traceability comments point to them (see `testing-conventions.md`).
- Tasks marked with `*` are optional. Do not skip one silently: say that you are skipping it, or do it.
- Before using an API of a fast-moving library (Vercel AI SDK, Next.js, Supabase SSR, `fast-check`, `esbuild`, Worker and `vm` APIs), check the documentation for the installed version. Do not invent options.
- Do not add dependencies, files, or features that no task asks for. Do not refactor code that belongs to another spec.

## Finishing a task
- Mark a task `[x]` only after its own checks pass: the tests it names and `pnpm lint` for the touched packages. A command that exits without error is not enough if the task lists specific outputs.
- Checkpoint tasks run the full commands they name (for example `pnpm exec turbo run build lint test --filter=...`). Report the exit code.
- Leave the lockfile to `pnpm`. Only the changes the spec expects may appear in `pnpm-lock.yaml`.
- Report unfinished or unverifiable items explicitly instead of marking them done.

## Known environment issue
- `apps/web/test/build-output.test.ts` runs a Next.js build with Turbopack. On the OneDrive working copy it failed with `ENOENT` while Turbopack persisted its cache (`.sst` file), and the other web tests passed. If you see this failure, report it and do not change application code to work around it. Try the test from a copy of the repository outside OneDrive before concluding the code is wrong.

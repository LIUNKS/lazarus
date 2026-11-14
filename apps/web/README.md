# @lazarus/web

The Lazarus web application: Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui, GSAP, and Supabase.
It delivers the application shell and the first stage of the product, The Morgue.

- **Judge mode:** anyone can open the three sample corpses without signing in. Access is read-only, nothing is written to the database, and no language model is called.
- **GitHub sign-in:** signed-in members can import legacy JavaScript and keep a private history in The Crypt.
- **Not included yet:** the Hex Scanner, Séance Chamber, and Laboratory screens, and any analysis or model call.

## Commands

Run them from the repository root.

```bash
pnpm --filter @lazarus/web dev     # development server on http://localhost:3000
pnpm --filter @lazarus/web build   # production build
pnpm --filter @lazarus/web start   # serve the production build
pnpm build | pnpm test | pnpm lint # whole workspace through Turborepo
```

## Environment variables

The app reads the `.env` and `.env.local` files at the **repository root** (not in `apps/web`); `.env.local` wins over `.env`, and real environment variables win over both. `next.config.ts` loads them with `loadEnvConfig(root, dev, console, true)`. The last argument is required, otherwise Next.js ignores the call.

| Variable | Use |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. `https://`, or `http://` for `localhost` and `127.0.0.1`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client key (the anon or publishable key). Safe for the browser. |

`.env.example` documents both. The app never reads the service role key, the database credentials, or any model key.

> **`NEXT_PUBLIC_*` values are fixed when you build.** Next.js inlines them into the bundles during `next build`, so changing them requires a new build. In a deployment, set them in the build environment.

If either variable is missing or invalid, every page answers with HTTP 503 and a page that lists the variable names (never their values).

## Database

Judge mode needs the sample corpses, which come from the Foundation migrations:

```bash
pnpm db:migrate
```

Without them The Morgue shows an error or an empty state instead of the samples.

## GitHub sign-in setup

1. Create a **GitHub OAuth application** (GitHub → Settings → Developer settings → OAuth Apps). Set its authorization callback URL to the Supabase Auth callback:
   `https://<project-ref>.supabase.co/auth/v1/callback`
2. In the Supabase dashboard open **Authentication → Sign In / Providers → GitHub**, enable it, and paste the client id and client secret of that application.
3. In **Authentication → URL Configuration**, add these to the redirect URL allowlist:
   - `http://localhost:3000/auth/callback` (local development)
   - `https://<your-domain>/auth/callback` (each deployed origin)
4. Start the app and use **Sign in with GitHub**. After the first sign-in the database trigger creates the member's profile.

The app builds the `redirectTo` URL from the request headers, so no code change is needed between local and deployed origins. Supabase rejects any URL that is not in the allowlist.

## Routes

| Route | Access |
|---|---|
| `/` | Everyone. The Morgue: samples, plus your own corpses when signed in. |
| `/corpses/[id]` | Samples for everyone, your own corpses for you. Anything else is a 404. |
| `/sign-in`, `/auth/callback` | Sign-in flow. |
| `/crypt`, `/import` | Members only. A visitor is redirected to `/sign-in`. |

## Security notes

- Identity always comes from `supabase.auth.getClaims()`, which verifies the token signature. `getSession()` is never used for authorization.
- Every query runs with the request's own Supabase client under Row Level Security. Visitors run as `anon`, members as `authenticated`.
- State changes (import, delete, sign-out) are Server Actions. Redirect targets must be same-origin paths.
- Database and Supabase errors are logged on the server and replaced by generic messages in the browser.
- Imported code is stored as text only. It is not parsed, run, or sent to a model.

## Tests

`pnpm --filter @lazarus/web test` runs Vitest with no database or network. It covers the redirect sanitizer, import validation and hashing, configuration validation, the status mapping, the contrast of the theme, the Server Actions with a fake Supabase client (a visitor can never write), static isolation of server-only names, and a production build with sentinel values that must not appear in the client bundles.

GitHub sign-in against a real Supabase project and the Data API queries cannot run in the automated suite. Check them by hand after applying the migrations.

## Known limits

- The duplicate check on import is not atomic: two simultaneous imports of the same code can create two rows in the member's own Crypt.
- No Content-Security-Policy is set yet; it will be designed together with the final pages.

## Pipeline API

Three Route Handlers run the server side of the resurrection workflow: `POST /api/scan` (the Hex Scanner), `POST /api/seance` (the Séance Chamber), and `POST /api/reincarnate` (the generation half of the Laboratory). They add to what the sections above describe. Where this section differs from a sentence above about model calls or model keys, this section applies to these three routes. The Morgue pages themselves still call no model.

Every route accepts only `POST` with `Content-Type: application/json` and an `Origin` header that equals the origin of the app. The request body is at most 1,024 bytes and holds exactly one key:

```json
{ "corpseId": "<uuid>" }
```

The route reads the code, its hash, and every other input from the database. Nothing else in the request changes the result. Every response is JSON with `Cache-Control: private, no-store`.

### Who can call what

- **A Visitor never triggers an LLM call.** A visitor can read the stored results of the three sample corpses and nothing else. No model is called, no quota is spent, and nothing is written, whatever the request body holds.
- **The service role key is never used by the Pipeline API.** Every query runs with the Supabase client of the request, so Row Level Security decides what each caller can read and write.
- A signed-in Member can run all three routes on their own corpses. Code that belongs to another member is reported as not found.

### Result sources

The Séance and Reincarnate routes report where a result came from in the field `source`:

| `source` | Meaning |
|---|---|
| `precomputed` | The stored result of a sample corpse. |
| `stored` | The result already stored for the requested corpse. |
| `cache` | A copy of a result of another corpse that the caller can see and that has the same `code_hash`. |
| `generated` | A new result from the model, checked and stored by this request. |

The cache rule: a stored row of another visible corpse with the same `code_hash` is reused and no LLM call is made. Only samples and the member's own corpses are visible, so a result is never shared between two users.

### `POST /api/scan`

Runs the deterministic curse scanner on the corpse and replaces its stored curses. It makes no model call, reads no model setting, and spends no quota. A sample corpse returns its stored curses and nothing is scanned or written.

```json
{
  "ok": true,
  "source": "generated",
  "lineCount": 12,
  "curses": [
    { "curseType": "VAR_HOISTING", "severity": "HEX", "lineNumber": 3, "description": "...", "exorcismStrategy": "..." }
  ]
}
```

`source` is `precomputed` for a sample and `generated` for a scan of a member's corpse. `curses` is ordered by line number and then by curse type.

### `POST /api/seance`

Extracts the business logic of the corpse into a Séance spec (requirements in EARS notation, a design, and input and output invariants).

```json
{
  "ok": true,
  "source": "generated",
  "seance": {
    "id": "...",
    "requirementsMd": "...",
    "designMd": "...",
    "invariants": { "entry_function": "...", "input": "...", "output": "...", "invariants": ["..."] },
    "approvedAt": null
  },
  "corpse": { "id": "...", "status": "IN_SEANCE" }
}
```

A new or copied spec moves a corpse from `INFECTED` to `IN_SEANCE`. `approvedAt` stays `null` here: the approval control belongs to the resurrection screens.

### `POST /api/reincarnate`

Generates a modern TypeScript module and a property-based test body from the stored Séance spec. It needs a stored Séance spec for the corpse. The generated code is parsed and type-checked in memory and is never run.

```json
{
  "ok": true,
  "source": "generated",
  "reincarnation": {
    "id": "...",
    "targetStack": "TypeScript (strict, ES2022)",
    "modernCode": "...",
    "pbtTestCode": "...",
    "pbtPassed": null,
    "totalRuns": null,
    "executionTimeMs": null,
    "createdAt": "...",
    "verification": "NOT_RUN",
    "evidence": null
  },
  "corpse": { "id": "...", "status": "INFECTED" }
}
```

`verification` is `VERIFIED`, `FAILED`, or `NOT_RUN`. `evidence` holds the one sentence that states a verification outcome, with the exact run count, and only when a stored run passed. Results are empirical evidence from generated inputs and never a statement about all inputs. User corpses are generated but not executed until `08-live-verification-api` enables live verification (which builds on `07-sandboxed-execution`), so a new reincarnation of a user corpse is always `NOT_RUN`.

### Limits

| Limit | Value | Where it lives |
|---|---|---|
| User_Quota | 20 reservations per user per rolling 60 minutes, counted across `/api/seance` and `/api/reincarnate` | `apps/web/src/lib/pipeline/limits.ts` (`LIMITS.userQuota`) |
| Global_Quota | 500 reservations in total per rolling 24 hours | `apps/web/src/lib/pipeline/limits.ts` (`LIMITS.globalQuota`) |

The database function `public.reserve_llm_call` receives both values as arguments and records one row per reservation, so changing a value needs no migration. A request that fails after its reservation still counts. One reservation covers at most two model calls. Other limits (source size 20,000 bytes, 45 seconds per model call, a 100 second deadline per request) are in the same file.

### Model settings

The model variables are read only on the server and only when a request needs the model. Without them the three routes still serve stored, cached, and precomputed results and scan requests.

| Variable | Use |
|---|---|
| `GROQ_API_KEY` | Groq API key. Required for new Séance and reincarnation results. |
| `LLM_MODEL` | Groq model id. Defaults to `openai/gpt-oss-120b`. |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `LLM_FALLBACK_MODEL` | Optional pair. When both are set, one failed Groq call can be retried once on this Google model. |

### Error codes

A failed request returns `{ "ok": false, "error": { "code": "...", "message": "..." } }` with a fixed English message for each code.

| Code | Status | When it happens |
|---|---|---|
| `INVALID_REQUEST` | 400 | The body is not a JSON object with exactly one key, `corpseId`, that holds a UUID. |
| `AUTH_REQUIRED` | 401 | A visitor asked for a corpse that is not a visible sample. |
| `FORBIDDEN_ORIGIN` | 403 | The `Origin` header is missing or is not the origin of the app. |
| `NOT_FOUND` | 404 | A member asked for a corpse that does not exist or belongs to someone else. |
| `NOT_PRECOMPUTED` | 404 | A sample corpse has no stored result for this route. |
| `METHOD_NOT_ALLOWED` | 405 | The HTTP method is not `POST`. |
| `SEANCE_REQUIRED` | 409 | Reincarnation was requested for a corpse that has no Séance spec yet. |
| `REQUEST_TOO_LARGE` | 413 | The request body is larger than 1,024 bytes. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | The `Content-Type` is not `application/json`. |
| `SOURCE_TOO_LARGE` | 422 | The legacy code is larger than 20,000 bytes of UTF-8. |
| `SOURCE_SYNTAX_ERROR` | 422 | The legacy code has a syntax error (a scan response adds the line and column). |
| `SOURCE_NOT_SCANNABLE` | 422 | The scanner could not analyze the code because of its size, nesting, or analysis time. |
| `NO_ENTRY_FUNCTION` | 422 | The code has no top-level named function declaration to use as the entry function. |
| `RATE_LIMITED` | 429 | The user or the whole service reached its limit of generation requests (see the `Retry-After` header). |
| `INTERNAL_ERROR` | 500 | An unexpected error occurred, the session or the corpse could not be read, or no safe prompt delimiter could be chosen. |
| `PERSISTENCE_FAILED` | 500 | A cached, copied, or generated result could not be stored or read. |
| `LLM_OUTPUT_INVALID` | 502 | The model output still failed validation after the one allowed second call. |
| `LLM_PROVIDER_ERROR` | 502 | The model provider failed and no second call was allowed. |
| `LLM_NOT_CONFIGURED` | 503 | The model key is missing or invalid, or the provider rejected it. |
| `QUOTA_UNAVAILABLE` | 503 | The request limit could not be checked, so no model was called. |
| `LLM_TIMEOUT` | 504 | The model did not answer in time, or the 100 second request deadline passed. |

### Server-only check

On 2026-11-13 a throwaway Client Component that imported `lib/pipeline/log.ts` made `pnpm --filter @lazarus/web build` fail with exit code 1 and an error that names that import. After the probe was removed the build passed again.

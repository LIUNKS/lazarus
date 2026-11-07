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

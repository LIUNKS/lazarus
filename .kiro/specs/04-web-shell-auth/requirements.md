# Requirements Document

## Introduction

This spec creates the web application of Lazarus: **`apps/web`**, a Next.js 16 (App Router) project with React 19. It delivers the application shell and the first stage of the product, **The Morgue**:

1. The **project scaffold**: package, TypeScript, Tailwind CSS with shadcn/ui, the dark gothic theme, and a reusable GSAP animation foundation.
2. **Supabase integration** for server-side rendering: browser and server clients, the session-refresh Proxy, and GitHub OAuth sign-in and sign-out.
3. **Frictionless Judge/Sandbox mode**: anonymous, read-only access to the three sample corpses seeded by `01-lazarus-foundation`, with no login, no database write, and no LLM call.
4. **The Morgue dashboard**, a **corpse detail page**, **import of legacy JavaScript** by signed-in users, and **The Crypt** (the private history of a signed-in user).

The steering documents `product.md`, `tech.md`, `structure.md`, and `database-and-exorcism.md` and the Foundation schema (`01-lazarus-foundation`, Requirements 9 to 15) are the source of truth. All Row Level Security (RLS) rules are enforced by the database; this spec relies on them and never reimplements them in application code.

**Prerequisite.** `01-lazarus-foundation` is implemented: the pnpm and Turborepo workspace (`apps/*` glob), `tsconfig.base.json`, `eslint.config.mjs`, `vitest.shared.ts`, the schema, the RLS policies, and the three Sample_Corpse rows.

**Out of scope** (separate specs): the Hex Scanner, Séance Chamber, and Laboratory screens (`06-resurrection-ui`), the Route Handlers `/api/scan`, `/api/seance`, and `/api/reincarnate`, any call to Groq or to the Vercel AI SDK, rate limiting of LLM calls, and the cache by `code_hash` (`05-llm-pipeline-api`), running legacy or user-supplied code (`03-pbt-verifier` and `07-sandboxed-execution`), the MCP scanner package (`02-scanner-and-verifier`), fetching code from a GitHub repository, and any change to the Foundation migrations, seed, harness, or Verification_Suite. This spec never uses `SUPABASE_SERVICE_ROLE_KEY`.

## Glossary

- **Web_App**: The Next.js application in `apps/web`, workspace package `@lazarus/web`.
- **Workspace_Root**: The repository root `lazarus/`.
- **Root_Env_Files**: The files `.env` and `.env.local` at the Workspace_Root.
- **Public_Config**: The variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Server_Only_Variables**: `SUPABASE_SERVICE_ROLE_KEY`, every `FLYWAY_*` variable, `TEST_DATABASE_URL`, `GROQ_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `LLM_MODEL`, `LLM_FALLBACK_MODEL`, and `LAZARUS_SANDBOX_KILL_SWITCH` (the last two are added by the amendments of specs 05 and 08).
- **Browser_Client**: The Supabase client created with `createBrowserClient` from `@supabase/ssr`, used in Client Components.
- **Server_Client**: The Supabase client created per request with `createServerClient` from `@supabase/ssr`, used in Server Components, Server Actions, and Route Handlers.
- **Proxy**: The Next.js 16 file `proxy.ts` (the successor of `middleware.ts`) that refreshes the Supabase session on each matched request.
- **Claims**: The verified JWT claims returned by `supabase.auth.getClaims()`.
- **Visitor**: A person without a Supabase session. The Visitor uses the Judge_Mode.
- **Judge_Mode**: The anonymous, read-only experience for a Visitor.
- **Member**: A person with a verified Supabase session, signed in with GitHub.
- **Sample_Corpse**: A row of `public.corpses` with `is_sample = true`.
- **Owned_Corpse**: A row of `public.corpses` with `user_id` equal to the Member's id.
- **Morgue**: The dashboard at `/` that lists corpses.
- **Crypt**: The page at `/crypt` that lists the Owned_Corpses of the Member.
- **Corpse_Page**: The page at `/corpses/[id]`.
- **Import_Form**: The form at `/import` that creates an Owned_Corpse.
- **Import_Limits**: The limits in Requirement 11: source code at most 102,400 bytes, title 1 to 200 characters, and at most 100 Owned_Corpses per Member.
- **Safe_Redirect_Path**: A string that starts with a single `/`, does not start with `//` or `/\`, contains no backslash and no ASCII control character, and is at most 512 characters long.
- **Status_Badge**: The visual label for a corpse `status` (`INFECTED`, `IN_SEANCE`, `RESURRECTED`, `FAILED`).
- **Theme_Tokens**: The colors `#09090b` (background), `#e11d48` (crimson, curses), and `#10b981` (emerald, verified properties).
- **Reveal_Timeline**: The reusable GSAP timeline in `apps/web/src/animations/` used by the page shell and cards.

## Requirements

### Requirement 1: Workspace package and scaffold

**User Story:** As a developer, I want `apps/web` to be a regular workspace package, so that Turborepo builds, lints, and tests it with the same commands as every other package.

#### Acceptance Criteria

1. THE Web_App SHALL live in `apps/web` and SHALL have a `package.json` with `name` `@lazarus/web`, `private` `true`, `type` `module`, and `engines.node` `>=24`.
2. THE Web_App SHALL depend on `next` (major version 16), `react` and `react-dom` (major version 19), `@supabase/ssr`, `@supabase/supabase-js`, `gsap`, and `@gsap/react`, and SHALL use the App Router with the source directory `apps/web/src`.
3. THE Web_App SHALL define the scripts `dev`, `build`, `start`, `test`, and `lint` in its `package.json`, so that the root `pnpm build`, `pnpm test`, and `pnpm lint` run `build`, `test`, and `lint` through the Build_Pipeline of `01-lazarus-foundation`.
4. THE Web_App SHALL provide a `tsconfig.json` that extends `../../tsconfig.base.json`, keeps `"strict": true`, and overrides only the options that Next.js requires (for example `module`, `moduleResolution`, `jsx`, `noEmit`, and the `next` TypeScript plugin).
5. THE Web_App SHALL contain zero explicit `any` type annotations, so that `pnpm lint` exits with code 0 for the package.
6. THE Web_App SHALL use the `typescript` major version 6 declared by the Workspace_Root and SHALL NOT add its own `typescript` dependency of another major version.
7. WHEN `pnpm build` runs from the Workspace_Root, THE Web_App SHALL produce a production build with exit code 0 and SHALL declare its build output (`.next/**`, excluding `.next/cache/**`) so that Turborepo caches it.
8. THE Web_App SHALL write all UI text, source comments, and documentation in English.
9. THE Web_App SHALL NOT create or modify any file under `packages/` or `db/`, and any change outside `apps/web` SHALL be limited to the lockfile and to the Foundation files listed in Requirement 17.

### Requirement 2: Environment loading and validation

**User Story:** As a developer, I want the app to read the variables from the repository root and to keep secrets on the server, so that one `.env` configures the whole monorepo and no key reaches the browser.

#### Acceptance Criteria

1. WHEN the Web_App starts in development, builds, or starts in production, THE Web_App SHALL load the Root_Env_Files, with `.env.local` taking precedence over `.env` and real environment variables taking precedence over both, even though the Next.js project directory is `apps/web`.
2. THE Web_App SHALL read Public_Config only through one module (`src/lib/env`) that returns either a valid configuration or a typed error that names each missing or invalid variable and never its value.
3. THE Public_Config validation SHALL require `NEXT_PUBLIC_SUPABASE_URL` to be an `https://` URL, or an `http://` URL whose host is `localhost` or `127.0.0.1`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to be a non-blank string.
4. IF Public_Config is missing or invalid, THEN THE Web_App SHALL render a configuration error page that lists the names of the missing or invalid variables and points to `.env.example`, SHALL respond with HTTP status 503, and SHALL NOT crash, print a stack trace, or print any variable value.
5. THE Web_App SHALL NOT read any Server_Only_Variable in any module that is imported by a Client Component, and the production client bundles SHALL NOT contain the names or values of the Server_Only_Variables.
6. THE Web_App SHALL NOT use a variable whose name has the prefix `NEXT_PUBLIC_` followed by the name of a Server_Only_Variable.
7. THE Web_App SHALL NOT read `SUPABASE_SERVICE_ROLE_KEY`, and no module of the Web_App SHALL create a Supabase client with the service role key.
8. THE Web_App SHALL NOT log, render, or serialize into a response the value of `NEXT_PUBLIC_SUPABASE_ANON_KEY` outside the Browser_Client and Server_Client constructors.
9. (Amendment, spec 08.) WHERE a later spec needs a Server_Only_Variable, THE Web_App SHALL read it only in a server-only module that begins with `import 'server-only'` (`apps/web/src/lib/env-server.ts` for `LAZARUS_SANDBOX_KILL_SWITCH`), so that `lib/env.ts` stays client-safe and the Public_Config validation of criteria 2 to 4 is unchanged. Criterion 5 remains in force.
10. (Amendment, spec 08.) THE optional Server_Only_Variable `LAZARUS_SANDBOX_KILL_SWITCH` SHALL be validated as follows: a trimmed, case-insensitive value of `1` or `true` is engaged; unset, blank, `0`, or `false` is not engaged; any other value is invalid and SHALL be treated as engaged (fail closed). THE validation SHALL report an invalid value by variable name and reason only, SHALL never include the value in a problem list, log line, response, or error object, and SHALL NOT trigger the configuration error page of criterion 4, because an invalid kill switch only disables live verification and must not take the site down.

### Requirement 3: Theme, layout, and accessibility

**User Story:** As a visitor, I want a coherent dark gothic interface that is readable and keyboard-friendly, so that the product feels finished from the first screen.

#### Acceptance Criteria

1. THE Web_App SHALL use Tailwind CSS (major version 4) and `shadcn/ui` (Radix UI based components), configured through `apps/web/components.json`, with generated components under `apps/web/src/components/ui/`.
2. THE Web_App SHALL define the Theme_Tokens as CSS variables or Tailwind theme values in one place, SHALL render the page background as `#09090b`, and SHALL use `#e11d48` only for curses and destructive actions and `#10b981` only for verified properties and success states.
3. THE Web_App SHALL render in a single dark theme, SHALL set `color-scheme: dark`, and SHALL NOT offer a theme switch.
4. THE Web_App SHALL provide a root layout with a header (brand, primary navigation, and authentication control), a main landmark, and a footer, and SHALL set `<html lang="en">` and a page title and description for every route.
5. THE header SHALL show the links Morgue (`/`) always, and Crypt (`/crypt`) and Import (`/import`) only to a Member.
6. THE text and the interactive controls SHALL have a contrast ratio of at least 4.5:1 against their background, SHALL show a visible focus indicator, and SHALL be operable with the keyboard alone.
7. THE layout SHALL be usable at viewport widths from 360 px to 1920 px without horizontal scrolling of the page body.
8. THE Web_App SHALL provide a skip link to the main landmark as the first focusable element.

### Requirement 4: GSAP animation foundation

**User Story:** As a designer, I want one reusable, safe animation primitive, so that later screens animate consistently without leaking timelines.

#### Acceptance Criteria

1. THE Web_App SHALL implement the Reveal_Timeline in `apps/web/src/animations/` with `gsap` and the `useGSAP` hook of `@gsap/react`, so that every timeline is scoped to a container and reverted when the component unmounts.
2. THE Reveal_Timeline SHALL animate only `opacity` and `transform`.
3. WHILE the browser reports `prefers-reduced-motion: reduce`, THE Reveal_Timeline SHALL skip the animation and show the final state immediately.
4. THE Web_App SHALL apply the Reveal_Timeline to the page header on first load and to the corpse cards in the Morgue.
5. THE Web_App SHALL render all content in the server-rendered HTML in its final, visible state, so that a page remains readable when JavaScript is disabled or GSAP fails to load.
6. THE modules that import `gsap` SHALL be Client Components, and no Server Component SHALL import `gsap`.

### Requirement 5: Supabase clients and session refresh

**User Story:** As a developer, I want correct, centralized Supabase clients for server-side rendering, so that sessions stay valid and identity is always verified.

#### Acceptance Criteria

1. THE Web_App SHALL provide the Browser_Client in `apps/web/src/lib/supabase/client.ts` and the Server_Client in `apps/web/src/lib/supabase/server.ts`, both created from Public_Config.
2. THE Server_Client SHALL be created once per request, SHALL read cookies through `getAll`, and SHALL write cookies through `setAll`, ignoring the write error that Server Components raise.
3. THE Web_App SHALL provide the Proxy in `apps/web/src/proxy.ts` that calls `supabase.auth.getClaims()` on each matched request, passes the refreshed cookies to the request and to the response, and applies the cache headers (`Cache-Control`, `Expires`, `Pragma`) that `setAll` provides to the response.
4. THE Proxy matcher SHALL exclude static assets (`_next/static`, `_next/image`, and files with an image or font extension) and SHALL include every page route and the authentication routes.
5. IF Public_Config is invalid, THEN THE Proxy SHALL NOT call Supabase and SHALL NOT throw, and SHALL rewrite every request except the configuration error page itself to that page with HTTP status 503 (Requirement 2 criterion 4).
6. THE Web_App SHALL decide whether a request belongs to a Member only from Claims, and SHALL NOT use `supabase.auth.getSession()` in any server-side module for an authorization decision.
7. THE Web_App SHALL NOT mark any page that depends on the session as statically generated or as cacheable by a shared cache, so that a response with a session cookie is never served to another user.
8. THE Web_App SHALL expose one server-side helper, `getCurrentMember()`, that returns the Member (`id`, `email` or `null`) from verified Claims or `null` for a Visitor, and every protected page and Server Action SHALL use it.

### Requirement 6: GitHub sign-in and sign-out

**User Story:** As a user, I want to sign in with GitHub and sign out safely, so that I can keep a private history in The Crypt.

#### Acceptance Criteria

1. THE header SHALL show a "Sign in with GitHub" control to a Visitor, and the Member's GitHub username, avatar, and a "Sign out" control to a Member.
2. WHEN a Visitor activates "Sign in with GitHub", THE Web_App SHALL call `signInWithOAuth` with the provider `github` and a `redirectTo` that is the absolute URL of `/auth/callback` on the current origin, using the PKCE flow of `@supabase/ssr`.
3. WHEN the route `GET /auth/callback` receives a `code` parameter, THE Web_App SHALL call `exchangeCodeForSession(code)` and then redirect to the Safe_Redirect_Path given by the `next` parameter, or to `/` when `next` is absent or not a Safe_Redirect_Path.
4. IF `GET /auth/callback` receives no `code`, an `error` parameter, or a code that fails to exchange, THEN THE Web_App SHALL redirect to `/` with a non-sensitive error message that the header or page displays, and SHALL NOT echo the raw `error_description` parameter into the page.
5. THE Web_App SHALL accept sign-out only through a POST Server Action that calls `supabase.auth.signOut()` and redirects to `/`, and SHALL NOT sign out on a GET request.
6. WHEN a Member signs in for the first time, THE Web_App SHALL rely on the `public.profiles` row created by the Foundation trigger and SHALL read it with the Member's own session to show the GitHub username and avatar, falling back to the email or a generic avatar when the profile fields are NULL.
7. THE Web_App SHALL render the avatar only from an `https://` URL and SHALL render a generic avatar otherwise.
8. THE sign-in control SHALL work for an `http://localhost` origin in development and for the deployed origin in production without a code change, deriving the origin from the request.

### Requirement 7: Route access rules

**User Story:** As a maintainer, I want clear public and protected routes enforced on the server, so that private pages never render for a Visitor.

#### Acceptance Criteria

1. THE routes `/`, `/corpses/[id]`, and `/auth/callback` SHALL be reachable by a Visitor.
2. THE routes `/crypt` and `/import` SHALL require a Member.
3. WHEN a Visitor requests `/crypt` or `/import`, THE Web_App SHALL redirect to `/sign-in?next=<path>` where `<path>` is the requested path, and the sign-in page SHALL start the GitHub flow with that Safe_Redirect_Path.
4. WHEN a Member requests `/sign-in`, THE Web_App SHALL redirect to `/`.
5. THE protected pages and Server Actions SHALL verify the Member on the server by Requirement 5 criterion 8 and SHALL NOT rely on the Proxy as the only check.
6. THE Web_App SHALL NOT hide data only in the user interface: every query SHALL run with the Server_Client of the current request, so that RLS decides which rows are returned.

### Requirement 8: Judge/Sandbox mode

**User Story:** As a judge or anonymous visitor, I want to explore the three sample corpses without logging in, so that I can evaluate Lazarus immediately.

#### Acceptance Criteria

1. WHEN a Visitor opens `/`, THE Web_App SHALL list the Sample_Corpses without requiring authentication.
2. THE Web_App SHALL read data for a Visitor only with the Server_Client or Browser_Client built from the anon key, so that the database role is `anon` and RLS limits the result to Sample_Corpses.
3. WHILE the user is a Visitor, THE Web_App SHALL NOT insert, update, or delete any row, SHALL NOT render an enabled control that would do so, and SHALL reject every Server Action that writes data with an authentication error.
4. WHILE the user is a Visitor, THE Web_App SHALL NOT call any LLM provider, and this spec contains no LLM call for any user.
5. THE Morgue SHALL show a notice to a Visitor that the samples are read-only, that their results are precomputed, and that signing in with GitHub enables importing code and keeping a private history.
6. IF the query for Sample_Corpses returns zero rows, THEN THE Morgue SHALL show an empty state that says the samples are not loaded and names the command `pnpm db:migrate`.
7. IF the query fails, THEN THE Morgue SHALL show a generic error state, SHALL log the error on the server without the anon key, and SHALL NOT expose the database error text to the browser.

### Requirement 9: The Morgue dashboard

**User Story:** As a user, I want a dashboard of corpses with clear status, so that I can pick one to inspect.

#### Acceptance Criteria

1. THE Morgue SHALL list the Sample_Corpses to every user, and SHALL additionally list the Owned_Corpses to a Member in a separate section titled "Your corpses", and SHALL NOT list the corpses of other users.
2. EACH corpse card SHALL show the title, the source language (`es3`, `es5-jquery`, or `legacy-node`) as a labeled badge, the Status_Badge, the creation date in UTC in the format `YYYY-MM-DD`, and the number of stored curses.
3. THE Status_Badge SHALL use `#e11d48` for `INFECTED` and `FAILED`, the neutral foreground color for `IN_SEANCE`, and `#10b981` for `RESURRECTED`, and SHALL always include the status text, so that color is never the only signal.
4. THE Morgue SHALL order Sample_Corpses by title ascending and Owned_Corpses by creation date descending, and SHALL load at most 50 Owned_Corpses.
5. THE Morgue SHALL obtain the curse counts with one query for all listed corpses and SHALL NOT issue one query per corpse.
6. EACH corpse card SHALL link to `/corpses/<id>` and SHALL be reachable and operable with the keyboard.
7. WHEN a Member has no Owned_Corpses, THE Morgue SHALL show an empty state in "Your corpses" with a link to `/import`.
8. THE corpse titles SHALL be rendered as text, so that a title containing HTML or script markup is displayed literally and never interpreted.

### Requirement 10: Corpse page

**User Story:** As a user, I want to open a corpse and read its legacy source, so that I can see exactly what will be analyzed and resurrected.

#### Acceptance Criteria

1. WHEN a request for `/corpses/[id]` has an `id` that is not a UUID, THE Web_App SHALL respond with the not-found page without querying the database.
2. WHEN the query for the corpse returns no row (the corpse does not exist, belongs to another user, or is not visible to the current role), THE Web_App SHALL respond with the same not-found page and the same status 404, so that the response does not reveal whether a private corpse exists.
3. THE Corpse_Page SHALL show the title, the source language badge, the Status_Badge, the creation date, a "Sample" label for a Sample_Corpse, and the repository URL as a link with `rel="noopener noreferrer"` when it is an `https://` URL.
4. THE Corpse_Page SHALL show the `original_code` in a read-only, monospaced code view with line numbers starting at 1, SHALL render the code as text only, and SHALL preserve whitespace and long lines by horizontal scrolling inside the code view.
5. THE Corpse_Page SHALL show the number of stored curses and, for each curse, its type, severity, and line number, as read-only information.
6. THE Corpse_Page SHALL show a clearly labeled placeholder for the next stages (Hex Scanner, Séance Chamber, Laboratory) stating that they arrive in a later release, with no control that triggers analysis.
7. WHEN the viewer is the owner of the corpse, THE Corpse_Page SHALL show a "Delete" control that follows Requirement 12 criteria 4 and 5, and WHEN the corpse is a Sample_Corpse THE Corpse_Page SHALL NOT show it.

### Requirement 11: Import legacy JavaScript

**User Story:** As a Member, I want to import my own legacy JavaScript file, so that it appears in my Crypt as a new corpse.

#### Acceptance Criteria

1. THE Import_Form SHALL collect a title, a source language (`es3`, `es5-jquery`, or `legacy-node`), the source code from either a file upload (`.js` or `.txt`) or a pasted text area, and an optional repository URL.
2. WHEN a Member submits the Import_Form, THE Web_App SHALL validate the input on the server in a Server Action and SHALL NOT trust any client-side validation.
3. THE validation SHALL reject: a missing or blank title or a title longer than 200 characters; a source language outside the three allowed values; source code that is empty or contains only whitespace; source code larger than 102,400 bytes when encoded as UTF-8; source code that is not valid UTF-8 or contains a NUL character; both a file and pasted text at once; and a repository URL that is not an `https://` URL of at most 2,048 characters.
4. IF validation fails, THEN THE Import_Form SHALL redisplay the entered title, language, and pasted text, SHALL show one message per invalid field in English, and SHALL NOT write to the database.
5. THE Web_App SHALL compute `code_hash` on the server as the lowercase hexadecimal SHA-256 digest of the source code encoded as UTF-8, after replacing every CR LF with LF, and SHALL store the same normalized text as `original_code`.
6. WHEN validation succeeds, THE Web_App SHALL insert one row into `public.corpses` with the Server_Client of the request, with `user_id` equal to the id from Claims, `is_sample` `false`, `status` `INFECTED`, the validated title, language, and repository URL, `original_code`, and `code_hash`, and SHALL redirect to the new `/corpses/<id>` page.
7. IF the Member already has an Owned_Corpse with the same `code_hash`, THEN THE Web_App SHALL NOT insert a duplicate and SHALL redirect to the existing corpse with a notice that the code was already imported.
8. IF the Member already has 100 Owned_Corpses, THEN THE Web_App SHALL reject the import with a message that states the limit and SHALL NOT write to the database.
9. IF the database rejects the insert, THEN THE Web_App SHALL show a generic error message, SHALL log the error on the server, and SHALL NOT expose the database error text, a SQLSTATE, or a policy name to the browser.
10. THE import SHALL NOT parse, evaluate, execute, or transform the submitted code beyond the normalization in criterion 5, and SHALL NOT call any LLM provider.
11. THE uploaded file SHALL be read on the server with its size checked before it is decoded, and a file larger than the limit of criterion 3 SHALL be rejected without being fully read into a string.

### Requirement 12: The Crypt

**User Story:** As a Member, I want to see and manage my own corpses, so that my history is private and under my control.

#### Acceptance Criteria

1. THE Crypt SHALL list only the Owned_Corpses of the current Member, in the card format of Requirement 9 criterion 2, ordered by creation date descending, with at most 50 entries per page and "Newer" and "Older" navigation when more exist.
2. THE Crypt SHALL show the number of Owned_Corpses of the Member out of the limit of 100.
3. WHEN a Member has no Owned_Corpses, THE Crypt SHALL show an empty state with a link to `/import`.
4. WHEN a Member confirms a delete, THE Web_App SHALL delete the corpse through a Server Action that verifies the Member (Requirement 5 criterion 8), deletes by `id` with the Server_Client, and redirects to `/crypt`, so that RLS limits the effect to the Member's own rows.
5. THE delete control SHALL require an explicit confirmation step, SHALL use `#e11d48`, and SHALL be unavailable for Sample_Corpses.
6. IF the delete affects zero rows (the corpse is not owned by the Member, is a sample, or no longer exists), THEN THE Web_App SHALL show a non-revealing message ("That corpse could not be deleted") and SHALL NOT report success.
7. WHEN a corpse is deleted, THE database cascade defined by the Foundation SHALL remove its curses, Séance specs, and reincarnations, and THE Web_App SHALL NOT issue separate delete statements for them.

### Requirement 13: Request security

**User Story:** As a security-conscious maintainer, I want the web layer to follow safe defaults, so that common web attacks fail.

#### Acceptance Criteria

1. THE Web_App SHALL send the response headers `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and `Permissions-Policy` with camera, microphone, and geolocation disabled, on every response.
2. THE Web_App SHALL use only Server Actions and POST requests for state changes (import, delete, sign-out), and SHALL NOT change state on a GET request.
3. THE Web_App SHALL rely on the Next.js Server Action origin check, and SHALL NOT disable it or add an `allowedOrigins` entry that is not the application's own origin.
4. THE Web_App SHALL accept the `next` and `redirectTo` values only as Safe_Redirect_Paths, and SHALL reject absolute URLs, protocol-relative URLs (`//host`), backslash forms, and values with control characters.
5. THE Web_App SHALL NOT render any user-supplied value (title, code, repository URL, or `next`) as HTML, and SHALL NOT use `dangerouslySetInnerHTML`.
6. THE Web_App SHALL NOT return a stack trace, a SQL statement, a SQLSTATE, a policy name, or a Supabase error body to the browser, in any page, Server Action result, or Route Handler response.
7. THE Web_App SHALL validate every dynamic route parameter and every form field on the server before using it in a query.
8. THE Web_App SHALL set the `Cache-Control` header of every response that depends on the session to `private, no-store`.

### Requirement 14: Loading, error, and not-found states

**User Story:** As a user, I want predictable feedback when something is slow or wrong, so that the app never looks broken.

#### Acceptance Criteria

1. THE Web_App SHALL provide a root `not-found` page, a root `error` boundary, and a `global-error` boundary in the theme, each with a link back to `/`.
2. THE error boundaries SHALL show a generic message and an optional digest of the error and SHALL NOT show the error message or stack.
3. THE Morgue, the Crypt, and the Corpse_Page SHALL provide a loading state that reserves the layout of the content and does not shift it when the data arrives.
4. IF Supabase is unreachable, THEN THE affected page SHALL show the generic error state of Requirement 8 criterion 7, and the Proxy SHALL NOT block the request.

### Requirement 15: Tests

**User Story:** As a maintainer, I want automated tests for the logic that matters most, so that regressions in security and validation are caught early.

#### Acceptance Criteria

1. WHEN `pnpm test` runs, THE Web_App SHALL execute its Vitest tests in single-run mode and SHALL exit with a non-zero code if at least one test fails, using a Vitest configuration that extends `vitest.shared.ts` of the Workspace_Root.
2. THE Web_App tests SHALL cover the Safe_Redirect_Path function with accepted examples (`/`, `/crypt`, `/corpses/abc?x=1`) and rejected examples (`//evil.test`, `/\evil.test`, `https://evil.test`, `javascript:alert(1)`, a value with a newline, and a value longer than 512 characters), and SHALL include a property-based test (`fast-check`) in which every accepted output starts with a single `/` and parses to a URL with the same origin as a fixed base.
3. THE Web_App tests SHALL cover the Import validation (Requirement 11 criterion 3) with one example per rejection rule and one accepted example, and SHALL cover the `code_hash` computation, including CR LF normalization and non-ASCII text, against known SHA-256 digests.
4. THE Web_App tests SHALL cover the Public_Config validation (Requirement 2 criteria 2 and 3) for missing, blank, malformed, and valid values, and SHALL assert that no error message contains a variable value.
5. THE Web_App tests SHALL cover the mapping from status to Status_Badge (Requirement 9 criterion 3) for all four statuses.
6. THE Web_App tests SHALL cover, with a fake Supabase client, that a Server Action for import, delete, or sign-out called without a Member does not call any write method of the client.
7. THE Web_App tests SHALL assert that the production client bundle contains none of the Server_Only_Variable names.
8. THE Web_App tests SHALL NOT require a database, a network connection, or a Supabase project.

### Requirement 16: Configuration guide

**User Story:** As a new contributor, I want a short guide to configure GitHub sign-in, so that I can run the app locally without guessing.

#### Acceptance Criteria

1. THE Web_App SHALL provide `apps/web/README.md` in English that lists the commands to run the app (`pnpm --filter @lazarus/web dev`, `build`, and `start`) and the variables it needs, referring to `.env.example`.
2. THE README SHALL describe the GitHub OAuth setup: create a GitHub OAuth application whose callback URL is the Supabase Auth callback (`https://<project-ref>.supabase.co/auth/v1/callback`), enable the GitHub provider in the Supabase dashboard with the client id and secret, and add `http://localhost:3000/auth/callback` and the deployed `/auth/callback` URL to the Supabase redirect URL allowlist.
3. THE README SHALL state that Judge_Mode needs no sign-in, that the samples need the Foundation migrations to be applied (`pnpm db:migrate`), and that the app never uses the service role key.
4. THE Web_App SHALL document in `.env.example` any new variable it reads, and SHALL NOT add a variable other than Public_Config. (Amendment: the Server_Only_Variables that later specs read, namely the LLM variables of spec 05 and `LAZARUS_SANDBOX_KILL_SWITCH` of spec 08, are documented in `.env.example` by those specs.)

### Requirement 17: Scope boundary

**User Story:** As a reviewer, I want this spec to stay inside the web shell, so that the review covers only the first web stage.

#### Acceptance Criteria

1. THE Web_App SHALL limit its deliverables to the contents of `apps/web` and to these changes outside it: the `pnpm-lock.yaml` update, and, only if required for Requirement 2 criterion 1, a documented addition to the root `.gitignore` or `turbo.json` (for example the `env` or `globalEnv` keys).
2. THE Web_App SHALL NOT create the Route Handlers `/api/scan`, `/api/seance`, or `/api/reincarnate`, SHALL NOT import `ai`, `@ai-sdk/groq`, or `@ai-sdk/google`, and SHALL NOT read `GROQ_API_KEY` or `LLM_MODEL`.
3. THE Web_App SHALL NOT implement the Hex Scanner, Séance Chamber, or Laboratory screens.
4. THE Web_App SHALL NOT fetch code from a GitHub repository, and the optional repository URL SHALL be stored and displayed as plain metadata only.
5. THE Web_App SHALL NOT run, parse, or evaluate legacy code in any form.

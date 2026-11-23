# GAIK Solution Wizard — basic UI prototype

A standalone Next.js prototype of the GAIK Solution Wizard web UI. It includes:

- **Supabase sign-in** (email + password), with routes protected by the proxy (`proxy.ts`)
- **Session management**: sessions are in the left sidebar on every page (search, rename, ZIP download, delete), and a new session starts from the first message in the start view (`/`), which also gives the session its name. The session's top bar has a row of four gates: it shows where the session is, and clicking a phase opens its steps and the things checked at approval; the user approves the gates.
- **A chat panel with SSE streaming**: a message list (user/assistant) + input. The reply is streamed in real time from a `text/event-stream` endpoint (`/api/sessions/[id]/chat`) one token at a time. The mock reply is step-aware and in the user's language; the chat history is saved in the session data. The actual agent (Claude Agent SDK) is wired in behind the same SSE interface in Sprint 2.
- **A workspace panel** with four tabs: **Workflow** (the official BPMN 2.0 diagram inline with bpmn-js; step 8+), **Blueprint** (a form editor: name/goal/description + step cards, component + options per step; the raw JSON behind the developer view), **Plan** (SME-5: the same content in business language — inputs/steps/outputs/human reviews) and **PoC** ("Run PoC" streams mock logs over SSE to a terminal + status). BPMN V2 started (#34): the customer's reference XML + standard rendering; editing and JSON sync in Sprints 2–3.
- **A design system**: a consistent professional look (teal brand `#0d9488`, slate neutrals). Semantic color/shadow/radius tokens in the `@theme` block of `app/globals.css` (e.g. `bg-surface`, `text-text-muted`, `bg-brand`, status/gate tokens, `term-*`). Use these tokens, not raw Tailwind colors, so the look stays consistent.
- **fi/en language selection**: lightweight cookie-based i18n, switched from the FI/EN selector in the sidebar's user area (next to it are the signed-in user, sign-out and the privacy notice). Works in server rendering and persists across the session.

> **Sessions:** without `WIZARD_API_URL`, state is in-memory mock (`lib/mock-sessions.ts`) — fine for quick UI checks only. **Demo / persistence / editable BPMN:** set `WIZARD_API_URL` (Postgres via `wizard_api`). See [`../WIZARD-DEV.md`](../WIZARD-DEV.md).

This is a prototype for demonstration, not yet a working wizard (chat, BPMN and PoC are placeholders). The stack matches the GAIK demo app (Next.js + Supabase) so that it can later be moved into the demo app as an extension.

## Setup

1. Install the dependencies:
   ```
   npm install
   ```
2. Create a Supabase project (https://supabase.com) or use an existing one. Note the Project URL and the anon/publishable key (Project Settings → API).
3. Copy the environment variables:
   ```
   cp .env.example .env.local
   ```
   and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   Add `WIZARD_ALLOWED_EMAILS` (a comma-separated list): in Supabase mode only the
   listed accounts whose address Supabase has confirmed can sign in, and without the
   variable no one can. For an account you create yourself, choose "Auto Confirm User" or
   confirm the address, otherwise the account cannot sign in. The app has no
   sign-up; create the accounts in Supabase and turn off Supabase's own sign-up
   (Authentication → Sign In / Providers → Allow new users to sign up).
4. Start:
   ```
   npm run dev
   ```
   Open http://localhost:3000 — a user who is not signed in is redirected to `/login`.

## Sign-in

### Supabase sign-in (GAIK demo accounts)

`WIZARD_AUTH_MODE=supabase` signs users in through the GAIK demo's Supabase
project. The mode is chosen at run time, so the same image also works when built
with dev sign-in (`NEXT_PUBLIC_DEV_AUTH=true` is then not used).
The wizard has no sign-up of its own: the account is created in the demo, and
the sign-in page links to the demo's sign-up (`WIZARD_SUPABASE_SIGNUP_URL`,
by default the demo's `/sign-up`).

Only a confirmed email address can sign in, and it must either be in the
`WIZARD_ALLOWED_EMAILS` list or, when `WIZARD_SUPABASE_ACCESS=access_requests`,
have its own row in the demo's `access_requests` table approved (`status = approved`).
The demo's `wizard_access` alone does not let anyone in. The row is read with the user's own session,
so the table's rules (RLS) decide what is visible; a missing or unreadable row does
not let anyone in. An account awaiting approval is signed out and redirected to the
sign-in page with a notice, and an API call without access gets `401`.

| Variable | Meaning |
| --- | --- |
| `WIZARD_AUTH_MODE` | `supabase` selects this mode |
| `WIZARD_SUPABASE_URL`, `WIZARD_SUPABASE_KEY` | the project's URL and public (anon/publishable) key, read at run time; never a secret or service role key |
| `WIZARD_SUPABASE_ACCESS` | `access_requests`: access from the demo's table |
| `WIZARD_SUPABASE_SIGNUP_URL` | the sign-up link; empty hides it |
| `WIZARD_SUPABASE_ACCESS_CACHE_S` | how long an approval is kept as read, default `60`, `0` off; a refusal is not remembered, so an approval shows at once and a revoked approval stops working after this time at the latest |
| `WIZARD_ALLOWED_EMAILS` | additional addresses to let in, comma-separated |

Add the wizard's URL to the redirect list of the demo's Supabase project, and
email confirmation must be on (an unconfirmed address is only a claim).

### Dev sign-in

- The **Sign up** button creates an account. If email confirmation is on in the Supabase project, confirm the link from the email before signing in (or turn confirmation off: Authentication → Providers → Email → Confirm email).
- The **Sign in** button signs you in and takes you to the wizard shell.
- The **Sign out** button in the header.

The dev sign-in cookie is signed and expires in 12 hours
(`lib/dev-session.ts`): a hand-written `gaik_dev_session=dev@gaik.local`
is not a session. The signing key is `DEV_AUTH_SECRET` or, when it is missing,
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (compose and Rahti already set it). If
neither is set, a public fallback is used and a warning is logged,
because the cookie can then be forged again.

Dev sign-in attempts are rate-limited (`lib/login-throttle.ts`): when too many
failed attempts come for the same account or from the same address in a
short time, new attempts are refused for a while with the same generic
"wrong email or password" message (even with the right password), and the
response does not reveal whether the account exists. Successful sign-ins are not counted or
delayed. The audit event `auth.login` (`denied`) then has
`reason: "throttled"`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `WIZARD_DEV_LOGIN_MAX_FAILURES` | `5` | failures in the window before refusing |
| `WIZARD_DEV_LOGIN_WINDOW_S` | `600` | counting window in seconds |
| `WIZARD_DEV_LOGIN_LOCKOUT_S` | `600` | how long refusal lasts, in seconds |
| `WIZARD_TRUSTED_PROXY_HOPS` | not set | how many proxies that append to the `X-Forwarded-For` header are in front (on Rahti the router: `1`) |

The client's address is read from the `X-Forwarded-For` header only when
`WIZARD_TRUSTED_PROXY_HOPS` is set: the address is then the entry that
the last trusted proxy added, not one the client wrote itself. Without the
setting the header is ignored and only the per-account limit applies.

The counters are in memory: the web app runs as a single replica. They reset
on restart and are not shared between processes; more than one
replica would need shared storage (e.g. Redis or Postgres).

## Structure

```
app/
  layout.tsx          root layout (sets <html lang> from the locale)
  (app)/              signed-in user's pages in a shared shell
    layout.tsx        shell: sidebar (sessions, user) + the page beside it
    page.tsx          start view: a single field that starts a session
    sessions/[id]/
      page.tsx        session view (top bar and gate row, workspace, chat)
      actions.ts      server actions: advance / regress / approve / reopen
  actions.ts          server actions: startSessionFromMessage, renameSession, removeSession
  locale-actions.ts   server action: setLocale (language switch)
  api/sessions/
    route.ts          POST: new session without a first message (tests, scripts)
  api/sessions/[id]/chat/
    route.ts          SSE streaming endpoint for the chat (mock) reply
    stop/route.ts     POST: stops a reply in progress (the send button is then "Stop")
  login/
    page.tsx          sign-in/sign-up form
    actions.ts        server actions: login / signup / signOut
components/
  sidebar.tsx         sidebar (client): sessions, new session, user area
  start-view.tsx      start view (client): the first message creates the session
  session-bar.tsx     session top bar: name and gate row (gate-timeline.tsx)
  locale-switcher.tsx FI/EN language selector
  chat-panel.tsx      chat panel (client; reads the SSE stream, updates in real time)
  workspace-panel.tsx workspace panel (client; Workflow diagram + Blueprint JSON)
lib/
  current-user.ts     shared getCurrentUser (dev cookie or Supabase)
  mock-sessions.ts    session model + mock data store (in memory)
  i18n.ts             dictionaries (fi/en) + getLocale/getI18n
  auth.ts             dev mode constants
  supabase/
    client.ts         browser-side Supabase client
    server.ts         server-side Supabase client
    middleware.ts     session refresh + route protection
proxy.ts              Next.js proxy hook (middleware.ts in Next.js 15)
```

## Tests and quality

```bash
npm run test          # unit (vitest)
npm run test:e2e      # UI against the mock store (Playwright)
npm run test:all      # both
npm run test:stack    # real wizard_api + Postgres (Docker, *-stack specs)
npm run acceptance    # generates docs/sprint3-acceptance.md
npm run lint          # ESLint CLI, config in eslint.config.mjs
```

`npm run test:e2e` does not cover the `*-stack` or `local-agent` specs: they skip
themselves without the `PLAYWRIGHT_STACK_E2E` / `PLAYWRIGHT_AGENT_E2E` variable. Which
acceptance criteria are left outside the PR run is shown in the matrix
[`docs/sprint3-acceptance.md`](docs/sprint3-acceptance.md) — the stack run goes
nightly in the `wizard-v2-acceptance.yml` workflow.

Full stack + CI: [`../WIZARD-DEV.md`](../WIZARD-DEV.md). Security: [`docs/SECURITY.md`](docs/SECURITY.md).

## Logging

Structured JSON logging (`pino`, `lib/logger.ts`) on every API route
through the `withLogging` wrapper (`lib/with-logging.ts`): `traceId`, event,
HTTP status and duration for every request. Auth, session and
blueprint/BPMN changes are also logged as audit events
(`lib/audit.ts`). `traceId` travels in the `x-trace-id` header from the proxy (`proxy.ts`)
onwards and is also passed on to `wizard_api` calls. The user appears in logs and
audit events as a pseudonym (`u_` + 16 hex characters, `lib/actor-id.ts`),
not as an email address: the same person always gets the same identifier, but the address
is not in the log. The identifier is computed with the key `WIZARD_PSEUDONYM_KEY` or, when that is
missing, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`; without either it is a plain
hash and a warning is logged once. In `wizard_api`, sessions are owned by an
owner identifier computed with the same key (`o_` + 32 hex characters,
`lib/owner-id.ts`), not by the address. Do not change the key in an environment
in use: a new key gives everyone a new identifier, and old
sessions no longer show for their owner. No passwords, tokens,
cookies or full blueprint/chat content in the logs.

Reading the logs in development:

```bash
npm run dev | npx pino-pretty
```

The default level is `debug` in development and `info` in production (`lib/logger.ts`);
override it with the `LOG_LEVEL` environment variable when needed (`warn`/`error` shows
less). Without piping through `pino-pretty`, logs print as one
JSON line per event (easy to grep by `traceId`).

## Next steps

- ~~Replace `mock-sessions.ts` with real persistence~~ → `WIZARD_API_URL` + `lib/sessions.ts` (Sprint 1)
- Chat: connect the SSE endpoint's mock reply to the real agent (Claude Agent SDK, Sprint 2)
- Workflow: bpmn-js Modeler + blueprint JSON sync + dynamic BPMN generation (V2 #34)
- Production sign-in (HAKA / Entra ID) instead of Supabase, if the client decides so

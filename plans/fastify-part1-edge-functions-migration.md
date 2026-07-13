# Part 1 — Fastify Server: Edge Function Migration (Detailed Plan)

Scope: replace all 21 Supabase edge functions with Fastify routes on Railway.
Out of scope: RPC proxying, auth, storage uploads, business-logic rewrites.

Organizing constraint: **testability first**. Every architectural choice in
Steps 0–2 exists to make route handlers testable in-process with no network,
no Docker, and no external accounts. Definition of done for every route:
unit tests against fakes, an idempotency (run-twice) test where the route is
webhook/cron-invoked, and a parity fixture proving response compatibility
with the edge function it replaces.

## Step 0 — Scaffold and deploy the skeleton

- New workspace `server/` at repo root (sibling of `render-worker/`, reusing
  its Node tooling conventions).
- **App factory, no top-level side effects:** `buildApp(deps): FastifyInstance`
  takes every external dependency as a parameter (db pool, stripe, mux, s3,
  email, renderWorker, transcription, clock). `server.ts` is a 10-line
  entrypoint that builds real deps from env and calls `listen()`; tests call
  `buildApp(fakeDeps)` and drive it with `app.inject()` — full HTTP semantics
  (routing, validation, auth hooks, serialization) with zero network.
- Fastify + `@sinclair/typebox` type provider; `@fastify/cors`,
  `@fastify/rate-limit`, `@sentry/node` (existing Sentry project),
  `pg` pool → Supavisor (transaction mode).
- **Response schemas on every route**, not just request schemas — Fastify
  enforces them at serialization time, so a handler returning a shape the
  client doesn't expect fails loudly in tests instead of silently in prod.
- `GET /health` route, plus the first test file: `health.test.ts` using
  `app.inject()` — proves the harness before any real route exists.
- Vitest workspace entry for `server/` in the existing root `vitest.config.ts`.
- Railway service: GitHub-triggered deploy, region matched to Supabase,
  always-on, usage caps set. Env vars copied from Supabase edge function
  secrets (Stripe, Mux, AWS, transcription API, email provider, SUPABASE_URL,
  SUPABASE_JWT_SECRET, SERVICE_ROLE_KEY). **CI runs `server/` tests on every
  PR; Railway deploy blocked on green tests.**
- Uptime monitor pinging `/health`.

**Gate:** skeleton deployed, green health check, Sentry receiving a test
event, and `app.inject()` test suite running in CI.

## Step 0.5 — Ports and fakes for external services

Define one small interface ("port") per external dependency, sized to what
the routes actually use — not a general SDK wrapper:

| Port | Real adapter | Fake for tests |
|---|---|---|
| `Db` | pg pool → Supavisor | test Postgres (local `supabase start` DB) — SQL is not faked |
| `StripePort` (checkout, portal, seats, subscription events) | stripe SDK | in-memory fake recording calls, returning canned sessions |
| `MuxPort` (create asset, validate signature) | mux SDK | fake with deterministic asset ids |
| `S3Port` (presign get/put, multipart) | AWS SDK v3 | fake returning `https://fake-s3/...` URLs, recording keys |
| `EmailPort` (welcome, invite, unsubscribe) | provider SDK | fake capturing sent messages for assertion |
| `RenderWorkerPort` (submit job) | fetch to worker | fake recording submissions |
| `TranscriptionPort` | external API | fake returning fixture transcripts |
| `Clock` (`now()`) | `Date` | fixed/steppable fake — stale-job and expiry logic becomes deterministic |

Rules:
- Route handlers never import an SDK directly; only adapters do.
- Adapters stay thin (translation only, no branching logic) so the untested
  surface is minimal; each real adapter gets one narrow integration test
  (test-mode Stripe key, Mux sandbox, real S3 bucket) run in a separate
  CI job that's allowed to be slow/optional.
- Fakes live in `server/test/fakes/` and are the default in every unit test.

## Step 0.6 — Parity fixture harness

The migration-specific safety net: prove each Fastify route is
request/response-compatible with the edge function it replaces, using
recorded traffic rather than re-derived expectations.

- Before porting a function, capture fixtures from the edge function running
  on the local Supabase stack (`supabase functions serve`) with seeded data —
  not production. For each meaningful case (success, auth failure, validation
  failure, domain error), record request (method, headers minus secrets,
  body) and response (status, body) as JSON files in
  `server/test/fixtures/parity/<function-name>/`.
- Parity test runner: replays each fixture through `app.inject()` against
  `buildApp(fakeDeps)` (db pointed at the same seeded local Postgres) and
  diffs status + body. Header differences are expected and ignored except
  `content-type`.
- Known-acceptable diffs (e.g. better validation messages) are recorded per
  fixture as an explicit allowlist entry, never by loosening the diff.

This makes "did the port change behavior?" a test failure instead of a
production incident, and the fixtures double as documentation of each edge
function's actual contract — which today exists only as untyped Deno code.

## Step 0.7 — Logging foundation

Pino (built into Fastify), structured JSON to stdout. The log analytics
backend is deliberately out of scope for now — the destination is a
config-only change later (app-side pino transport); the field discipline
below is the part that cannot be retrofitted and must land before the first
real route.

**One canonical event per request, emitted centrally.** Route handlers do
not call the logger for request-shaped work. A single `onResponse` hook
emits one wide event per request; handlers contribute fields to a
request-scoped context (`req.logCtx.set({ 'render.job_id': id })`) that the
hook folds in. Direct log calls are reserved for non-request work (startup,
cron runs, background retries).

**Fixed envelope on every event, attached automatically** (pino child logger
per request, never hand-typed): `timestamp`, `level`, `service`, `env`,
`version` (git SHA), `request_id`, `http.route`, `http.request.method`,
`http.response.status_code`, `duration_ms`, `user_id`.

**Naming rules:**
- snake_case; units in the name (`duration_ms`, `body_size_bytes`).
- Domain fields namespaced: `render.job_id`, `stripe.event_type`,
  `mux.asset_id`, `project.id`.
- `http.route` is the route template (`/projects/:id`), never the raw URL.
- `error_type` is a stable enum (`RenderWorkerTimeout`,
  `StripeSignatureInvalid`), not a message string — dashboards and alerts
  key off it.
- Never spread raw objects into a log; pick fields explicitly.
- Prefer OTEL semantic convention names where one exists, so a later OTEL
  adoption is additive.

**Level policy** (lives in `server/README.md`, ten lines, enforced in
review):
- `error` — a human should look; alerting keys off this. If it fires weekly
  and nobody acts, demote it.
- `warn` — unexpected but handled: retry succeeded, fallback used, invalid
  webhook signature rejected. Reviewed in aggregate, never paged.
- `info` — the canonical request event + real business events
  (`render_job.completed`, `subscription.changed`).
- `debug` — dev only, off in production.

**Enforcement (ties into the testability constraint):**
- Typed logger surface: envelope + known domain fields as TS types; business
  events declared in a typed catalog (`logEvent('render_job.completed', ...)`
  with a union of event names) so a typo'd field or event is a compile
  error, and the catalog file serves as the living schema.
- Pino `redact` config as PII/secret backstop (`authorization`, tokens,
  email addresses).
- ESLint ban on `console.*` in `server/`.
- Pino writes to an injectable stream, so unit tests can assert emitted
  events ("this failure logs `error_type: RenderWorkerTimeout` at `error`") —
  the alerting contract is itself tested.
- `request_id` is propagated as a header on outbound render-worker calls —
  poor man's trace now, trace parent later.

**Sentry correlation:** every Sentry event is tagged with the same
`request_id`, so an exception links to its full request context in the logs.

## Step 1 — Auth plugin (port `_shared/auth.ts`)

- `requireUser` preHandler: validate the `Authorization: Bearer` JWT against
  `SUPABASE_JWT_SECRET` via `@fastify/jwt` (no network call to Supabase —
  faster than the current `auth.getUser()` roundtrip). Attach `userId` to the
  request. Reject → 401 (client's existing 401 fetch wrapper handles logout).
- `requireWebhookSignature` variants: Stripe (`stripe.webhooks.constructEvent`
  on the raw body — register a raw-body content parser for these routes),
  Mux signature validation, render-worker bearer token.
- Contract test: a real Supabase-issued token validates; expired/garbage
  tokens 401.

## Step 2 — Port `_shared` helpers Deno → Node

- Email templates, Mux upload helpers, Sentry wrapper, S3 presigned URL
  generation (AWS SDK v3 — already npm-compatible).
- Mechanical changes: `npm:` specifiers → package.json deps, `Deno.env.get`
  → `process.env`, Deno serve handler shape → Fastify route handlers.

## Step 3 — Client API module

- `webapp/src/api/client.ts`: thin `fetch` wrapper — base URL from env
  (`VITE_API_URL`), attaches the current Supabase access token, JSON
  in/out, funnels 401 through the existing unauthorized handler.
- Route-by-route, `supabase.functions.invoke('x')` → `api.post('/x')`
  (~13 call sites). Keep response shapes identical — no client type changes.

## Step 4 — Migrate routes in risk order

Each route: capture parity fixtures → port → **write its tests** → tests
green (end-to-end + parity + idempotency where applicable) → deploy → switch
traffic → observe → **pause**. Tests are part of each function's migration,
written alongside the port and never deferred to a follow-up — a function
without green tests does not cut over, and we do not move to the next
function. One function at a time; after each function's cutover, stop and
wait for explicit go-ahead before starting the next. No batching within a
wave unless explicitly requested.

### Per-function SQL migration rule

When an edge function calls Postgres functions, the SQL logic migrates to
TypeScript **together with that edge function** — the migrated route is
self-contained server code, not a shell around SQL — with one guard rail:

- **DB function used only by this edge function** (or only by edge functions
  already migrated): port its logic into the route's service code. The SQL
  function stays in Supabase untouched (consistent with the no-delete rule)
  but is no longer called; note it in the Step 5 decommission checklist.
- **DB function shared with client-called RPCs or not-yet-migrated edge
  functions**: keep calling it as SQL via the Db port. Never fork the logic
  into a TS copy while a SQL copy is still live — two implementations of one
  rule is how they drift apart. These migrate in Part 2/3 when their last
  SQL caller goes away.

First task per function: list the DB functions it calls and classify each as
exclusive vs. shared (grep `supabase/sql/functions/` callers + the client's
`supabase.rpc(...)` names). The parity fixtures gate the ported logic: same
inputs must produce the same response **and the same resulting DB state** as
the edge function + SQL pair they replace.

### Per-function analysis pass (simplification / cleanup)

Migration is the one moment every function gets read closely — use it.
Before porting each function, do a short written analysis (a paragraph in
the PR description):

- **Dead weight:** unused params, unreachable branches, queries whose
  results are never used, copy-paste residue from sibling functions.
- **Simplification:** redundant round trips (N queries collapsible into
  one), duplicated validation the TypeBox schema now handles, logic that
  collapses given the TS + real-pool context (e.g. per-request client
  construction that a pooled server doesn't need).
- **Consistency:** error responses, status codes, and naming normalized to
  the server's conventions instead of each function's ad-hoc style.
- **Smells worth flagging but NOT fixing now:** anything that would change
  behavior beyond the allowlist — record it in the plan/issue tracker
  instead.

Discipline: simplification must not silently change the contract. Anything
that alters an observable response lands as an explicit parity-allowlist
entry (Step 0.6) with a one-line justification — the diff between "cleaner"
and "different" stays visible. Internal cleanups (fewer queries, clearer
code) need no allowlist entry, but the end-to-end tests must still pass
against the same seeded data and expected DB state.

### Per-function testing: end-to-end against a real seeded database

The primary test for every migrated function is end-to-end through the real
stack: `app.inject()` → auth plugin → handler → migrated TS logic → **a real
local Postgres** (from `supabase start`, with all migrations applied). Only
third-party services (Stripe, Mux, S3, email, render worker, transcription)
are faked — the database never is. A DB mock would only verify that the mock
returns what the test told it to; the whole migration risk lives in whether
the TS logic behaves like the old SQL against real data (constraints, nulls,
transactions, permission checks), and only a real database exercises that.

Mechanics:
- Seed helpers / test-data builders (`createUser()`, `createWorkspace({...})`,
  `createProject({...})`) shared across the suite, built on the existing
  `test/helpers/supabaseClient.ts` patterns.
- Isolation: each test truncates the affected tables (or wraps in a rolled-
  back transaction) so tests are order-independent.
- Assertions check both the HTTP response and the resulting DB state.

**Nothing is ever deleted from Supabase in this plan.** Edge functions stay
deployed (idle) after their route cuts over, pg_cron entries stay in place —
decommissioning is a manual step done by hand at the very end (Step 5 is a
checklist for it, not work this migration performs). This keeps rollback for
any route a pure URL/env repoint for the entire duration of Part 1.

Idempotency tests are mandatory for every scheduled job, webhook, and
DB-triggered route (Waves C, D, E): the test invokes the handler twice with
the identical payload and asserts the second run is a no-op (same DB state,
no duplicate email/side effect recorded in the fakes). This encodes the
retry-safety requirement from the overview plan as an executable check
rather than a review guideline.

Webhooks go **last**, deliberately: they require provider-side configuration
changes (Stripe dashboard, Mux dashboard, render-worker callback URL) and are
the hardest to e2e test. By the time they migrate, the server, auth plugin,
ports, and parity harness are proven on lower-stakes routes.

### Wave A — Client-invoked, low risk (simple request/response)
1. `storage-download-urls` (S3 presign)
2. `shared-video-get` (public, no auth — add rate limit)
3. `stripe-checkout`, `stripe-portal`, `stripe-add-seats`,
   `subscription-change` (these call Stripe's API but are plain
   request/response — no Stripe dashboard changes needed, unlike webhooks)
4. `send-workspace-invite`
5. `unsubscribe` (public link target — this is a URL in sent emails; keep the
   old edge function alive as a redirect, or accept that old emails break,
   or proxy the old URL. Decide before cutover.)
6. `project-update-thumbnail`

### Wave B — Client-invoked, heavier flows
7. `asset-create` (S3 multipart via AWS SDK)
8. `transcribe` (external API call; longer request — no timeout ceiling on
   Railway, but add a server-side timeout + Sentry breadcrumb)
9. `mux-video-create` (talks to Mux + render worker)
10. `render-job-create` (S3 presigned URLs + render-worker submission).
    Keeps handing out the **existing Supabase `render-job-hook` URL** as the
    `statusCallbackUrl` until Wave D — only job submission moves now, the
    callback stays on the edge function.
11. `project-create` (legacy editor upload flow)
12. `project-create-v2` — port the function, but the TUS upload itself keeps
    going to Supabase Storage REST (storage migration is Part 4). Only the
    project-row orchestration moves.

### Wave C — Scheduled jobs (in-process scheduler, not pg_cron→HTTP)
The 5 pure-SQL pg_cron jobs (`cron_cleanup_expired_projects`,
`cron_cleanup_pending_assets`, `cron_mux_video_stale_jobs`,
`cron_render_purge`, `cron_render_stale_jobs`) never touch the server —
they stay in pg_cron, untouched, indefinitely.

The 2 crons that call edge functions become **in-process server jobs** —
no HTTP surface, no bearer tokens, no pg_cron URL config:
13. `purge-deleted-projects`
14. `mux-video-purge`
Their pg_cron entries are **not** deleted — the user disables/removes them
manually at final decommission. Until then both the old cron and the new
server job may run in overlap; this is harmless because both jobs are
delete-by-condition (the second runner finds nothing to delete).

**Scheduler design (deliberately minimal):**
- A job is a plain function taking injected deps (ports + `Clock`) — unit
  tested exactly like route handlers, no scheduler involved in tests.
- One `setInterval` tick (hourly) plus a tick on startup. Each tick, for each
  registered job: compute the current due period (daily → today's date),
  claim it via `INSERT INTO job_runs (job_name, run_date) ... ON CONFLICT DO
  NOTHING`; if the insert won, run the job.
- This survives deploys and restarts (a missed 3am tick is caught by the next
  tick or the startup tick — the claim is keyed on the *date*, not the
  clock time), never double-runs (the ledger row is the lock, so it stays
  correct even if Railway ever runs two instances), and needs zero new
  infrastructure. Both jobs are delete-by-condition, so re-runs are
  naturally idempotent anyway.
- The `job_runs` table doubles as the audit log: "did yesterday's purge run?"
  is a SELECT.

### Wave D — Webhooks (last: provider-side config + hardest e2e)
15. `render-job-hook` — after cutover, `render-job-create` switches the
    `statusCallbackUrl` it hands out (completes Wave B #10); render worker
    honors both URLs during overlap so in-flight jobs finish cleanly.
16. `mux-video-hook` — repoint webhook URL in Mux dashboard.
17. `stripe-webhooks` — add a second webhook endpoint in Stripe pointing at
    Fastify, verify events arrive and are handled, then disable the Supabase
    endpoint. Handlers must be idempotent (Stripe redelivers): upsert
    subscription state, keyed on event id (processed-events ledger table).

### Wave E — DB-triggered
18. `send-welcome-email` — the `auth.users` trigger calls an HTTP endpoint;
    repoint the trigger's URL (pg_net) at Fastify, bearer-token protected.
    Idempotent: welcome-email-sent flag on the profile row (trigger retries
    must not double-send).

## Step 5 — Decommission (manual, done by hand at the very end)

This step is **not performed by the migration** — it is a checklist for the
user to execute manually once all waves have soaked:

- Verify: `grep -r "functions.invoke" webapp/` returns nothing; Supabase
  dashboard shows zero edge function invocations over a full week.
- Delete edge functions from the Supabase project.
- Remove the pg_cron entries for `cron_purge_deleted_projects` and
  `cron_mux_video_purge` (the 5 pure-SQL crons stay).
- Drop the orphaned SQL functions whose logic migrated to TS (each function's
  migration PR lists the DB functions it orphaned — collect them here as the
  waves progress).
- Remove `supabase/functions/` deploy from CI/scripts; keep `_shared` history.

## Testing strategy — the pyramid

**End-to-end per function (the primary tier — definition of done):**
`app.inject()` against `buildApp()` with a **real seeded local Postgres**
(`supabase start`) and fakes only for third parties. One suite per migrated
function, written with the port, exercising the full path: routing, TypeBox
validation, auth (real Supabase-issued JWTs via the existing
`test/helpers/supabaseClient.ts` patterns), the migrated TS/SQL logic, and
the resulting DB state. Parity fixture replays (Step 0.6) live here. See
"Per-function testing" in Step 4 for seeding/isolation mechanics.

**Unit (fast, no Docker, for logic that doesn't touch the DB):** same
`app.inject()` harness with all fakes. Covers validation edges, error
mapping, and side effects asserted via the fakes (which email was sent,
which S3 key was presigned, what was submitted to the render worker). Fixed
`Clock` makes expiry/stale logic deterministic.

**Adapter contract tests (narrowest, separate CI job, allowed slow):** one
test per real adapter against sandbox/test-mode services — Stripe test key,
Mux sandbox, a real S3 bucket. These verify the thin translation layer the
fakes can't.

**Webhook signature tests:** replay captured Stripe/Mux payloads with valid
test-mode signatures; assert both acceptance of valid and rejection of
tampered payloads. Raw-body handling (the classic Stripe footgun) is covered
here.

**Cutover smoke (manual, per wave):** checklist in the PR description —
which URLs were repointed, where the rollback switch is, what was observed
after switching.

CI gates: end-to-end + unit suites block merge; adapter contract job is
scheduled/optional so third-party sandbox flakiness never blocks the
pipeline.

## Rollback

Every cutover is a URL/env change, not a code dependency: repoint the webhook
/ cron job / `VITE_API_URL` back to the Supabase edge function. Since nothing
is ever deleted from Supabase during the migration (decommission is manual,
at the very end), every route remains rollback-able for the entire duration
of Part 1. No data migrations occur in Part 1.

## Estimated shape

- Step 0–3 (skeleton, ports/fakes, parity harness, logging foundation, auth,
  helpers, client module): the foundation chunk — deliberately front-loaded. The ports and
  parity harness feel like overhead before the first route ships, but they
  are what make Waves A–E mechanical instead of risky, and they're the whole
  point of the testability focus.
- Wave A: mechanical, batchable — the first proof that the fake/parity
  harness pays off, on the lowest-stakes routes.
- Wave B: the fiddly 30% — S3 multipart, render-worker coordination. Budget
  most of the review attention here; also where the fakes (S3Port,
  RenderWorkerPort) earn their keep, since the real services are the hardest
  to exercise manually.
- Waves C–E: small code, but each involves external configuration (deleting
  pg_cron entries, Stripe/Mux dashboards, pg_net trigger URL) — the risk is
  in the cutover choreography, not the handlers, which is exactly why they
  come after the server is proven.

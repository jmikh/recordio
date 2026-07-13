# Supabase → Fastify Migration: High-Level Plan

## Goal

Move the backend API off Supabase Edge Functions (Deno) into a single long-lived
Fastify (Node/TS) server hosted on Railway, incrementally and with no big-bang
cutover. Postgres stays managed (Supabase) throughout. Auth and storage move
last — or never, if the hybrid end state proves stable.

## Current surface (inventory as of 2026-07-10)

- 21 Deno edge functions (`supabase/functions/`), all `verify_jwt = false` with
  manual JWT validation via `_shared/auth.ts`
- 33 client-called Postgres RPCs (SECURITY DEFINER), ~40 call sites
- Supabase Auth: Google OAuth + password, JWT 1h expiry, `AuthManager.ts`
- Storage: one private bucket `project-media`; TUS resumable uploads via
  Supabase Storage REST + one RLS path policy; downloads via self-generated S3
  presigned URLs
- 7 pg_cron jobs (some call edge functions over HTTP)
- No Realtime usage, no direct PostgREST table access (all RLS policies dropped)
- Existing non-Supabase services: render-worker (Node), Cloudflare Pages
  functions (Mixpanel/Sentry proxies)

## Guiding principles

- Ship value at every phase; each phase is independently stoppable.
- Every rule has exactly one live implementation. DB functions used *only*
  by an edge function migrate to TypeScript together with that edge function
  in Part 1 (tested end-to-end against a real seeded Postgres); DB functions
  shared with client-called RPCs stay SQL — never forked into a TS copy —
  until their last SQL caller migrates in Part 2/3.
- Auth stays on Supabase until everything else is proven on Fastify.
- Every migrated route must be idempotent-safe for webhook/cron retries.
- **Testability is an architecture constraint, not a phase.** The server is
  built as a dependency-injected app factory (`buildApp(deps)`) with every
  external service (Stripe, Mux, S3, email, render worker, transcription,
  clock) behind a small port interface with an in-memory fake. A route is not
  "done" until it has comprehensive tests (e2e against a real seeded local
  Postgres + unit against fakes), an idempotency (run-twice) test where
  applicable, its client call site switched behind the
  `USE_SERVER_INSTEAD_OF_SUPA` flag, and manual local verification by the
  user. (Parity fixtures were dropped 2026-07-13 — the edge functions are
  too untested for recorded traffic to be a trustworthy oracle.) This is
  the main payoff of leaving Deno edge functions — the current code has no
  test seam at all.

## Phases

### Part 1 — Stand up Fastify server; migrate edge functions
(Detailed in `fastify-part1-edge-functions-migration.md`)

**Status 2026-07-13:** foundation done — server deployed on Railway (health +
Sentry verified), ports/fakes, logging foundation, auth plugin (dual-alg JWT:
HS256 secret + ES256 JWKS) all landed with tests. Parity-fixture step dropped;
per-function comprehensive tests + `USE_SERVER_INSTEAD_OF_SUPA` client flag +
manual local verification instead. Next: client API module (Step 3), then the
first function (`storage-download-urls`).

Scaffold `server/` (Fastify + TypeBox), deploy to Railway, validate Supabase
JWTs, then port all 21 edge functions route-by-route in risk order:
client-invoked routes first, scheduled jobs next, **webhooks last** (they
need provider-side config changes and are the hardest to e2e test — migrate
them once the server is proven on lower-stakes routes). Client swaps
`supabase.functions.invoke()` for a thin fetch-based API client. The two
edge-function crons move onto a minimal in-process scheduler (hourly tick +
`job_runs` ledger keyed on date); pure-SQL pg_cron jobs are untouched.

Each migrated function is self-contained server code: DB functions called
exclusively by that edge function have their SQL logic ported into TS in the
same step (shared DB functions keep being called as SQL — see guiding
principles), and each function ships with end-to-end tests against a real
seeded Postgres before anything cuts over.

Cadence: **one function at a time, pausing after each cutover** for explicit
go-ahead before the next; tests are written with each function, never
deferred. **Nothing is deleted from Supabase** — edge
functions and pg_cron entries stay in place (idle) throughout; the user
decommissions them manually at the very end, so every route stays
rollback-able for the entire migration.

**Exit criteria:** all traffic served by Fastify (webhooks repointed, the two
former edge-function crons running on the server's scheduler with ledger rows
proving daily runs, client no longer calls `functions.invoke`); edge
functions still deployed but idle, awaiting manual decommission.

### Part 2 — Proxy RPCs through Fastify

Add Fastify routes that call the existing Postgres functions
(`SELECT * FROM project_list(...)`) via a pooled connection (Supavisor).
Client swaps `supabase.rpc()` for the API client. No SQL logic rewritten.

**Exit criteria:** `supabase-js` is used only for auth and TUS storage uploads.

### Part 3 — Business logic consolidation (optional, ongoing)

Migrate the remaining Postgres functions into TypeScript service code where
it helps (testability, shared types, complex logic) — Part 1 already
absorbed the edge-function-exclusive ones, so what's left here is the SQL
shared with client-called RPCs, unlocked as Part 2 moves their callers
server-side. Keep pure-data-access functions in SQL. No deadline; driven by
pain, not principle. The port/fake architecture from Part 1 is what makes
this phase cheap: logic pulled into TS lands in already-testable service
code, and each migrated function keeps the same acceptance criterion (same
inputs → same rows/response as the SQL version), asserted by e2e tests.

### Part 4 — Storage

Replace the TUS-over-Supabase-Storage upload path (`project-create-v2` flow)
with either tus-node-server on Fastify or direct-to-S3 presigned multipart
uploads. Reimplement the `auth.uid()` path restriction in app code. Downloads
already use self-generated S3 presigned URLs — no change.

### Part 5 — Auth (decision gate, not a commitment)

Only if there is a concrete driver (pricing, feature gap, platform risk).
Options: Better Auth on Fastify, or keep Supabase Auth permanently
("Supabase as auth + Postgres host" is an acceptable end state).
Involves: OAuth flows, session/JWT issuance, user identity migration,
`AuthManager.ts` rewrite, welcome-email trigger replacement.

### Part 6 — Scheduled jobs review

Split ownership after Part 1: pure-SQL jobs stay in pg_cron (it lives in
Postgres and survives all phases); jobs needing server code run on the
server's in-process scheduler (hourly tick + `job_runs` date-keyed ledger —
survives deploys, never double-runs, auditable via SELECT). New scheduled
work defaults to the server scheduler unless it's pure SQL. Revisit only if
job volume or precision requirements outgrow the daily-tick model.

## Infrastructure decisions (made)

- **Framework:** Fastify + TypeBox (schema-first validation, typed routes)
- **Hosting:** Railway, always-on (no app sleeping — webhooks), usage caps set,
  region matched to the Supabase project region
- **DB access:** Supavisor pooler from Fastify's connection pool
- **Logging:** structured pino JSON with a fixed envelope, a documented level
  policy, and one canonical wide event per request emitted by a central hook
  (see Part 1, "Logging foundation"). Field names lean on OTEL semantic
  conventions. The log analytics backend is deliberately deferred — logs go
  to stdout (Railway log viewer) for now, shipped via an app-side pino
  transport later; the field discipline is the part that can't be
  retrofitted, the destination is config.
- **Monitoring:** existing Sentry project (correlated to logs by request_id)
  + uptime ping on `/health`. Per-route throughput/status/latency comes from
  Sentry tracing initially (100% sample rate at current traffic — exact
  counts, no new vendor). A dedicated log-analytics backend is a later,
  trigger-based addition: adopt one only when an ad-hoc question the logs
  could answer can't be asked in Sentry/Railway, or retention bites.
- **Deploys:** GitHub-triggered Railway deploys; PR preview environments

## Risks

| Risk | Mitigation |
|---|---|
| Webhook loss during cutover | Cut one provider at a time; providers retry (Stripe 3 days, Mux retries); verify signatures before switching |
| Cross-provider DB latency | Region-match Railway ↔ Supabase; pooled connections |
| JWT validation drift | Single shared auth plugin validating Supabase JWTs; contract tests against a real token |
| Duplicate cron/webhook execution during overlap windows | Idempotent handlers (upsert, job-run ledger) — required in Part 1 |
| Auth migration scope creep | Explicit decision gate at Part 5; hybrid end state is acceptable |

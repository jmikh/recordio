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
- Postgres functions remain the business-logic source of truth initially;
  Fastify proxies to them. Pull logic into TS later, function by function.
- Auth stays on Supabase until everything else is proven on Fastify.
- Every migrated route must be idempotent-safe for webhook/cron retries.
- **Testability is an architecture constraint, not a phase.** The server is
  built as a dependency-injected app factory (`buildApp(deps)`) with every
  external service (Stripe, Mux, S3, email, render worker, transcription,
  clock) behind a small port interface with an in-memory fake. A route is not
  "done" until it has unit tests against fakes, an idempotency (run-twice)
  test where applicable, and a parity fixture proving it matches the edge
  function it replaces. This is the main payoff of leaving Deno edge
  functions — the current code has no test seam at all.

## Phases

### Part 1 — Stand up Fastify server; migrate edge functions
(Detailed in `fastify-part1-edge-functions-migration.md`)

Scaffold `server/` (Fastify + TypeBox), deploy to Railway, validate Supabase
JWTs, then port all 21 edge functions route-by-route in risk order: webhooks →
cron targets → client-invoked. Client swaps `supabase.functions.invoke()` for a
thin fetch-based API client. Supabase edge functions are deleted as each route
cuts over.

**Exit criteria:** zero edge functions deployed; all webhooks (Stripe, Mux,
render-worker) and pg_cron HTTP jobs point at Fastify; client no longer calls
`functions.invoke`.

### Part 2 — Proxy RPCs through Fastify

Add Fastify routes that call the existing Postgres functions
(`SELECT * FROM project_list(...)`) via a pooled connection (Supavisor).
Client swaps `supabase.rpc()` for the API client. No SQL logic rewritten.

**Exit criteria:** `supabase-js` is used only for auth and TUS storage uploads.

### Part 3 — Business logic consolidation (optional, ongoing)

Migrate individual Postgres functions into TypeScript service code where it
helps (testability, shared types, complex logic). Keep pure-data-access
functions in SQL. No deadline; driven by pain, not principle. The port/fake
architecture from Part 1 is what makes this phase cheap: logic pulled into TS
lands in already-testable service code, and each migrated function inherits
the parity-fixture pattern (same inputs → same rows/response as the SQL
version) as its acceptance test.

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

pg_cron survives all phases (it lives in Postgres). After Part 1 its HTTP jobs
target Fastify routes. Optionally consolidate pure-SQL cron jobs vs. HTTP jobs;
keep pg_cron as the scheduler for durability (survives deploys/restarts).

## Infrastructure decisions (made)

- **Framework:** Fastify + TypeBox (schema-first validation, typed routes)
- **Hosting:** Railway, always-on (no app sleeping — webhooks), usage caps set,
  region matched to the Supabase project region
- **DB access:** Supavisor pooler from Fastify's connection pool
- **Monitoring:** existing Sentry project + Railway logs + uptime ping on `/health`
- **Deploys:** GitHub-triggered Railway deploys; PR preview environments

## Risks

| Risk | Mitigation |
|---|---|
| Webhook loss during cutover | Cut one provider at a time; providers retry (Stripe 3 days, Mux retries); verify signatures before switching |
| Cross-provider DB latency | Region-match Railway ↔ Supabase; pooled connections |
| JWT validation drift | Single shared auth plugin validating Supabase JWTs; contract tests against a real token |
| Duplicate cron/webhook execution during overlap windows | Idempotent handlers (upsert, job-run ledger) — required in Part 1 |
| Auth migration scope creep | Explicit decision gate at Part 5; hybrid end state is acceptable |

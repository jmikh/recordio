# Server

Fastify API server replacing the Supabase edge functions. Hosted on Railway;
Postgres stays on Supabase, reached through the Supavisor pooler.

**Migration plan and current status:**
`plans/fastify-part1-edge-functions-migration.md` (see its Status section —
that file is the source of truth for what's done and what's next).

## Architecture

- **App factory, no top-level side effects:** `buildApp(deps)` in
  `src/app.ts` takes every external dependency as a parameter. `src/server.ts`
  is the only place real deps are constructed from env. Tests call
  `buildApp(fakeDeps)` and drive it with `app.inject()` — full HTTP semantics,
  zero network.
- **Ports:** route handlers never import an SDK directly. Every external
  service enters through an interface in `src/ports/` (aggregated in
  `src/deps.ts`); in-memory fakes live in `test/fakes/` — `createFakeDeps()`
  is the default in every unit test. Real adapters are written alongside the
  first route that needs them, each with one narrow integration test in a
  separate, optional CI job. Port types keep the providers' raw snake_case
  field names so adapters stay pure translation.
- **Response schemas on every route** (TypeBox) — Fastify enforces them at
  serialization time, so a wrong response shape fails loudly in tests.
- **Auth:** `src/plugins/auth.ts`. `app.requireUser` preHandler validates
  Supabase user JWTs locally (HS256 via `SUPABASE_JWT_SECRET`, ES256/RS256 via
  the project JWKS — no per-request network call) and sets `req.user` /
  `req.userId`; `requireServiceBearer(secret)` for machine-to-machine routes.
  Anon/service-role keys are rejected (`sub` + `role: 'authenticated'`
  required).

## Logging

One canonical pino event per request, emitted by a central `onResponse`
hook — handlers contribute fields via `req.logCtx.set({...})`, never log
request-shaped work directly. Business events go through the typed
`logEvent()` catalog in `src/logging.ts`. `console.*` is banned by lint.

**Level policy** (enforced in review):
- `error` — a human should look; alerting keys off this. If it fires weekly
  and nobody acts, demote it.
- `warn` — unexpected but handled: retry succeeded, fallback used, invalid
  webhook signature rejected. Reviewed in aggregate, never paged.
- `info` — the canonical request event + real business events
  (`render_job.completed`, `subscription.changed`).
- `debug` — dev only, off in production.

## Develop

```bash
cp .env.example .env.local   # then adjust if needed
npm install
npm run dev                  # tsx, loads .env.local
npm test                     # vitest — also runs via the root vitest config
npm run typecheck
```

End-to-end tests run against the local `supabase start` Postgres — the
database is never faked; only third-party services are.

## Env vars

| Var | Required | Description |
|-----|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string. Prod: Supabase **direct** connection (`db.<ref>.supabase.co:5432`) — the direct host is IPv6-only, which requires Railway's IPv6 egress (enabled on our service). If IPv6 egress is ever off, fall back to the Supavisor transaction pooler (`aws-0-<region>.pooler.supabase.com:6543`, username `postgres.<ref>`, IPv4). Local: `supabase start` DB |
| `SUPABASE_URL` | Yes | Supabase project URL — JWKS for new-style (ES256) user tokens; platform APIs later |
| `SUPABASE_JWT_SECRET` | Yes | Legacy HS256 secret for user JWTs (dashboard → Project Settings → API → JWT Settings) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service-role key for Supabase platform APIs (auth admin user lookup; storage later). Local: the `supabase start` secret key (see `.env.example`) |
| `STRIPE_SECRET_KEY` | Yes | Stripe API secret key — same value as the edge function secret. Local: a **test-mode** key (`sk_test_…`) |
| `STRIPE_PRO_PRICE_ID_MONTHLY` / `STRIPE_PRO_PRICE_ID_YEARLY` / `STRIPE_TEAMS_PRICE_ID_MONTHLY` / `STRIPE_TEAMS_PRICE_ID_YEARLY` | Yes | Subscription price ids, keyed by plan + interval — same names/values as the edge function secrets. Local: test-mode price ids |
| `PORT` | No | Default 8080 (Railway injects its own) |
| `SENTRY_DSN` | No | Enables Sentry when set |
| `NODE_ENV` | No | `production` on Railway; controls log format + Sentry environment |
| `RAILWAY_GIT_COMMIT_SHA` | No | Injected by Railway; surfaced by `/health` as `version` |
| `S3_REGION` / `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | For storage routes | S3-compatible storage, `project-media` bucket — same values as the edge function secrets. Local: the `supabase start` storage S3 endpoint (see `.env.example`). If any is missing the s3 port stays unimplemented (storage routes 500) and a startup warning is logged |
| `MUX_WEBHOOK_SECRET` | Yes | Signing secret of the Mux webhook **endpoint** posting to `/mux-video-webhook`. CAREFUL: each Mux webhook endpoint has its own secret (Mux dashboard → Settings → Webhooks) — use the secret of whichever endpoint points at this server |
| `STRIPE_WEBHOOK_SECRET` | Yes | Signing secret of the Stripe webhook **endpoint** posting to `/stripe-webhooks`. Same per-endpoint gotcha as Mux (dashboard → Developers → Webhooks) — the server endpoint's secret, not the edge fn's |
| `RESEND_API_KEY` | Yes | Resend API key for the welcome + workspace-invite emails — same value as the edge function secret |
| `AXIOM_TOKEN` | Yes | Axiom API token with **ingest** permission on the dataset — logs ship app-side via the `@axiomhq/pino` transport (Railway has no log drains). Stdout NDJSON stays intact for the Railway viewer |
| `AXIOM_DATASET` | Yes | Axiom dataset name, per environment: `recordio-server` (prod/Railway), `recordio-server-dev` (local dev) — prod dashboards/monitors need no env filters |

More vars land as routes migrate (Stripe, Mux, email, transcription, ...).
Add each to the table when it lands.

## Railway setup (manual, once)

- [ ] New Railway service, root directory `server/`, GitHub-triggered deploys
      from `master`
- [ ] Build: `npm ci && npm run build`; start: `npm start`
- [ ] Region matched to the Supabase project region
- [ ] Always-on (no app sleeping — webhooks), usage caps set
- [ ] Enable **Wait for CI** so deploys block on the `server-tests` GitHub check
- [ ] Env vars: `DATABASE_URL` (Supavisor, transaction mode), `SENTRY_DSN`,
      `NODE_ENV=production`, `AXIOM_TOKEN` + `AXIOM_DATASET` (required —
      boot fails without them); copy edge-function secrets as their routes
      migrate
- [ ] Uptime monitor pinging `GET /health`
- [ ] Verify: `/health` returns the deployed git SHA; hit `GET /debug-sentry`
      (throws on purpose) and confirm the error appears in Sentry

## Rollback

The edge functions were decommissioned 2026-07-24 (Step 5) — there is no
edge fallback anymore. Rolling back a server change means deploying a
previous Railway build (or reverting the commit); rolling back a webapp
change means deploying a previous webapp build. The old edge-function
source lives in git history (`git log -- supabase/functions`).

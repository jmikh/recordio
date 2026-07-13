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
| `DATABASE_URL` | Yes | Supavisor pooled connection string (transaction mode). Local: `supabase start` DB |
| `SUPABASE_URL` | Yes | Supabase project URL — JWKS for new-style (ES256) user tokens; platform APIs later |
| `SUPABASE_JWT_SECRET` | Yes | Legacy HS256 secret for user JWTs (dashboard → Project Settings → API → JWT Settings) |
| `PORT` | No | Default 8080 (Railway injects its own) |
| `SENTRY_DSN` | No | Enables Sentry when set |
| `NODE_ENV` | No | `production` on Railway; controls log format + Sentry environment |
| `RAILWAY_GIT_COMMIT_SHA` | No | Injected by Railway; surfaced by `/health` as `version` |

More vars land as routes migrate (Stripe, Mux, AWS, email, transcription,
`SUPABASE_JWT_SECRET`, ...). Add each to the table when it lands.

## Railway setup (manual, once)

- [ ] New Railway service, root directory `server/`, GitHub-triggered deploys
      from `master`
- [ ] Build: `npm ci && npm run build`; start: `npm start`
- [ ] Region matched to the Supabase project region
- [ ] Always-on (no app sleeping — webhooks), usage caps set
- [ ] Enable **Wait for CI** so deploys block on the `server-tests` GitHub check
- [ ] Env vars: `DATABASE_URL` (Supavisor, transaction mode), `SENTRY_DSN`,
      `NODE_ENV=production`; copy edge-function secrets as their routes migrate
- [ ] Uptime monitor pinging `GET /health`
- [ ] Verify: `/health` returns the deployed git SHA; hit `GET /debug-sentry`
      (throws on purpose) and confirm the error appears in Sentry

## Rollback

Every cutover in the migration is a URL/env repoint. Nothing is deleted from
Supabase during Part 1 — edge functions stay deployed (idle), so rolling back
any route means pointing its caller back at the edge function URL.

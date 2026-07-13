# Server

Fastify API server replacing the Supabase edge functions
(see `plans/fastify-part1-edge-functions-migration.md`). Hosted on Railway;
Postgres stays on Supabase, reached through the Supavisor pooler.

## Architecture

- **App factory, no top-level side effects:** `buildApp(deps)` in
  `src/app.ts` takes every external dependency as a parameter. `src/server.ts`
  is the only place real deps are constructed from env. Tests call
  `buildApp(fakeDeps)` and drive it with `app.inject()` — full HTTP semantics,
  zero network.
- **Ports:** route handlers never import an SDK directly. Every external
  service enters through an interface in `src/deps.ts`; in-memory fakes live
  in `test/fakes/`.
- **Response schemas on every route** (TypeBox) — Fastify enforces them at
  serialization time, so a wrong response shape fails loudly in tests.

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

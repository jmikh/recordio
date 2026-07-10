# Part 1 — Fastify Server: Edge Function Migration (Detailed Plan)

Scope: replace all 21 Supabase edge functions with Fastify routes on Railway.
Out of scope: RPC proxying, auth, storage uploads, business-logic rewrites.

## Step 0 — Scaffold and deploy the skeleton

- New workspace `server/` at repo root (sibling of `render-worker/`, reusing
  its Node tooling conventions).
- Fastify + `@sinclair/typebox` type provider; `@fastify/cors`,
  `@fastify/rate-limit`, `@sentry/node` (existing Sentry project),
  `pg` pool → Supavisor (transaction mode).
- `GET /health` route.
- Railway service: GitHub-triggered deploy, region matched to Supabase,
  always-on, usage caps set. Env vars copied from Supabase edge function
  secrets (Stripe, Mux, AWS, transcription API, email provider, SUPABASE_URL,
  SUPABASE_JWT_SECRET, SERVICE_ROLE_KEY).
- Uptime monitor pinging `/health`.

**Gate:** skeleton deployed, green health check, Sentry receiving a test event.

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

Each route: port → deploy → switch traffic → observe → delete the edge
function. One at a time within each wave.

### Wave A — Webhooks (no client changes; providers retry on failure)
1. `render-job-hook` — update `statusCallbackUrl` that `render-job-create`
   hands to the render worker (coordinate with Wave C ordering: hook first,
   create later, so in-flight jobs keep working — support both URLs during
   overlap).
2. `mux-video-hook` — repoint webhook URL in Mux dashboard.
3. `stripe-webhooks` — add a second webhook endpoint in Stripe pointing at
   Fastify, verify events arrive and are handled, then disable the Supabase
   endpoint. Handlers must be idempotent (Stripe redelivers): upsert
   subscription state, keyed on event id (processed-events ledger table).

### Wave B — Cron targets (update pg_cron HTTP jobs)
4. `purge-deleted-projects` — repoint `cron_purge_deleted_projects`.
5. `mux-video-purge` — repoint `cron_mux_video_purge`.
   Both jobs already delete-by-condition (naturally idempotent); protect with
   a bearer token check (same pattern as render-worker callbacks).

### Wave C — Client-invoked, low risk (simple request/response)
6. `storage-download-urls` (S3 presign)
7. `shared-video-get` (public, no auth — add rate limit)
8. `stripe-checkout`, `stripe-portal`, `stripe-add-seats`,
   `subscription-change`
9. `send-workspace-invite`
10. `unsubscribe` (public link target — this is a URL in sent emails; keep the
    old edge function alive as a redirect, or accept that old emails break,
    or proxy the old URL. Decide before cutover.)
11. `project-update-thumbnail`

### Wave D — Client-invoked, heavier flows
12. `asset-create` (S3 multipart via AWS SDK)
13. `transcribe` (external API call; longer request — no timeout ceiling on
    Railway, but add a server-side timeout + Sentry breadcrumb)
14. `mux-video-create` (talks to Mux + render worker)
15. `render-job-create` (S3 presigned URLs + render-worker submission; hands
    out the new Fastify `render-job-hook` callback URL — completes Wave A #1)
16. `project-create` (legacy editor upload flow)
17. `project-create-v2` — port the function, but the TUS upload itself keeps
    going to Supabase Storage REST (storage migration is Part 4). Only the
    project-row orchestration moves.

### Wave E — DB-triggered
18. `send-welcome-email` — the `auth.users` trigger calls an HTTP endpoint;
    repoint the trigger's URL (pg_net) at Fastify, bearer-token protected.
    Idempotent: welcome-email-sent flag on the profile row (trigger retries
    must not double-send).

## Step 5 — Decommission

- Delete each edge function after its route has run clean for a few days.
- Remove `supabase/functions/` deploy from CI/scripts; keep `_shared` history.
- Final check: `grep -r "functions.invoke" webapp/` returns nothing;
  Supabase dashboard shows zero edge function invocations over a week.

## Testing strategy

- Reuse `test/helpers/supabaseClient.ts` patterns: integration tests hit the
  local Fastify server with real Supabase-issued JWTs against the local stack
  (`supabase start` + Fastify dev server; add to `docker-compose.yml` or a
  `dev` script).
- Webhook handlers: replay captured Stripe/Mux payloads with valid signatures.
- Per-wave smoke checklist in the PR description (which URLs were repointed,
  where the rollback switch is).

## Rollback

Every cutover is a URL/env change, not a code dependency: repoint the webhook
/ cron job / `VITE_API_URL` back to the Supabase edge function, which is not
deleted until its route has soaked. No data migrations occur in Part 1.

## Estimated shape

- Step 0–3 (skeleton, auth, helpers, client module): the foundation chunk.
- Waves A–B: small, high-confidence, immediately reduce Deno surface.
- Wave C: mechanical, batchable.
- Waves D–E: the fiddly 30% — S3 multipart, render-worker coordination,
  trigger repointing. Budget most of the review attention here.

# Part 1 — Fastify Server: Edge Function Migration (Detailed Plan)

Scope: replace all 21 Supabase edge functions with Fastify routes on Railway.
Out of scope: RPC proxying, auth, storage uploads, business-logic rewrites.

Organizing constraint: **testability first**. Every architectural choice in
Steps 0–2 exists to make route handlers testable in-process with no network,
no Docker, and no external accounts. Definition of done for every route:
comprehensive tests written fresh with the port (e2e against real local
Postgres + unit against fakes), an idempotency (run-twice) test where the
route is webhook/cron-invoked, the client call site switched behind the
`USE_SERVER_INSTEAD_OF_SUPA` flag, and a manual local verification by the
user with the flag on.

## Status (updated 2026-07-16)

**Done:**
- **Step 0** — `server/` scaffolded (Fastify + TypeBox, `buildApp(deps)` factory,
  `/health` + `/debug-sentry`, tsup/tsx per render-worker conventions). Railway
  service deployed and verified by the user (health returns git SHA, Sentry
  receives events). CI: `.github/workflows/server-tests.yml` (typecheck + tests
  on every PR/master push); Railway "Wait for CI" enabled. Root vitest picks up
  `server/` tests.
- **Step 0.5** — ports in `server/src/ports/` (aggregated in `src/deps.ts`),
  in-memory fakes in `server/test/fakes/` (`createFakeDeps()`, throwing-db
  default). Includes `SupabaseApiPort` (auth admin getUserById + storage
  list/remove) which the original plan missed. Survey findings: **no S3
  multipart anywhere** (asset-create is a plain presigned PUT — Wave B simpler
  than planned); `_shared/muxUpload.ts`'s storage `createSignedUrl` can become
  `S3Port.presignDownload` at migration. Real adapters land with the first
  route that needs them (`server.ts` wires throwing `unimplementedPort`
  proxies until then).
- **Step 0.6** — skipped (see section below).
- **Step 0.7** — logging foundation: `src/logging.ts` (typed `DomainLogFields`,
  `ErrorType` enum, `logEvent()` catalog, redact backstop), canonical
  per-request event via `onResponse` hook, `req.logCtx`, `console.*` banned by
  eslint in `server/`, level policy in `server/README.md`, Sentry events tagged
  with `request_id`.
- **Step 1** — auth: `src/plugins/auth.ts`. `requireUser` verifies **both**
  token formats by header alg — HS256 via `SUPABASE_JWT_SECRET`, ES256/RS256
  via the project JWKS (`SUPABASE_URL`), because the local stack (and possibly
  prod) issues the new asymmetric "JWT signing keys" tokens. Rejects anon/
  service-role tokens (`sub` + `role === 'authenticated'` required). Plus
  `requireServiceBearer(secret)` for machine-to-machine routes. Contract tests
  run against real local-Supabase tokens (auto-skip without env).
- **Step 2** — folded into per-function migrations: each `_shared` helper is
  ported with its first consuming route, not speculatively.
- **Env files:** `server/.env.local` (local stack, `npm run dev`),
  `server/.env.prod` (prod-pointed local run, `npm run dev:prod`),
  `server/.env.example` committed. Railway holds prod env.
- **Test-infra fixes:** root `.env.test` creds aligned to `supabase/seed.sql`
  users (`user1@gmail.com`/`user2@gmail.com`, password `password123`);
  seed.sql's bcrypt hash regenerated — it matched neither of its two
  contradictory comments.

- **Step 3** — client API module: `webapp/src/api/client.ts` exports
  `invokeFunction(name, body)` (supabase-shaped `{ data, error }`, returns
  real `FunctionsHttpError`/`FunctionsFetchError` instances) and the
  `MIGRATED_FUNCTIONS` registry (empty). Routes to `${VITE_API_URL}/${name}`
  (POST JSON, Bearer = current session token) only when
  `VITE_USE_SERVER === 'true'` AND the name is registered; otherwise falls
  through to `supabase.functions.invoke`. Server 401s reuse the exact same
  funnel as supabase calls: `authAwareFetch` is now exported from
  `webapp/src/supabase/client.ts` and the API client fetches through it.
  Env: `VITE_API_URL`/`VITE_USE_SERVER` documented in `webapp/.env.example`
  + typed in `vite-env.d.ts` (flag defaults off; local server
  `http://localhost:8090`). Tests: `webapp/src/api/client.test.ts` (8) cover
  flag off / flag on + unregistered / flag on + registered (URL, headers,
  body) / no-session / missing VITE_API_URL / non-2xx / network error / 401
  funnel (real `authAwareFetch` + `setUnauthorizedHandler`, mocked global
  fetch). No call sites converted yet — they move per-function.

- **Wave A #1 — `storage-download-urls`** (code complete; user verified
  locally with the flag on 2026-07-16, then verified local webapp against
  the **prod Railway server** same day. Railway env now has the four S3_*
  vars (new Supabase S3 access key pair minted 2026-07-16 — old pair left
  valid for the edge functions), plus `SUPABASE_URL` and
  `SUPABASE_JWT_SECRET` (missed at Step 0 setup; server config requires
  them since Step 1). Remaining: deploy the prod webapp with
  `VITE_USE_SERVER=true` + `VITE_API_URL` baked in, observe):
  - Route: `server/src/routes/storageDownloadUrls.ts` (first route module;
    registered in `app.ts`), TypeBox request + response schemas,
    `requireUser`, `storage.path_count` added to `DomainLogFields`.
  - First real adapter: `server/src/adapters/s3.ts` (AWS SDK v3, path-style,
    bucket `project-media` fixed in the adapter). `server.ts` wires it only
    when all of `S3_REGION`/`S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`
    are set (optional in config so a missing group can't fail the deploy —
    startup warn + per-call throw instead). Local values (supabase CLI's
    fixed S3 creds) in `server/.env.example`; **Railway needs these four
    vars before prod cutover** (same values as the edge function secrets).
  - Tests (all green): unit via fakes (9 — auth/validation/ownership/admin
    bypass/log field; this route has no DB, so this IS its e2e tier), and
    the adapter integration test (`test/adapters/s3.integration.test.ts`,
    auto-skip without S3_* env; verified manually against local stack
    storage — put/get/presign-GET/presign-PUT all pass). Shared token helper
    added: `server/test/helpers/tokens.ts`. A per-route contract test with
    real Supabase tokens was written, then deleted as redundant — see the
    testing-strategy decision below (2026-07-14).
  - Client: both call sites (`storage/cloudStorage.ts:requestDownloadUrls`,
    `editor/components/settings/useCloudRender.ts:downloadFile`) converted
    to `invokeFunction`; `'storage-download-urls'` registered in
    `MIGRATED_FUNCTIONS`.
  - **Analysis (per-function pass):** function is minimal — no DB calls, no
    dead weight. Kept identical: hardcoded admin-bypass user id
    (`01f290d7-…`) — flagged as a smell, should become env config later, not
    changed now. Deliberate observable divergences: (1) 400 validation
    errors return Fastify's default `{ statusCode, error, message }` body
    instead of the edge fn's `{ error }` (status identical; no call site
    reads a 400 body); (2) unhandled 500s likewise use Fastify's default
    shape; (3) non-string scalar array entries are coerced to strings by
    Ajv, then rejected 403 by the prefix check (edge fn also returned 403
    for non-admin callers — parity in practice); (4) JWT verified locally
    instead of `auth.getUser()` network call (Step 1 trade-off: revoked
    sessions stay valid until expiry).

- **Wave A #2 — `shared-video-get`** (code complete AND user-verified
  2026-07-16: locally against the local stack, and flag-on from the local
  webapp against the **deployed Railway server** with prod data — 200s in
  Railway logs. Prod-webapp flag flip stays deferred to end of migration):
  - Route: `server/src/routes/sharedVideoGet.ts` — PUBLIC (no `requireUser`),
    per-route rate limit 60/min/IP (global 300 stays the backstop; VideoPage
    polls at 12/min). TypeBox request + response schemas; `project.slug`,
    `mux.video_status` added to `DomainLogFields`,
    `SupabaseApiUnavailable` added to `ErrorType`.
  - **DB-function classification: none called** — the edge fn is PostgREST
    table reads (`projects`, `mux_videos`) + `auth.admin.getUserById`.
    Nothing to classify exclusive-vs-shared; port = direct SQL via `Db` +
    `SupabaseApiPort.getUserById`.
  - Second real adapter: `server/src/adapters/supabaseApi.ts`
    (`@supabase/supabase-js` moved to server runtime deps; auth admin
    getUserById only — the storage methods throw until their Wave C
    consumers land). `SUPABASE_SERVICE_ROLE_KEY` is a **required** config
    var (user decision: fail deploys loudly rather than degrade) —
    **Railway needs it before the next deploy**. Its integration test runs
    in the blocking job on purpose: it needs only the local stack (same
    dependency as the e2e tier), not third-party creds.
  - First real-Postgres e2e suite: `server/test/sharedVideoGet.test.ts`
    (20 tests — 404 paths, full mux priority matrix incl. the
    NULL-playback-id fall-through and canceled-ignored parity, userName
    fallback chain, supabaseApi-failure degradation, canonical log fields,
    read-only DB-state assertion, 429 over the per-route limit). Seed
    builders in `server/test/helpers/db.ts`. **Isolation deviation from the
    plan's truncate mechanics:** unique ids/slugs + targeted deletes in
    `afterEach` instead of truncation, because the root vitest run executes
    other e2e suites against the same database in parallel and truncation
    would wipe their seed rows. `DATABASE_URL` added to the committed root
    `.env.test`; e2e suites `describe.runIf(hasTestDb())` so a bare
    `vitest` inside `server/` (no root config) skips instead of failing
    confusingly — CI always uses the root config, so the tier stays
    merge-blocking where it matters.
  - CI: `server-tests.yml` now runs `supabase/setup-cli` → `supabase start`
    and tests via the **root** vitest config (`npx vitest run server
    webapp/src/api`) so `.env.test` loads — no GitHub secrets. The auth
    contract tests now run in CI for free. S3 adapter integration still
    auto-skips (no S3_* in `.env.test`).
  - Client: `pages/VideoPage.tsx` converted to `invokeFunction` (the old
    `supabase?.functions.invoke` null-fallback is now handled inside the
    wrapper); `'shared-video-get'` registered in `MIGRATED_FUNCTIONS`.
  - **Analysis:** dead weight — comment numbering skips 3 (copy-paste
    residue); pending-lookup ordered by cloud_version when only existence
    matters. Simplification — three sequential mux queries collapsed to one
    `SELECT DISTINCT ON (status) … ORDER BY status, cloud_version DESC`
    with identical priority logic in TS (incl. the latest-completed-with-
    NULL-playback → pending fall-through); owner lookup + mux query run in
    parallel. Consistency — 400s use Fastify's default body (same
    documented divergence as Wave A #1); 404 keeps the exact
    `{ error: 'not_found' }` body. Smells flagged NOT fixed: completed
    lookup ignores `is_deleted` despite its comment (a soft-deleted
    completed video can outrank a newer pending one); `canceled` rows
    silently ignored; getUserById failures degrade to `userName: 'Unknown'`
    (kept, but now tagged `error_type: SupabaseApiUnavailable` in the
    canonical event).
  - Checks: root `npx vitest run server webapp/src/api` (57 passed, S3
    integration skipped), server typecheck, webapp `tsc -b`, eslint clean
    on changed files (VideoPage's 3 react-hooks findings pre-exist on
    HEAD).
  - **Deploy fallout fixed during cutover (2026-07-16):**
    - `.env.test` was never actually in git (root `.gitignore`'s `.env.*`)
      despite this plan calling it "committed" — now committed via a
      `!.env.test` exception; all values are well-known local-stack
      constants (`RENDER_SECRET` was already hardcoded in committed test
      files). GitHub push protection flags the local `sb_secret_*` demo
      key — bypassed once via the unblock link ("used in tests").
    - e2e suites must create their pg pool lazily (`beforeAll`), not in
      the `describe` body — vitest executes describe bodies at collection
      even when `runIf` skips, which broke CI before `.env.test` existed
      there.
    - **Railway `DATABASE_URL` was broken since Step 0** and only surfaced
      now (first prod route to touch the db): it pointed at the direct
      `db.<ref>.supabase.co` host, which is **IPv6-only**, and the Railway
      service had no IPv6 egress → `connect ENETUNREACH`. Interim fix was
      the IPv4 Supavisor pooler + `setDefaultResultOrder('ipv4first')`;
      **final resolution (same day): Railway outbound IPv6 enabled**, so
      `DATABASE_URL` uses the **direct connection** (`db.<ref>:5432` — no
      pooler hop, full Postgres features; fine for one always-on instance
      with pool max 10) and the ipv4first workaround was removed from
      `server.ts`. README documents the direct-vs-pooler choice; local
      `dev:prod` runs keep the IPv4 pooler string (home networks may lack
      IPv6).
    - Railway env now also has `SUPABASE_SERVICE_ROLE_KEY`.
    - CI workflow further optimized by the user: `supabase start` runs in
      the background overlapping `npm ci`, with non-essential services
      excluded (`-x realtime,imgproxy,mailpit,postgres-meta,studio,
      edge-runtime,logflare,vector,supavisor`).

- **Wave A #3 (1/3) — `stripe-checkout`** (code complete, locally verified
  AND Railway-verified 2026-07-16 — user confirmed flag-on webapp against
  the prod Railway server works; the five Stripe vars are live on Railway.
  The 400 on first local try was an archived sandbox `pro_yearly` price
  (fixed in the Stripe dashboard), not code):
  - Route: `server/src/routes/stripeCheckout.ts` — `requireUser`, TypeBox
    request/response schemas (plan/interval constrained to enums, defaults
    applied in the handler exactly like the edge fn's destructuring);
    `stripe.plan` + `stripe.interval` added to `DomainLogFields`
    (`workspace.id` already existed).
  - **DB-function classification: none called** — the edge fn is auth +
    price lookup + one Stripe call; even the user-scoped supabase client
    `withAuth` hands it goes unused. Nothing exclusive-vs-shared to
    classify; no DB tier → the fakes suite IS its e2e tier (same as
    Wave A #1).
  - Third real adapter: `server/src/adapters/stripe.ts` (`stripe` SDK v22
    in server runtime deps). Only `createCheckoutSession` is implemented —
    the other StripePort methods throw until their consumers land
    (portal / subscription-change / webhooks). **API-version divergence
    (user-confirmed 2026-07-16):** no `apiVersion` override — stripe-node
    sends its bundled `2026-06-24.dahlia`, while the edge fn pins
    `2024-11-20.acacia`; irrelevant to `checkout.sessions.create`.
  - Env — all **required** in `config.ts` (no-optional-vars preference):
    `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID_MONTHLY`,
    `STRIPE_PRO_PRICE_ID_YEARLY`, `STRIPE_TEAMS_PRICE_ID_MONTHLY`,
    `STRIPE_TEAMS_PRICE_ID_YEARLY` (same names as the edge fn secrets).
    README env table + `.env.example` updated; placeholder blocks appended
    to `.env.local` (test-mode) and `.env.prod` (live) for the user to fill.
    Price ids reach the route via `AppOptions.stripePriceIds` (business
    config, not a port); if absent (a test that forgot them) the route
    throws 500 instead of creating a session with an empty price id.
  - Tests: `server/test/stripeCheckout.test.ts` (11 — 401/400 validation,
    403 mismatch with the exact edge-fn body, pro-yearly defaults with full
    session-params parity, pro ignores seats, teams quantity + default-5 +
    clamp-below-at-1, `seats: String(quantity)` metadata parity, fail-loud
    without price ids, canonical log fields). Adapter integration test
    `test/adapters/stripe.integration.test.ts` — third-party tier, out of
    the blocking CI job; auto-skips unless `STRIPE_SECRET_KEY` starts with
    `sk_test_` (a live key can never be exercised); creates a throwaway
    test-mode product/price per run.
  - Client: `StripeService.createCheckoutSession` → `invokeFunction`
    (checkout only — portal and subscription-change untouched);
    `'stripe-checkout'` registered in `MIGRATED_FUNCTIONS`.
  - **Analysis:** dead weight — the unused user-scoped supabase client;
    `interval || 'yearly'` in the metadata is unreachable (the destructure
    default already applied). Simplification — schema enums for
    plan/interval + required non-empty price env vars make the edge fn's
    "No price configured" 400 branch unreachable → dropped (schema 400
    replaces it; no call site reads 400 bodies). Consistency — 400s use
    Fastify's default body (same documented divergence as Waves A #1/#2);
    403 keeps the exact `{ error: 'Unauthorized: User ID mismatch' }`;
    check-order divergence: schema validation (incl. workspaceId presence)
    now runs before the userId-mismatch 403; Stripe-error divergence (seen
    during verification): Stripe SDK 4xx errors carry `statusCode` and pass
    through Fastify's default error handler, so the client gets Stripe's
    status + message where the edge fn returned an opaque 500 — kept (no
    call site reads the body), documented here. Smells flagged NOT fixed:
    client-supplied `userEmail` forwarded to Stripe unchecked against the
    token's email; `workspaceId` never validated against the caller's
    membership (any authed user can start a checkout that targets any
    workspace id — the webhook applies it); `seats` has no upper bound;
    success/cancel URLs are client-controlled.
  - Checks: root `npx vitest run server webapp/src/api` (68 passed, S3 +
    Stripe adapter integrations skipped), server typecheck, webapp
    `tsc -b`, eslint clean on changed files (StripeService's two
    `no-explicit-any` findings pre-exist on HEAD).

- **Wave A #3 (2/3) — `stripe-portal`** (code complete AND user-verified
  2026-07-16, flag-on against prod Railway. No new env vars):
  - Route: `server/src/routes/stripePortal.ts` — `requireUser`, TypeBox
    request/response schemas, exact 404 body
    `{ error: 'No subscription found for this workspace' }`. No new
    `DomainLogFields` (`workspace.id` already existed).
  - **DB-function classification: `subscription_get` — SHARED** (client
    RPCs in `AuthManager.ts`/`switchWorkspace.ts` + the unmigrated
    `transcribe` edge fn) → the SQL function stays untouched and still
    called by those. But it **cannot** be called via the Db port: its
    membership check is `wm.user_id = auth.uid()`, and over the server's
    pg pool (postgres role, no JWT claims) `auth.uid()` is NULL → NULL for
    everyone. The query is ported inline instead — `subscriptions JOIN
    workspace_members` with an explicit `$user_id` param, same membership
    semantics, selecting only `stripe_customer_id` (all the route needs).
    This is a **third call pattern** (not exclusive-port / not
    shared-via-Db-port): shared SQL fn re-implemented inline because it is
    auth.uid()-dependent — no fork risk in practice since the inline copy
    is 1 trivial join, but noted for Part 2/3 when subscription_get's last
    RLS-context caller migrates.
  - Adapter: `createPortalSession` implemented in
    `server/src/adapters/stripe.ts` (billingPortal.sessions.create;
    getSubscription's throw-message no longer mentions portal). Same
    no-apiVersion-pin divergence as checkout.
  - Tests: `server/test/stripePortal.test.ts` (11 — 401 no/garbage token,
    400 missing workspaceId/returnUrl proven pre-query via throwing db;
    e2e on real Postgres: member+subscription 200 with recorded portal
    params, viewer-role member 200 (RPC parity: any member), non-member
    404 exact body, member-without-subscription 404, NULL
    stripe_customer_id 404, canonical log fields, read-only DB-state
    snapshot). Seed builders added to `test/helpers/db.ts`:
    `seedWorkspace`/`seedWorkspaceMember`/`seedSubscription`/
    `deleteWorkspaces` (+ `SEEDED_USER_2_ID`); isolation = unique
    workspace ids + targeted deletes (members/subscriptions cascade).
    Adapter integration test extended with a `createPortalSession` case
    (throwaway test-mode customer; `sk_test_` guard kept; third-party
    tier, out of blocking CI).
  - Client: `StripeService.createPortalSession` → `invokeFunction` (its
    now-redundant `if (!supabase)` guard dropped — the wrapper handles it);
    `'stripe-portal'` registered in `MIGRATED_FUNCTIONS`.
    `subscriptionChange` untouched.
  - **Analysis:** dead weight — the RPC's `p_workspace_id NULL` fallback
    (oldest owned workspace) never runs here (edge fn 400s without
    workspaceId) → not ported. Simplification — RPC round trip returning a
    7-field JSONB collapsed to one inline join selecting only
    `stripe_customer_id`. Consistency — 400s use Fastify's default body
    (same documented divergence as prior waves; returnUrl is now
    schema-required where the edge fn would have passed undefined through
    to Stripe — no call site omits it); Stripe SDK 4xx errors pass through
    Fastify's default error handler where the edge fn returned an opaque
    500 (same as checkout, not wrapped). Smells flagged NOT fixed:
    non-member and no-subscription are indistinguishable 404s (RPC
    returned NULL for both — kept for parity); a malformed (non-UUID)
    workspaceId hits the uuid cast and 500s (edge fn also 500'd via the
    RPC error path); returnUrl is client-controlled and forwarded to
    Stripe unchecked (same class as checkout's success/cancel URLs).
  - Checks: root `npx vitest run server webapp/src/api` (79 passed, S3 +
    Stripe adapter integrations skipped), server typecheck, webapp
    `tsc -b`, eslint clean on changed files (StripeService's two
    `no-explicit-any` findings pre-exist on HEAD).

- **Wave A #3 (3/3) — `subscription-change`** (code complete AND
  user-verified 2026-07-16 — preview + apply against sandbox Stripe.
  **First migrated route with a DB WRITE.** No new env vars):
  - Route: `server/src/routes/subscriptionChange.ts` — `requireUser`,
    TypeBox request/response schemas (200 is a Union of the preview and
    success shapes; 400/500 schemas use `additionalProperties: true` so
    business-rule 400s send exact `{ error }` edge-fn bodies while
    schema-validation 400s keep Fastify's full default body — same
    documented divergence as all waves). Price ids via the existing
    `AppOptions.stripePriceIds`. `stripe.dry_run` added to
    `DomainLogFields`.
  - **DB-function classification: `subscription_workspace_get` —
    EXCLUSIVE** (only caller is this edge fn; the SQL file's "Called by:
    WorkspaceSettingsPage billing tab" comment is stale). Logic ported
    inline; the SQL function is now **orphaned → Step 5 decommission
    list**. It was auth.uid()-dependent anyway (assert_workspace_admin)
    so it couldn't be called over the pg pool. The RPC's 403/404 split is
    preserved via one LEFT JOIN query (no admin+live-workspace row → 403
    `Unauthorized or subscription not found`; row with NULL status →
    404 `No subscription found for this workspace`); the edge fn's
    second service-role read of the same subscriptions row is collapsed
    into that query (no user-vs-service-role split over the pool), with
    the check ORDER kept identical (status → downgrade → no-op →
    stripe-ids 404 → seat floor).
  - Adapter: `getSubscription` (expand option), `updateSubscription`,
    `getPrice`, `previewInvoice` implemented in
    `server/src/adapters/stripe.ts`. The edge fn raw-fetched
    `POST /v1/invoices/create_preview` (not in stripe-node v14); v22 has
    `invoices.createPreview` — used. **API-version divergence confirmed
    against the real API:** dahlia keeps `current_period_end` on the
    subscription ITEM (acacia had it subscription-level); the route reads
    `item.current_period_end ?? sub.current_period_end`.
  - Schema divergences (documented): `newPlan` is `Literal('teams')`
    (schema 400 replaces the edge fn's "Only upgrades to Teams" 400);
    `newSeats` is `Integer({ minimum: 1 })` (edge fn allowed floats);
    **`dryRun` is REQUIRED** — the edge fn treated a missing dryRun as
    falsy and silently APPLIED the change; missing now 400s instead of
    defaulting into the destructive branch.
  - Tests: `server/test/subscriptionChange.test.ts` (21 — 401; schema
    400s incl. missing-dryRun-never-applies, proven pre-query via
    throwing db; e2e on real Postgres: 403 non-member / creator-role /
    soft-deleted workspace, 404 no-subscription-row, 400 not-active,
    400 yearly→monthly, 400 no-op, 404 no-stripe-ids, 400 seat floor
    with exact interpolated body, 500 no-items exact body, dryRun
    preview math parity + **DB-unchanged** + no update call, dryRun
    interval change carries target price + billingInterval-stays-current
    parity, apply seats-only records update without price + **DB row
    written**, apply pro→teams (trialing) with price, canonical log
    fields incl. stripe.dry_run). Seed builders extended:
    `seedWorkspace` deletedAt, `seedSubscription`
    stripeSubscriptionId/billingInterval. Adapter integration test
    extended with a getSubscription/previewInvoice/getPrice/
    updateSubscription round-trip on a trialing test-mode subscription
    (no payment method needed) — **run against real Stripe test mode
    2026-07-16, all 3 pass** (verifies item-level current_period_end);
    `sk_test_` guard kept, stays out of blocking CI.
  - Client: `StripeService.subscriptionChange` → `invokeFunction`; the
    now-unused `supabase` import dropped from StripeService (all three
    of its functions are converted); `'subscription-change'` registered
    in `MIGRATED_FUNCTIONS`. Callers: `BillingPage.tsx` (preview +
    apply) — client-invoked, NOT a webhook; `stripe-webhooks` (Wave D)
    remains the authoritative DB sync.
  - **Analysis:** dead weight — the `plan === 'teams' && newPlan ===
    'pro'` downgrade check was unreachable (newPlan already forced to
    'teams') → dropped; DEBUG console.log blocks dropped (console.*
    banned; fields go to logCtx); the "No price configured" 500 branch
    unreachable with required env vars (same as checkout).
    Simplification — RPC + second service-role read collapsed to one
    LEFT JOIN; `updated_at` via SQL `now()` instead of a JS timestamp.
    Consistency — Stripe SDK 4xx errors (incl. preview errors the edge
    fn re-wrapped as 400 `{ error: message }`) pass through Fastify's
    default handler; no client reads those bodies (FunctionsHttpError
    message is generic) — kept, documented. Smells flagged NOT fixed:
    the dryRun preview reports the CURRENT billing interval even when
    previewing an interval change (renewal amount uses the TARGET price
    — inconsistent pair; parity kept, test pins it); apply is not
    atomic (Stripe update then DB update — a crash between leaves DB
    stale until the webhook syncs; acceptable, webhook is
    authoritative); seat floor counts members but not pending
    invitations; malformed (non-UUID) workspaceId → pg cast error 500
    (edge fn also 500'd via RPC error).
  - Checks: root `npx vitest run server webapp/src/api` (100 passed, S3
    + Stripe adapter integrations skipped there; Stripe integration run
    separately with the sandbox key — 3/3 pass), server typecheck,
    webapp `tsc -b`, eslint clean on changed files (StripeService's two
    `no-explicit-any` findings pre-exist on HEAD).

**Cutover strategy change (user decision 2026-07-16):** the prod-webapp
flag flip is **deferred to the end of the migration** — while the server
is under heavy churn, prod traffic stays on the edge functions to protect
availability. Per-function verification = local webapp against the prod
Railway server (flag on locally). At the end, one prod webapp deploy with
`VITE_USE_SERVER=true` + `VITE_API_URL=https://recordio-production.up.railway.app`
cuts over every migrated function at once (observe per-function in Railway
logs; rollback = remove the two vars and redeploy).

**Next:** **Wave D #16 — mux-video-hook** (`MUX_WEBHOOK_SECRET` +
the real HMAC in the mux adapter's `verifyWebhookSignature` + Mux
dashboard repoint), prompt file first, on explicit go. Then #17
stripe-webhooks (raw-body signature check; parity upsert idempotency,
NO processed-events ledger per the 2026-07-17 note). After Wave D:
Wave E emails, then the prod flag flip and the manual decommission
checklist.

- **Wave D #15 — `render-job-hook` → `/render-job-webhook`** (code
  complete 2026-07-21; awaiting user verification. **One new REQUIRED
  env var: `PUBLIC_URL`** (config.ts, .env.example — set on Railway
  BEFORE deploy). Server route/path named "webhook" per user decision
  2026-07-21; only the edge fn keeps "hook"):
  - Route: `server/src/routes/renderJobWebhook.ts` — **first non-JWT
    route**: the render worker's `Bearer RENDER_SECRET` (exact match,
    parity), checked in an `onRequest` hook so auth precedes schema
    validation (edge-fn check order — bad body + bad secret must 401,
    pinned). Body `{ jobId minLength 1 }` + optional status /
    progress / error / three `*_duration_s` numbers (worker sends
    heartbeats ~15 s). Flow parity: job read → 404 `Job not found` →
    non-pending → `{ ok, cancel: true }` with NO writes (the cancel
    signal the worker polls, pinned per terminal status) → one
    dynamic UPDATE from `deps.clock` (progress, durations,
    `start_duration_s` on first callback only — pinned as
    never-overwritten; completed also stamps total_duration_s +
    progress 1) → terminal → `render_job_complete($1,$2,$3)` over the
    pool → completed + path → pending-mux lookup → `uploadToMux`
    from services/muxUpload (built shared for this in part12); a
    failed upload still answers 200 (uploadToMux marked the row
    failed — pinned). Worker-reported failures become
    `req.log.error` (the edge fn captureException'd; logs are the
    one place to look — deliberate). Emits the pre-seeded
    `render_job.completed` catalog event.
  - **DB-function classification: `render_job_complete` is SHARED**
    (stale-jobs watchdog cron also calls it) but explicit params, no
    auth.uid() → SQL untouched, called over the pool. Its
    failed/canceled → pending-mux cascade is pinned (incl. the
    `Render failed` default when the worker sends no message).
  - **Cutover:** app.ts `statusCallbackUrl` =
    `${opts.publicUrl}/render-job-webhook` (was the Supabase hook
    URL) — closes the "until Wave D" note in renderJobCreate's
    header. Overlap is automatic: the URL is per-job payload, so
    in-flight jobs and prod renders (edge render-job-create, flag
    off) keep posting to the still-live edge hook until flag
    flip/decommission. AppOptions gained `publicUrl` +
    `renderSecret`; server.ts passes both from config.
  - Tests: `test/renderJobWebhook.test.ts` (15 — 401 no/wrong secret
    incl. the auth-precedes-validation pin; schema 400s; 404 exact;
    heartbeat persistence + start_duration_s-set-once pin (fakeClock
    advanced between beats); cancel signal ×3 terminal statuses with
    row untouched; completed without mux (no mux/S3 calls);
    completed with pending mux (presigned render URL → fake asset,
    row gains mux_asset_id, **status stays pending** for #16);
    completed with mux failure → still 200 + row failed; failed
    cascade with worker error and with RPC default; canonical log
    fields + render_job.completed event). renderJobCreate +
    muxVideoCreate suites updated ONLY in their EXPECTED_CALLBACK
    (now `${publicUrl}/render-job-webhook`) — everything else passed
    unchanged. No client changes (the worker is the only caller).
  - **Analysis:** dead weight — the edge fn's admin supabase client
    and RENDER_CALLBACK_URL_DEV split (PUBLIC_URL covers both
    environments); captureException plumbing folded into the
    canonical logs. Simplification — the whole render pipeline is now
    in-process end to end (create → dispatch → webhook → Mux upload),
    and the muxUpload/logEvent pieces were already built for it.
    Consistency — same exact-body/check-order discipline; the
    per-job-payload URL makes the cutover a config line. Smells NOT
    fixed (suggested_changes.md): duration UPDATE + terminal RPC are
    two non-atomic writes; heartbeat numbers unvalidated; cancel
    rides the next heartbeat (~15 s); start_duration_s heartbeat
    race (last write wins, harmless).
  - Checks: root `npx vitest run server` (243 passed), server
    typecheck, eslint clean on changed files.

- **Wave C — scheduled jobs** (code complete 2026-07-18; **user
  verified 2026-07-21**. **No new env vars, no schema changes, no
  client changes.** First non-route shape — jobs + scheduler, no HTTP):
  - **Jobs** (`src/jobs/`, naming `{table}.{verb}-{qualifier}` per
    user decision 2026-07-18; parity LOOSENED for this wave — bugs
    fixed, not ported):
    - `projects.purge-deleted` (daily; ports edge fn
      `purge-deleted-projects`, `jobs/projectsPurgeDeleted.ts`) —
      30-day window (the edge fn's "3 days" comments were stale, code
      said 30), batch LIMIT 20 (+ ORDER BY deleted_at, the edge fn had
      none). **Bug fixes:** (a) the project's mux_videos rows are
      purged FIRST via the shared `purgeMuxVideo` helper — the edge fn
      let the FK cascade drop them WITHOUT deleting their Mux assets
      (permanent leak; verified no cleanup trigger exists); (b) the
      whole `${created_by}/${id}/` prefix is deleted recursively —
      the Deno `.list()` was one-level and orphaned `renders/` files
      on every purge. Row hard-deleted ONLY after mux + storage
      succeeded (pinned); per-project catch.
    - `mux_videos.purge-superseded` (daily — relaxed from the cron's
      hourly, user decision 2026-07-18; ports edge fn
      `mux-video-purge`, `jobs/muxVideosPurgeSuperseded.ts`) —
      candidates from `mux_video_purge_candidates()` (EXCLUSIVE to
      this job, no auth.uid() → stays SQL over the pool); per row the
      shared helper: Mux asset → render file → row, row LAST (pinned).
    - `render_jobs.purge-superseded` (daily,
      `jobs/renderJobsPurgeSuperseded.ts`) — **NEW, no edge-fn
      ancestor: `cron_render_purge` posted hourly to a `render-purge`
      edge fn that never existed** (silent pg_net 404s — render files
      were never purged). Implements the cron's stated intent as plain
      SQL over the pool (server-exclusive, no sql/functions file);
      the latest completed render + its file survive by construction
      (they back the user's mp4 download — pinned).
    - Shared helper `services/muxPurge.ts#purgeMuxVideo` (used by two
      jobs — the user's anything-called-twice-becomes-a-function
      rule). **Test-only `onlyIds` seam on both superseded jobs**: the
      candidate queries are global and e2e runs against the shared
      long-lived local dev DB — an unscoped run would delete REAL
      local rows while Mux/S3 deletions hit fakes (creating the exact
      dangling-asset leak the jobs prevent). Prod callers
      (jobs/index.ts) pass nothing.
  - **Scheduler** (`src/scheduler.ts`, spec in "Wave C — Scheduled
    jobs" above): startup tick + hourly setInterval (unref'd),
    in-memory last-run-period map (daily → UTC date, hourly → UTC
    hour), NO ledger (user decision). Period claimed BEFORE the run —
    a throwing job waits for the next period instead of retrying every
    tick. Ticks never throw; per-job catch → `job.failed` +
    `onJobError` (Sentry in prod). Logging IS the metrics surface:
    `job.completed` / `job.failed` in the typed LogEventCatalog with
    `job.name`, `job.trigger` (startup|interval), duration_ms,
    `job.items_processed`/`job.items_failed` (normalized per job in
    `jobs/index.ts`), `job.batch_full` (backlog signal). Accepted
    limitation: a dead scheduler emits nothing — liveness is "do I
    see job.completed lines in Railway". Wired in server.ts after
    listen (buildApp stays pure; the onClose hook registers BEFORE
    listen — Fastify forbids addHook on a listening instance, fixed
    2026-07-18). Timing divergences: all three jobs are now DAILY
    (2026-07-18: the two purge-superseded jobs relaxed from the crons'
    hourly — no urgency), running at the first tick after UTC
    midnight (or after a deploy). The scheduler's `hourly` period
    support stays (tested; Wave D+ may want it).
  - **S3Port additions**: `listObjects(prefix)` (recursive,
    ListObjectsV2 + ContinuationToken loop) and `deleteObjects(keys)`
    (DeleteObjects, 1000-key chunks). fakeS3: prefix-filtered list,
    Map deletes + recorded `deletedKeys`. One recursive-list +
    batch-delete case added to the optional s3 integration tier.
  - **Decommissioned three pg_cron entries** (user decisions; files
    deleted, guarded `cron.unschedule` + `DROP FUNCTION
    cleanup_expired_projects()` in `sql/graveyard.sql`; deployed
    LOCALLY — **user must run `supabase/sql/deploy.sh --remote`**):
    `assets-stale-cleanup` (upload flow being redesigned),
    `projects-delete-expired` (no auto-expiry for now),
    `render-jobs-purge` (broken, replaced by the server job). Local
    cron.job now shows only the two watchdogs + the two Pattern-B
    entries that stay until final decommission.
  - Tests (29 new): `test/jobs/projectsPurgeDeleted.test.ts` (6 —
    full pipeline incl. renders/ subkey recursive pin + mux-leak pin
    with pending+asset rows; skips recent/live; resume; mux-failure
    and storage-failure compensation; LIMIT 20. **Local-data safety:
    fakeClock pinned to 2000-01-01 so the 30-day cutoff predates the
    product — no real local row can match**),
    `test/jobs/muxVideosPurgeSuperseded.test.ts` (3) and
    `test/jobs/renderJobsPurgeSuperseded.test.ts` (3) — superseded
    purged / latest-completed survives (+ file, mp4 pin), pending
    never purged, NULL asset/path steps skipped, failure keeps row +
    batch continues; own-rows-only assertions via `onlyIds`;
    `test/scheduler.test.ts` (7, NO db — fakeClock + stub jobs +
    capture logger): startup runs all once, same-period dedup,
    hour/day boundary re-runs, fresh-instance re-run (documented
    deploy behavior), throwing job → tick survives + job.failed +
    onJobError, no same-period retry after failure, stop idempotent.
  - **Analysis:** dead weight — cron_render_purge (broken for its
    whole life), cron_cleanup_expired_projects (+ its SQL fn),
    cron_cleanup_pending_assets, and the edge fns' pg_net/bearer
    plumbing (server jobs need no HTTP surface at all).
    Simplification — no ledger table, no schema change; jobs are
    ~40-line functions; the scheduler is one file. Consistency — jobs
    take injected deps like routes, purge order (externals before
    row) is uniform via the shared helper, log events extend the
    existing typed catalog. Smells NOT fixed (suggested_changes.md):
    candidates LIMIT 50 with no ORDER BY and no is_deleted filter
    (is_deleted-but-not-superseded mux rows are never purged);
    purge only clears the created_by prefix (caller-prefixed files
    orphan); the still-live EDGE purge fn keeps both purge bugs until
    decommission; expires_at stamping now vestigial.
  - Checks: root `npx vitest run server` (228 passed), server
    typecheck, eslint clean on changed files.

- **Wave B #9 — `mux-video-create`** (code complete 2026-07-17; **user
  verified 2026-07-17**. **Two new REQUIRED env vars:
  `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`** (config.ts, .env.example — set
  them on Railway BEFORE deploying this); no new npm dependencies —
  the Mux adapter is raw fetch. Last plain Wave B route):
  - **Service extraction (the architectural payoff):** the
    render-job-create core (parity project read →
    `render_job_get_or_create` RPC → presigns → fire-and-forget worker
    dispatch) moved verbatim from the route into
    `src/services/renderJobs.ts#getOrCreateRenderJob(deps,
    { projectId, userId, cloudVersion, statusCallbackUrl, log })`; the
    route keeps schema/auth/editor check and delegates. **The
    renderJobCreate suite passed UNCHANGED — the refactor guard.**
    mux-video-create calls the service in-process, replacing the edge
    fn's service-role HTTP hop; the server never implements the
    service-role auth path (it dies with the edge fn at decommission).
  - Route: `server/src/routes/muxVideoCreate.ts` — `requireUser`; body
    `{ projectId minLength 1, cloudVersion Type.Integer({minimum:1}) }`
    (same Ajv-coercion reasoning as render-job-create); check-order
    parity: editor 404 (`getProjectIfEditor`, SELECT extended with
    `slug`) → no-slug 400 `Project not shared. Create a share link
    first.` → `mux_video_get_or_create($project, $OWNER, $version)`
    (**EXCLUSIVE to this route, explicit `p_user_id`, no auth.uid() →
    stays SQL over the pool**); `is_new` false → `{ status,
    muxVideoId }` as-is (completed cache-hit or pending dedup);
    new/retried → in-process render get-or-create — **ANY failure
    there marks the mux_video `failed` with error `Render dispatch
    failed` before rethrowing (pinned: no eternal pending)**; render
    already completed → `uploadToMux`; both kicked-off paths return
    `{ status: 'pending', muxVideoId }` (the Mux webhook, Wave D,
    completes the row).
  - **Attribution parity (pinned by test):** BOTH RPCs get the project
    OWNER's id — an explicit editor triggering this creates
    mux_videos/render_jobs rows and a render path under the OWNER's
    prefix, opposite of the direct /render-job-create route (caller).
  - `src/services/muxUpload.ts` — ports `_shared/muxUpload.ts` (shared
    on purpose: render-job-hook reuses it in Wave D). Presigned S3 GET
    of the render (divergence, documented: replaces the
    Supabase-Storage signed URL — same object, different URL flavor;
    Mux just fetches it) → `MuxPort.createAsset` → UPDATE
    mux_asset_id + render_storage_path (status STAYS pending). Failure
    contract kept with the exact edge-fn strings (`Failed to generate
    signed URL`, `Mux API request failed`, `Mux API error: <status>`) —
    distinguishing the last two needed a typed `MuxApiError(status)`
    on the port (adapters throw it for non-2xx, plain Error for
    transport). Also exports `markMuxVideoFailed` (the route's
    compensation uses it).
  - Adapter: `src/adapters/mux.ts` (first MuxPort adapter) — raw
    fetch, basic auth; `createAsset` POST `/video/v1/assets`
    `{ input: [{url}], playback_policy: ['public'] }` → `data.id`;
    `deleteAsset` with 404-as-success (Wave C mux-video-purge needs
    it — implemented now, it's 3 lines); `verifyWebhookSignature`
    fails loudly until Wave D lands `MUX_WEBHOOK_SECRET` + the HMAC
    check. Wired in server.ts (mux was the last `unimplementedPort`
    besides email).
  - Tests: `server/test/muxVideoCreate.test.ts` (22 — 401 no/garbage;
    schema 400s via throwing db incl. null/zero/non-integer
    cloudVersion; e2e: 404 unknown/soft-deleted/non-editor (DB
    unchanged); **400 not-shared exact body with zero RPC side
    effects**; completed cache-hit and pending dedup (no render job,
    no mux call); new+render-pending (job created under owner,
    dispatched with the render-job-hook callback, NO mux asset);
    new+render-completed (asset created from the presigned render URL,
    row gains mux_asset_id + render_storage_path, **status stays
    pending**, nothing re-dispatched); retry resets
    error/mux_asset_id/mux_playback_id/render_storage_path and reruns
    the pipeline; **render-failure compensation pin** (presignUpload
    throws inside the service → 500 + row failed `Render dispatch
    failed`); mux transport-vs-API failure string mapping (both →
    500 + row failed); **owner-attribution pin**; canonical log fields
    incl. mux.video_status + mux.asset_id) +
    `test/adapters/mux.test.ts` (5 — ephemeral local HTTP server via a
    `baseUrl` test override, merge-blocking tier; asserts basic auth,
    body shape, data.id extraction, MuxApiError snippet,
    404-as-success delete, webhook-secret loud failure). A real-Mux
    integration test is deliberately skipped: creating real assets
    costs storage and the adapter is two trivial calls. Helpers:
    `seedProject.slug` is now `string | null` (`=== undefined` check —
    NULL needed for the not-shared test); `seedMuxVideo` returns the
    row id and gained `muxAssetId`/`error` options.
  - Client: `Header.tsx#handleShare` converted to `invokeFunction`
    (typed response, fire-and-forget kept). Note: the old
    `.catch(captureError)` never fired for HTTP errors —
    `supabase.functions.invoke` resolves with `{ error }`, so failures
    were silently dropped; the converted `.then(({error}) => …)` now
    reports them to Sentry (small observability win, share flow still
    never blocks). `'mux-video-create'` in MIGRATED_FUNCTIONS.
  - **Analysis:** dead weight — the edge fn's service-role HTTP hop
    and render-job-create's service-role auth path (never ported); the
    Deno helper's `MUX_API_URL` env override (the adapter has a
    test-only `baseUrl` param instead). Simplification — the Mux SDK
    avoided (two REST calls, raw fetch like Whisper); the in-process
    render call removes a network hop, a service-role key use, and the
    double JSON round-trip. Consistency — same
    schema-400/exact-body/compensation patterns, `services/` reuse
    (projectAccess, renderJobs, muxUpload), canonical logging. Smells
    NOT fixed (suggested_changes.md): the RPC ignores `is_deleted`
    when matching rows; a crash between the RPC and the failure CATCH
    leaves a pending mux_video forever (no reaper); publish gives the
    user no feedback when this call fails (fire-and-forget by design);
    owner-vs-caller attribution asymmetry across the two render
    entry points.
  - Checks: root `npx vitest run server webapp/src/api` (209 + 9
    passed), server typecheck, webapp `tsc -b`, eslint clean on
    changed files (the 4 Header.tsx findings are pre-existing on
    HEAD).

- **Wave B #8 — `transcribe`** (code complete 2026-07-17; **user
  verified 2026-07-17**. **One new REQUIRED env var: `OPENAI_API_KEY`**
  (config.ts, .env.example); no new npm dependencies — the Whisper
  adapter is raw fetch):
  - Route: `server/src/routes/transcribe.ts` — `requireUser`; schema
    `{ projectId minLength 1 }`; check-order parity: project lookup
    (404 `Project not found`) → subscription gate (403 `Active
    subscription required`) → mic path (400 `Project has no microphone
    audio`) → `S3Port.getObject` → Whisper → merge. The pure
    post-processing (`addPunctuationFromSegments`, seconds→ms
    rounding, ±50 ms window grouping, empty-words short-circuit) is
    ported verbatim as exported route-module helpers with direct unit
    tests. `getProjectMicPath` added to `services/projectMedia.ts`.
  - **DB-function classification: `subscription_get` is SHARED and
    auth.uid()-dependent** — webapp calls it directly (AuthManager,
    BillingPage, switchWorkspace), so the SQL fn stays untouched; its
    membership+subscription read is ported INLINE with explicit
    `$user_id`. **The workspace_members JOIN is the endpoint's only
    access control** (no editor/owner check — gate = member of the
    project's workspace + active|trialing sub); non-member /
    no-subscription / wrong-status all collapse to the same 403
    (parity). Pinned by the non-member e2e test.
  - Adapter: `src/adapters/transcription.ts` (first TranscriptionPort
    adapter) — raw-fetch multipart POST to
    `api.openai.com/v1/audio/transcriptions` (Node 22 native
    FormData/File; model whisper-1, verbose_json, segment+word
    granularities, the verbatim edge-fn prompt); throws on non-2xx
    with a body snippet; **120 s AbortSignal.timeout** (documented
    addition per plan — Railway has no request ceiling; edge runtime's
    was ~150 s). Wired in server.ts.
  - Divergences (documented): schema 400 replaces `Missing projectId`;
    the 120 s adapter timeout; `S3_ENDPOINT_DEV`-first split dropped
    (server-side download from the host).
  - Tests: `server/test/transcribe.test.ts` (18 — 3 pure-helper units
    (punctuation restore incl. the mismatched-token heuristic, ±50 ms
    grouping with orphan-drop and empty-window skip); 401 no/garbage;
    schema 400s via throwing db; e2e: 404 unknown/soft-deleted, **403
    non-member with their own active sub elsewhere**
    (security-critical), 403 no-sub-row / canceled / past_due (note:
    past_due rejected here but accepted by project-create-v2 —
    inconsistency flagged, parity kept), 400 no-mic exact body,
    success with exact merged-segments assert (rounding + punctuation
    + windows) and recorded fileName/mime/byteLength, `.webm` mime
    mapping, empty-words → `{ segments: [] }`, canonical log fields
    incl. storage.bytes; every reject path asserts no S3 read/no
    Whisper call) + `test/adapters/transcription.integration.test.ts`
    (third-party tier, auto-skips without `OPENAI_API_KEY`; generated
    0.5 s WAV, shape asserts). `seedProject` gained `workspaceId`
    (transcribe tests need fresh workspaces — subscriptions key on
    workspace_id and the seeded personal workspaces are shared).
  - Client: `CloudTranscriptionService.transcribe` converted to
    `invokeFunction` (typed response). The error-body fallback chain
    (`body?.message || body?.error`) was DEAD code (data is always
    null alongside error, on the old supabase path too) — dropped; the
    now-typed `segments` mapping also let the two `seg/w: any`
    annotations go. `'transcribe'` registered in MIGRATED_FUNCTIONS.
    The local-Whisper worker path untouched.
  - **Analysis:** dead weight — the client's error-body fallbacks and
    `any` mappers; `S3_ENDPOINT_DEV`. Simplification — SDK dropped for
    one fetch; the user-client/admin-client split collapses to two
    pool queries. Consistency — services/ reuse (projectMedia), same
    exact-body/schema-400 pattern. Smells NOT fixed (in
    suggested_changes.md): no per-user rate limit on an expensive AI
    endpoint; whole audio buffered in memory; no in-flight dedup
    (double-trigger = two Whisper bills); active|trialing vs
    active|past_due inconsistency.
  - Checks: root `npx vitest run server webapp/src/api` (191 passed),
    server typecheck, webapp `tsc -b`, eslint clean on changed files.

- **Wave B #10 — `render-job-create`** (code complete 2026-07-17;
  **user verified 2026-07-17**. **Two new REQUIRED env vars:
  `RENDER_WORKER_URL`, `RENDER_SECRET`** (config.ts, .env.example, root
  .env.test); no new npm dependencies):
  - Route: `server/src/routes/renderJobCreate.ts` — `requireUser`;
    body schema (`projectId` minLength 1, `cloudVersion`
    `Type.Integer({ minimum: 1 })` — the bound also stops Ajv coercing
    a null into 0); editor check via the existing
    `services/projectAccess.getProjectIfEditor` (404 `Project not found
    or access denied`), second project read kept for parity (race-only
    404 `Project not found`); **first route calling a `sql/functions/`
    DB function over the pool** — `render_job_get_or_create($1,$2,$3)`
    stays SQL (explicit `p_user_id`, no auth.uid(); atomic
    cache-hit/dedup/retry/insert); on `is_new`: presign GETs for all
    media in project_data (via new `services/projectMedia.ts`, ports
    the `_shared` copy) + PUT for the output path (3600 s), then
    **fire-and-forget dispatch** (`void submitJob().catch(log.warn)` —
    response never waits; stale-job cron is the safety net, parity).
    `render.job_id` already existed in DomainLogFields.
  - **AUTH SCOPE (user decision 2026-07-16): user-JWT path only.** The
    edge fn's service-role path (internal caller mux-video-create)
    keeps hitting the EDGE function until #9 migrates, then becomes an
    in-process call.
  - Adapter: `src/adapters/renderWorker.ts` (first RenderWorkerPort
    adapter) — one POST `/render` with bearer secret; throws on non-2xx
    (edge fn ignored it — observability-only divergence, response
    unaffected). Wired in server.ts; statusCallbackUrl =
    `${SUPABASE_URL}/functions/v1/render-job-hook` built in app.ts
    (stays the SUPABASE hook until Wave D; the `RENDER_CALLBACK_URL_DEV`
    split is dropped).
  - **CI fix (drift found):** the baseline migration carries a STALE
    snapshot of `render_job_get_or_create` (pre attempt_count), so a
    fresh `supabase start` ≠ production SQL. `server-tests.yml` now
    runs `supabase/sql/deploy.sh` after supabase starts; the retry test
    pins the current version's attempt_count bump. General drift issue
    logged in suggested_changes.md.
  - Divergences (documented): schema 400s replace per-field bodies;
    cloudVersion must be an integer ≥ 1 (edge fn only checked
    non-null); adapter throws on non-2xx worker responses (logged,
    never surfaced).
  - Tests: `server/test/renderJobCreate.test.ts` (21 — 401 no/garbage
    token; schema 400s (missing/empty projectId,
    missing/null/zero/non-integer cloudVersion) via throwing db with
    no-dispatch asserts; e2e on real Postgres: 404 unknown /
    soft-deleted / non-owner-non-editor with DB-unchanged, new-job
    success (row fields, all five media kinds presigned, upload
    presign, full submission payload incl. statusCallbackUrl), empty
    project_data → empty mediaUrls but still dispatches, cache-hit
    completed (no new row/presign/dispatch), dedup pending (same row,
    no dispatch), **retry: failed → pending, attempt_count 2, same row
    re-dispatched**, editor renders under the CALLER's id prefix
    (parity subtlety), fire-and-forget worker throw still 200,
    canonical log fields incl. render.job_id) +
    `test/adapters/renderWorker.test.ts` (2 — real HTTP round-trip
    against an ephemeral local server, runs in the blocking tier).
    `seedRenderJob` added and `seedProject` gained `projectData`.
  - Client: `useCloudRender`'s invoke converted to `invokeFunction`
    (typed response); `'render-job-create'` registered in
    `MIGRATED_FUNCTIONS`. Polling (`render_job_get_status` RPC) and
    download stay untouched.
  - **Analysis:** dead weight — `duration_ms` selected but never used
    (dropped); the edge fn's "checks Pro subscription" header comment
    is stale, no such check exists (any editor renders — flagged);
    `RENDER_CALLBACK_URL_DEV`. Simplification — the dual-client
    (user + admin) construction collapses to the pool + one access
    check; media presigning through S3Port. Consistency — same
    services/ pattern, fire-and-forget made explicit and logged.
    Smells NOT fixed (in suggested_changes.md): lost dispatch leaves a
    pending job with no user feedback until the stale-job cron; retry
    regenerates the output path under the RETRYING caller's prefix;
    quality hardcoded '1080p'; migrations-vs-sql/ function drift.
  - Checks: root `npx vitest run server webapp/src/api` (173 passed),
    server typecheck, webapp `tsc -b`, eslint clean on changed files
    (useCloudRender's 6 `no-explicit-any` findings pre-exist on HEAD). **#11 `project-create` is
dead code — not ported (user decision 2026-07-16):** its caller chain
(`CloudStorage.createProject` ← `importRecordingLocal`) has no webapp
callers; only the V2 pipeline is used (ImportPage →
`importRecordingLocalV2`). Decommission with stripe-add-seats at the
end; logged in suggested_changes.md. After this batch the remaining
functions all carry a new dependency or new infra: #8 `transcribe`
(external transcription API), #9 `mux-video-create` (Mux adapter),
Wave C crons (in-process scheduler), Wave D webhooks (provider
config), Wave E emails (Resend adapter).

- **Wave B #12 — `project-create-v2`** (code complete 2026-07-17;
  **user verified 2026-07-17**. No new env vars, no new dependencies):
  - Route: `server/src/routes/projectCreateV2.ts` — `requireUser`;
    TypeBox body schema (`project` object requiring only `id`, with
    **`additionalProperties: true` — load-bearing**: Fastify's Ajv
    strips unknown body properties otherwise, which would destroy the
    arbitrary editor struct headed for `project_data`; pinned by a
    round-trip test); stamps `${userId}/${projectId}/screen.webm` /
    `camera.webm` / `mic.wav` into the struct for whichever sources
    exist BEFORE the upsert; subscription status `active`|`past_due` →
    `expires_at` NULL else now + 14 days via **`deps.clock.now()`**
    (first route using the Clock port — expiry pinned exactly in
    tests); `duration_ms` = rounded `timeline.durationMs` (falsy → NULL,
    parity); name defaults 'Untitled'; single
    INSERT … ON CONFLICT (id) DO UPDATE matching PostgREST upsert
    semantics. Response `{ projectId, bucket: 'project-media',
    uploads: [{ fileType, storagePath }] }`. No S3 — the TUS upload
    stays on Supabase Storage REST (Part 4); `project_confirm_upload`
    RPC stays client-called.
  - **DB-function classification: none called** — one subscriptions
    read + one projects upsert, plain SQL over the pg pool.
  - Divergences (documented): per-field 400 bodies (`Missing
    workspaceId`, `Missing project or project.id`) replaced by Fastify
    schema-validation 400s; non-UUID ids 500 at the pg cast (edge fn
    500'd via PostgREST too, different shape).
  - Tests: `server/test/projectCreateV2.test.ts` (18 — 401 no/garbage
    token; schema 400s (missing/empty workspaceId, missing project,
    project without/with-empty id) via throwing db; e2e on real
    Postgres: full three-source success with row-field + stamped
    project_data asserts, screen-only, **round-trip test** (deep
    unknown fields incl. settings/userEvents/arbitrary keys stored
    verbatim — the removeAdditional pin), expires_at matrix
    (active/past_due → NULL; trialing/canceled/no-row → exactly
    now+14d via fakeClock), name default + duration_ms NULL, upsert
    second-call-updates with row-count-1 assert, canonical log fields).
  - Client: `cloudStorage.createProjectV2` converted to
    `invokeFunction` (typed response; the `quota_exceeded` branch is
    vestigial — nothing returns it — kept as-is, noted in
    suggested_changes); `'project-create-v2'` registered in
    `MIGRATED_FUNCTIONS`.
  - **Analysis:** dead weight — the entire v1 sibling (`project-create`
    + `CloudStorage.createProject` + `importRecordingLocal`) is dead
    code, not ported; the client's `quota_exceeded` error branch is
    vestigial (no code path ever returned it). Simplification — the
    three copy-paste source blocks collapse to one loop; per-request
    admin-client construction gone. Consistency — Clock port for
    time-dependent logic (new precedent), schema 400s, exact PostgREST
    upsert column set preserved. Smells NOT fixed (in
    suggested_changes.md): no workspace membership check; upsert
    takeover — a known project id can be overwritten and re-owned by
    any authed user; `past_due` grants non-expiring projects.
  - Checks: root `npx vitest run server webapp/src/api` (152 passed),
    server typecheck, webapp `tsc -b`, eslint clean on changed files
    (cloudStorage's `project_data: any` pre-exists on HEAD).

- **Wave B #7 — `asset-create`** (code complete 2026-07-16; **user
  verified 2026-07-16**. No new env vars, no new dependencies):
  - Route: `server/src/routes/assetCreate.ts` — `requireUser`; TypeBox
    body schema (`assetType` background|music literal union, `fileName`
    minLength 1, `sizeBytes` exclusiveMinimum 0); handler checks with
    exact edge-fn bodies for the cross-field rules (extension allow-list
    per type, size caps 25 MB background / 50 MB music); library limit
    10 per type counting only `status='ready' AND is_deleted=false`;
    pending `user_assets` insert (id TEXT, fresh uuid); presigned PUT
    via `S3Port.presignUpload` (3600 s); **compensating cleanup** — if
    presigning throws, the pending row is DELETEd before rethrowing
    (first route with the pattern). `asset.type` added to
    `DomainLogFields`. The `asset_confirm_upload` RPC stays a
    client-called SQL function — untouched.
  - **DB-function classification: none called** — direct `user_assets`
    count/insert/delete, plain SQL over the pg pool.
  - **Deliberate FIX (user-approved 2026-07-16), not parity:** the
    library-full response is **200 with the exact rich body**
    `{ error: 'library_full', message, count, limit }` where the edge fn
    sent 403 — `supabase.functions.invoke` turns any non-2xx into
    `data: null` + a generic error, so the client's
    `AssetLibraryFullError` branch was dead code. With 200,
    `invokeFunction` hands the body to the existing branch verbatim —
    zero client-logic changes. The flag-off/edge-fn path keeps the old
    broken-generic behavior until cutover.
  - Other divergences (documented): per-field 400 bodies replaced by
    Fastify schema-validation 400s (same as all waves); a
    numeric-STRING `sizeBytes` (e.g. `"2048"`) is coerced by Fastify's
    default Ajv where the edge fn's `typeof` check 400'd — pinned by
    test, noted in suggested_changes.md (client always sends a number);
    the `S3_ENDPOINT_DEV` Docker split stays dropped.
  - Tests: `server/test/assetCreate.test.ts` (22 — 401 no/garbage
    token; schema 400s incl. sizeBytes 0/negative/non-numeric-string
    via throwing db; exact-body 400s for wrong-type extensions (both
    types), extensionless name, one-byte-over both caps with no
    presign; e2e on real Postgres: success with lowercased-extension
    storagePath + 1h presign + full pending-row field assert, at-cap
    boundary passes both types, library-full 200 exact body with NO
    insert, soft-deleted/pending rows don't count, limit is per-type
    and per-user, **presign-failure → row deleted → 500**
    (compensating-cleanup test), Ajv-coercion divergence pin, canonical
    log fields incl. asset.type). `seedUserAsset` + `deleteUserAssets`
    added to `test/helpers/db.ts` (`user_assets.id` is TEXT).
  - Client: `userAssetService.uploadAsset`'s asset-create invoke
    converted to `invokeFunction` (typed response; `library_full`
    branch untouched — that's the point of the fix); `'asset-create'`
    registered in `MIGRATED_FUNCTIONS`. `!supabase` guard kept (the
    confirm RPC and list/delete still use supabase directly).
  - **Analysis:** dead weight — the S3_ENDPOINT_DEV split (Docker
    artifact) and the edge fn's per-field typeof checks (schema does
    it). Simplification — service-role client + raw fetch presign
    machinery collapses to one count, one insert and a port call.
    Consistency — same throwing-db/e2e split, exact-body handler checks
    and Union-200 response schema as subscription-change. Smells NOT
    fixed (in suggested_changes.md): extension parsed from fileName
    only, never checked against actual content; count+insert not
    atomic (concurrent uploads can exceed the limit); pending rows that
    never get confirmed are never reaped.
  - Checks: root `npx vitest run server webapp/src/api` (134 passed, S3
    + Stripe adapter integrations skipped), server typecheck, webapp
    `tsc -b`, eslint clean on changed files (userAssetService's
    `row: any` in asset_list mapping pre-exists on HEAD).

- **Wave A #6 — `project-update-thumbnail`** (code complete 2026-07-16;
  **user verified 2026-07-16 — Wave A complete.** No new env vars;
  new server dependency `@fastify/multipart`):
  - Route: `server/src/routes/projectUpdateThumbnail.ts` — first
    MULTIPART route (plugin registered in the route module's scope,
    1 MB fileSize backstop above the 500 KB business cap) and first
    direct server-side S3 upload (`S3Port.putObject`, already existed).
    `requireUser`; no body schema (TypeBox doesn't validate multipart —
    field presence checked in-handler, exact edge bodies kept:
    400 `Missing projectId or file`, 413 `Thumbnail too large: <n> bytes
    (max 512000)`, 404 `Project not found or access denied`).
    `storage.bytes` added to `DomainLogFields`.
  - **DB-function classification: none called** — direct `projects` /
    `project_editors` reads + one UPDATE. `_shared/projectAccess.ts`'s
    `getProjectIfEditor` ported as the FIRST shared server module
    (`src/services/projectAccess.ts`, plain function over the Db port —
    the services convention from suggested_changes.md); it's also needed
    by mux-video-create and render-job-create in Wave B, whose Deno copy
    stays live until then. The edge fn's two queries collapse to one
    OR-EXISTS (parity-safe: not-found and no-access are both null → one
    404).
  - Deliberate divergences (documented): a malformed non-UUID projectId
    500s (the Deno helper swallowed the PostgREST error → 404; no caller
    sends one); an absurdly-oversized upload (>1 MB backstop) gets
    @fastify/multipart's default-body 413 instead of the interpolated
    edge body (the exact body covers everything ≤1 MB); the edge fn's
    `S3_ENDPOINT_DEV` Docker split is dropped (server runs on the host).
  - Tests: `server/test/projectUpdateThumbnail.test.ts` (11 — 401;
    exact-body 400 missing projectId / missing file; exact interpolated
    413 with no S3 put — all pre-query via throwing db; e2e on real
    Postgres: 404 unknown / soft-deleted / non-owner-non-editor with
    DB-unchanged assert, owner 200 with S3 key/bytes/content-type + DB
    row updated, explicit project_editors editor 200 incl. the
    caller-id-prefix parity subtlety, overwrite second upload same path,
    canonical log fields incl. storage.bytes). Multipart payloads built
    via `new Response(FormData)` (body + boundary header, no new dev
    deps). `seedProjectEditor` added to `test/helpers/db.ts`.
  - Client: `invokeFunction` learned **FormData passthrough** (body
    passed untouched, no `Content-Type` header so the browser sets the
    multipart boundary; supabase fall-through path unchanged) +
    client.test.ts coverage; `cloudStorage.uploadThumbnail` converted
    (redundant `!supabase` guard dropped); `'project-update-thumbnail'`
    registered in `MIGRATED_FUNCTIONS`.
  - **Analysis:** dead weight — the `S3_ENDPOINT_DEV` fallback (Docker
    artifact). Simplification — access check collapsed to one query;
    fields parsed in a single parts() pass. Smells flagged NOT fixed (in
    suggested_changes.md): ContentType hardcoded `image/webp` and file
    content never validated as an image; S3 put → DB update not atomic
    (orphan object on crash — harmless, deterministic path); an editor's
    upload lands under the CALLER's id prefix, so the row repoints and
    the owner's previous thumbnail object is orphaned; the Deno
    getProjectIfEditor swallows DB errors as "no access".
  - Checks: root `npx vitest run server webapp/src/api` (112 passed, S3
    + Stripe adapter integrations skipped), server typecheck, webapp
    `tsc -b`, eslint clean on changed files (cloudStorage's
    `project_data: any` finding at line 48 pre-exists on HEAD).

**Suggested-changes log:** `plans/suggested_changes.md` is the running
document for smells, dead code, and cleanup candidates found during
migration work but deliberately not fixed (parity first). Every agent
working a migration step must ADD new findings there (the per-function
analysis paragraph in this Status stays the summary; the log is the
actionable list). The former "cleanup candidates" list moved there.

**Wave A #2 carries a CI change:** it's the first route whose merge-blocking
e2e tests need a real Postgres, so `.github/workflows/server-tests.yml` must
spin up the local stack (`supabase/setup-cli` → `supabase start`) and run
tests via the **root** vitest config (which loads the committed `.env.test`
— all well-known local-stack values, no GitHub secrets needed). The auth
contract tests start running in CI for free at that point. The adapter
integration tier stays out of the blocking job (separate optional job,
later).

Known pre-existing failure (not this migration's): `cloudProjectService.test.ts
> passes expected version to CloudStorage` — stale expectation, `saveProject`
no longer passes the 4th `true` arg to `saveProjectMetadata`.

### Step 3 implementation notes (recon done, for the next session)

- The supabase client lives at `webapp/src/supabase/client.ts` — exports
  `supabase` (nullable!) and `setUnauthorizedHandler`; its `authAwareFetch`
  already funnels any 401 → `AuthManager.signOut()`. The new API client must
  route its own 401s through the same funnel.
- `supabase.functions.invoke` call sites found in `webapp/src` (12):
  `storage/userAssetService.ts` (asset-create); `storage/cloudStorage.ts`
  (project-create, project-create-v2, project-update-thumbnail,
  storage-download-urls); `pages/VideoPage.tsx` (shared-video-get);
  `billing/StripeService.ts` (stripe-checkout, subscription-change,
  stripe-portal); `editor/transcription/CloudTranscriptionService.ts`
  (transcribe); `editor/components/settings/useCloudRender.ts`
  (storage-download-urls, render-job-create);
  `editor/components/header/Header.tsx` (mux-video-create).
- **Resolved (was an open check):** `stripe-add-seats` has **zero callers**
  anywhere in the repo — dead edge function; don't port, list it for
  decommission (user to confirm). `send-workspace-invite` is **DB-invoked**:
  `supabase/sql/functions/workspace_invite.sql` (a client-called RPC) fires it
  via `net.http_post` — it migrates in Wave E (repoint the URL inside that SQL
  function), not Wave A.
- Wrapper design: `invokeFunction(name, body)` returns the supabase-shaped
  `{ data, error }`; routes to `${VITE_API_URL}/${name}` (Bearer = current
  session token) only when `VITE_USE_SERVER === 'true'` AND name is in the
  migrated-functions registry; otherwise falls through to
  `supabase.functions.invoke`. Call sites convert per function, in the same
  change as that function's server port.

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

## Step 0.6 — Parity fixture harness — SKIPPED (decision 2026-07-13)

Dropped: the edge functions have no test seams or mocks, so captured
fixtures would only enshrine untested, poorly-understood behavior.
Replacement per function:

- Comprehensive tests written fresh with the port (e2e against real seeded
  local Postgres + unit against fakes) — the tests define the contract,
  informed by reading the edge function, not by recorded traffic.
- The client call site moves behind the `USE_SERVER_INSTEAD_OF_SUPA` flag
  (Step 3) in the same change, and the user verifies the function manually
  in local dev with the flag on before cutover.
- Response shapes still stay identical to the edge function (no client type
  changes); any deliberate behavior change is called out explicitly in the
  PR description.

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
- **Global flag `USE_SERVER_INSTEAD_OF_SUPA`** (from `VITE_USE_SERVER`,
  defaults to false): an `invokeFunction(name, body)` wrapper routes to the
  Fastify server only when the flag is on AND the function is in the
  wrapper's migrated-functions registry; otherwise it falls through to
  `supabase.functions.invoke`. This keeps cutover per-function (the registry)
  while giving one switch to flip during local development, and makes
  rollback a flag flip.
- Route-by-route, `supabase.functions.invoke('x')` → the wrapper
  (~13 call sites). The client side of each function moves in the same
  change as its server port. Keep response shapes identical — no client
  type changes.

## Step 4 — Migrate routes in risk order

Each route: port → **write comprehensive tests** → tests green (end-to-end
+ idempotency where applicable) → switch the client call site behind the
flag → **user verifies manually in local dev with the flag on** → deploy →
cut over → observe → **pause**. Tests are part of each function's migration,
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
`supabase.rpc(...)` names). The e2e tests gate the ported logic: same
inputs must produce the same response **and the same resulting DB state** as
the edge function + SQL pair they replace (asserted by tests derived from
reading the edge function, plus the user's manual local verification).

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
  behavior beyond what's explicitly called out — record it in
  `plans/suggested_changes.md` (the running log every migration step adds
  to) as well as summarizing it in this plan's Status entry.

Discipline: simplification must not silently change the contract. Anything
that alters an observable response is called out explicitly in the PR
description with a one-line justification — the diff between "cleaner" and
"different" stays visible. Internal cleanups (fewer queries, clearer code)
need no callout, but the end-to-end tests must still pass against the same
seeded data and expected DB state.

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
ports, and test harness are proven on lower-stakes routes.

### Wave A — Client-invoked, low risk (simple request/response)
1. ~~`storage-download-urls`~~ (S3 presign) — code complete 2026-07-13, see
   Status; awaiting user local verification + cutover.
2. `shared-video-get` (public, no auth — add rate limit)
3. `stripe-checkout`, `stripe-portal`, `subscription-change` (these call
   Stripe's API but are plain request/response — no Stripe dashboard changes
   needed, unlike webhooks). ~~`stripe-add-seats`~~ — dead code, zero callers
   anywhere in the repo; don't port, decommission instead (user to confirm).
4. ~~`send-workspace-invite`~~ — moved to Wave E: it's invoked from the DB
   (`workspace_invite.sql` via `net.http_post`), not by the client.
5. ~~`unsubscribe`~~ — punted to Wave E (user decision 2026-07-16): it has
   no webapp call site — its "caller" is the URL embedded in sent emails
   by `send-welcome-email` (Wave E), so its real cutover is that email-URL
   change. Prompt already written:
   `plans/fastify-part7-unsubscribe-prompt.md` (incl. the token-secret
   gotcha: tokens are HS256-signed with SUPABASE_SERVICE_ROLE_KEY as the
   HMAC secret — legacy `eyJ…` vs new `sb_secret_…` value mismatch would
   400 every old link).
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
11. ~~`project-create`~~ — dead code (user decision 2026-07-16): the v1
    import pipeline (`CloudStorage.createProject` ←
    `CloudProjectService.importRecordingLocal`) has zero webapp callers —
    only the V2 pipeline is used. Don't port; decommission at the end
    alongside stripe-add-seats.
12. `project-create-v2` — port the function, but the TUS upload itself keeps
    going to Supabase Storage REST (storage migration is Part 4). Only the
    project-row orchestration moves.

### Wave C — Scheduled jobs (in-process scheduler, not pg_cron→HTTP)
Only the two pure-SQL WATCHDOG crons stay in pg_cron, untouched,
indefinitely: `cron_render_stale_jobs` (every minute — heartbeat
timeouts are inherently time-based, and pg_cron keeps running during
server deploys, exactly when stale-detection gaps hurt) and
`cron_mux_video_stale_jobs`. The other three pg_cron entries are
DECOMMISSIONED in part13 (explicit user decisions; sql/ file deleted +
graveyard unschedule; user applies `--remote`):
- `cron_cleanup_pending_assets` (2026-07-17: asset uploads will be
  redesigned to go through the server; the cron also leaked uploaded
  blobs).
- `cron_cleanup_expired_projects` (2026-07-18: no auto-expiring
  projects for now; project-create-v2's `expires_at` stamping becomes
  vestigial — logged, not changed).
- `cron_render_purge` (found 2026-07-17: BROKEN — posts hourly to a
  `render-purge` edge function that doesn't exist, silent pg_net
  404s, old-version render files never purged; its intent becomes the
  `render_jobs.purge-superseded` server job).

**Parity is loosened for this wave (user decision 2026-07-17):** crons
are off the user path and the edge-fn versions are buggy — part13
FIXES the bugs (Mux-asset leak on project purge, non-recursive
storage list, the broken render purge) instead of porting them.

**Job naming (user decision 2026-07-18):** `{table}.{verb}-{qualifier}`
— table exactly as in Postgres, closed verb set (`purge` = destroy
rows + externals, `expire` = TTL flip, `fail-stale` = watchdog;
"cleanup" banned as vague), dot mirrors the log-field namespacing.

Three in-process server jobs — no HTTP surface, no bearer tokens, no
pg_cron URL config:
13. `projects.purge-deleted` (ports edge fn `purge-deleted-projects`, daily)
14. `mux_videos.purge-superseded` (ports edge fn `mux-video-purge`;
    daily — the old cron was hourly, relaxed 2026-07-18: purges have
    no urgency)
14b. `render_jobs.purge-superseded` (NEW — replaces the broken
     `cron_render_purge`, daily)
The two Pattern-B pg_cron entries backing #13/#14 are **not** deleted —
the user disables/removes them manually at final decommission. Until
then both the old cron and the new server job may run in overlap; this
is harmless because all jobs are delete-by-condition (the second
runner finds nothing to delete).

**Scheduler design (deliberately minimal; user decision 2026-07-17 —
NO `job_runs` ledger table):**
- A job is a plain function taking injected deps (ports + `Clock`) — unit
  tested exactly like route handlers, no scheduler involved in tests.
- One `setInterval` tick (hourly) plus a tick on startup. Each tick, for each
  registered job: compute the current period (daily → UTC date, hourly →
  UTC hour) and run if an **in-memory** last-run-period map says it hasn't
  run this period. No DB claim: the jobs are delete-by-condition and fully
  re-run/double-run safe, so a deploy resetting the map (startup tick
  re-runs) or a brief two-instance overlap is harmless — a ledger table
  was considered and rejected as complexity that buys nothing for
  idempotent jobs (single-person-company rule: all state fits in one head,
  one place to look).
- Observability = the log events, viewed as metrics in Railway logs: one
  canonical `job.completed`/`job.failed` event per run (job name, trigger
  startup|interval, duration_ms, items processed/failed, batch-full flag).
  Known accepted limitation: a dead scheduler emits nothing — liveness is
  "do I see job.completed lines", no absence monitor.

### Wave D — Webhooks (last: provider-side config + hardest e2e)
15. `render-job-hook` — after cutover, `render-job-create` switches the
    `statusCallbackUrl` it hands out (completes Wave B #10); render worker
    honors both URLs during overlap so in-flight jobs finish cleanly.
16. `mux-video-hook` — repoint webhook URL in Mux dashboard.
17. `stripe-webhooks` — add a second webhook endpoint in Stripe pointing at
    Fastify, verify events arrive and are handled, then disable the Supabase
    endpoint. Handlers must be idempotent (Stripe redelivers) — NOTE
    (verified 2026-07-17): the CURRENT edge fn has no processed-events
    ledger; idempotency is the upserts being naturally re-run safe (plus
    `event.created` ordering guards). Port that as-is — a ledger table
    would be a NEW addition, only add one if a handler turns out not to be
    upsert-idempotent (user simplicity rule, same call as Wave C's
    dropped job_runs).

### Wave E — DB-triggered
18. `send-welcome-email` — the `auth.users` trigger calls an HTTP endpoint;
    repoint the trigger's URL (pg_net) at Fastify, bearer-token protected.
    Idempotent: welcome-email-sent flag on the profile row (trigger retries
    must not double-send).
19. `send-workspace-invite` (moved from Wave A) — invoked by the
    `workspace_invite` SQL RPC via `net.http_post`; port the route
    (bearer-token protected) and repoint the URL inside that SQL function.
20. `unsubscribe` (moved from Wave A, 2026-07-16) — GET/public/HTML email-link
    target; migrate alongside `send-welcome-email` (#18), which generates its
    tokens and embeds its URL. Prompt:
    `plans/fastify-part7-unsubscribe-prompt.md`. Old emails (tokens live
    365 days) keep hitting the edge-fn URL — keep-alive/redirect/let-break
    is a decommission-time decision.

## Step 5 — Decommission (manual, done by hand at the very end)

This step is **not performed by the migration** — it is a checklist for the
user to execute manually once all waves have soaked:

- Verify: `grep -r "functions.invoke" webapp/` returns nothing; Supabase
  dashboard shows zero edge function invocations over a full week.
- Delete edge functions from the Supabase project.
- Remove the pg_cron entries for `cron_purge_deleted_projects` and
  `cron_mux_video_purge` (only the two watchdog crons remain by then —
  `cron_render_stale_jobs`, `cron_mux_video_stale_jobs`; the other
  three were decommissioned in part13).
- Drop the orphaned SQL functions whose logic migrated to TS (each function's
  migration PR lists the DB functions it orphaned — collect them here as the
  waves progress).
- Remove `supabase/functions/` deploy from CI/scripts; keep `_shared` history.

## Testing strategy — the pyramid

**End-to-end per function (the primary tier — definition of done):**
`app.inject()` against `buildApp()` with a **real seeded local Postgres**
(`supabase start`) and fakes only for third parties. One suite per migrated
function, written with the port, exercising the full path: routing, TypeBox
validation, auth wiring, the migrated TS/SQL logic, and the resulting DB
state. See "Per-function testing" in Step 4 for seeding/isolation mechanics.

**Auth tokens in e2e are hand-signed, not real (decision 2026-07-14):**
after `requireUser`, a token is reduced to `req.userId`/`req.user.email`
strings — real and hand-signed tokens with the same `sub` are
indistinguishable downstream, and unlike the edge functions the server
never forwards the JWT to Postgres (no RLS path; ownership checks are
explicit route code). So per-route e2e mints tokens via
`test/helpers/tokens.ts` (`sub` must still be a *seeded* user id wherever
FKs apply — the row must be real, the token needn't be). The
"does the server accept what Supabase actually issues" contract is pinned
exactly once, centrally, in `auth.contract.test.ts` (real local-Supabase
sign-in, ES256/JWKS path, anon-key rejection — auto-skip without env).
Exception: if a future route forwards the raw bearer token to an external
service as the user, that route's e2e must use a real token.

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

- Step 0–3 (skeleton, ports/fakes, logging foundation, auth, helpers,
  client module): the foundation chunk — deliberately front-loaded. The
  ports and fakes feel like overhead before the first route ships, but they
  are what make Waves A–E mechanical instead of risky, and they're the whole
  point of the testability focus.
- Wave A: mechanical, batchable — the first proof that the fake harness
  pays off, on the lowest-stakes routes.
- Wave B: the fiddly 30% — S3 multipart, render-worker coordination. Budget
  most of the review attention here; also where the fakes (S3Port,
  RenderWorkerPort) earn their keep, since the real services are the hardest
  to exercise manually.
- Waves C–E: small code, but each involves external configuration (deleting
  pg_cron entries, Stripe/Mux dashboards, pg_net trigger URL) — the risk is
  in the cutover choreography, not the handlers, which is exactly why they
  come after the server is proven.

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

- **Wave A #3 (3/3) — `subscription-change`** (code complete 2026-07-16;
  awaiting user verification — local webapp flag-on: preview + apply a
  seat change on a teams workspace (sandbox Stripe), then against Railway
  after deploy. Webhook overlap is harmless (re-syncs the same values).
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

**Next:** user verifies `subscription-change` — local webapp flag-on
(preview + apply a seat change on a teams workspace, sandbox Stripe),
then against Railway after deploy. Wave A #3 is then fully done. After
that: Wave A #5 `unsubscribe` (decide the old-emails-URL question first
— old sent emails link to the Supabase edge fn URL) and #6
`project-update-thumbnail`, each on explicit go.

Cleanup candidates noted 2026-07-16 (separate from the migration):
- Make `SUPABASE_JWT_SECRET` optional in `server/src/config.ts` — prod
  signs ES256 only (legacy HS256 key rotated out ~6 months ago); the
  secret path serves local/test hand-signed tokens.
- Migrate the prod webapp's legacy `eyJ…` anon key to the new
  `sb_publishable_…` key, **then** revoke the previous JWT signing key in
  the Supabase dashboard — not before, revoking breaks legacy API keys.
- `webapp/.env` (gitignored) holds server-side secrets (live Stripe secret
  key, Resend, Mux) that aren't `VITE_`-prefixed and don't belong there.

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
  behavior beyond what's explicitly called out — record it in the plan/issue
  tracker instead.

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
19. `send-workspace-invite` (moved from Wave A) — invoked by the
    `workspace_invite` SQL RPC via `net.http_post`; port the route
    (bearer-token protected) and repoint the URL inside that SQL function.

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

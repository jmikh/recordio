# Part 6 prompt — Wave A #3 (3/3): subscription-change

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3 and Wave A #1
(storage-download-urls), #2 (shared-video-get), #3.1 (stripe-checkout),
#3.2 (stripe-portal) — all user-verified against Railway. The prod-webapp
flag flip stays deferred to the END of the migration — do NOT push cutover
env vars into `webapp/.env`.

Your task: **subscription-change** only — the first route with a DB WRITE.
Do not start Wave A #5 (unsubscribe) until I explicitly say go; it needs
the old-emails-URL decision first.

1. Read `supabase/functions/subscription-change/index.ts`. It calls ONE
   DB function: `subscription_workspace_get` (SECURITY DEFINER,
   `supabase/sql/functions/subscription_workspace_get.sql`).
   Classification is already done: **exclusive** — its only caller is this
   edge fn (the SQL file's "Called by: WorkspaceSettingsPage billing tab"
   comment is stale; grep confirms zero webapp/RPC callers). Port its
   logic inline; the SQL function stays in Supabase untouched but becomes
   orphaned — note it for the Step 5 decommission checklist. It couldn't
   be called via the Db port anyway: it asserts admin via
   `assert_workspace_admin`, which checks `wm.user_id = auth.uid()` —
   NULL over the server's pg pool (same gotcha as stripe-portal).
   **Inline port must keep the 403/404 split:** the RPC RAISEs PT403 for
   non-admin/deleted-workspace (edge fn catches the RPC error → 403
   `{ error: 'Unauthorized or subscription not found' }`), but returns
   NULL for admin-with-no-subscription (→ 404). One combined query loses
   that distinction — either two queries (admin check, then subscription)
   or one LEFT JOIN with a discriminating column. Admin semantics:
   `workspace_members.role = 'admin'` AND `workspaces.deleted_at IS NULL`.
   Also collapse the edge fn's second, service-role read of the SAME
   subscriptions row (step 2, stripe ids) into the first query — over the
   pg pool there is no user-scoped-vs-service-role split, so one query can
   return status/plan/billing_interval/seats/stripe_subscription_id/
   stripe_customer_id together. Keep both 404 bodies distinct as in the
   edge fn ('No subscription found for this workspace' vs 'No Stripe
   subscription linked to this workspace'). Write the analysis paragraph
   (dead weight / simplification / consistency / smells-not-fixed) as in
   previous waves. Known dead weight to note: the `plan === 'teams' &&
   newPlan === 'pro'` downgrade check is unreachable (newPlan must be
   'teams' by then); the DEBUG console.log blocks drop entirely
   (console.* is banned; contribute fields to req.logCtx instead).

2. Port as `server/src/routes/subscriptionChange.ts` following
   `stripePortal.ts`/`stripeCheckout.ts` as the pattern: TypeBox request
   AND response schemas, `requireUser`, price ids via the existing
   `AppOptions.stripePriceIds` (**no new env vars** — checkout already
   made all five Stripe vars required). Body:
   `{ workspaceId, newPlan, newSeats, newInterval?, dryRun }`.
   Schema decisions (document each as a divergence):
   - `newPlan: Type.Literal('teams')` — schema 400 replaces the edge fn's
     400 'Only upgrades to Teams are supported' (no call site reads 400
     bodies).
   - `newSeats: Type.Integer({ minimum: 1 })` — edge fn allowed floats;
     tightening, call it out.
   - `newInterval` optional monthly|yearly enum.
   - **`dryRun: Type.Boolean()` REQUIRED** — the edge fn treated a
     missing dryRun as falsy, i.e. silently APPLIED the change; the
     client always sends it explicitly. Fail 400 instead of defaulting
     to the destructive branch. Divergence, document it.
   Business-rule 400s (not-active, yearly→monthly downgrade, no-op guard,
   seat floor below member count) keep their EXACT edge-fn bodies via
   `reply.code(400).send({ error: ... })` — only schema-validation 400s
   use Fastify's default body (same documented divergence as all waves).
   The 200 response has two shapes (dryRun preview vs apply success) —
   keep both exactly:
   `{ immediateCharge, nextRenewalAmount, billingInterval,
      nextRenewalDate, currency }` and
   `{ success: true, plan, seats, billingInterval }`
   (Type.Union, or one object with optionals — whichever serializes
   cleanly; the client types both via `SubscriptionChangePreview`).
   Flow parity: member-count seat floor uses a count of
   `workspace_members` for the workspace; `subscriptions.retrieve` with
   `expand: items.data.price`; needsPriceChange = plan or interval
   change; apply path = `updateSubscription` (always_invoice) THEN update
   the DB row (plan, seats, billing_interval, updated_at) — the webhook
   remains authoritative and syncs again later, this write only makes
   `refreshSubscription()` reflect the change immediately.

3. StripePort methods to implement in `server/src/adapters/stripe.ts`
   (all currently throw): `getSubscription` (with the expand option),
   `updateSubscription`, `getPrice`, `previewInvoice`. The port
   interfaces already exist and `fakeStripe` already implements them
   (canned `subscriptions`/`prices` Maps, `invoicePreview`,
   `subscriptionUpdates` recorder). **API-version gotcha (why the port
   shapes look the way they do):** the edge fn pinned 2024-11-20.acacia
   and used raw fetch for `POST /v1/invoices/create_preview` (not in
   stripe-node v14); our stripe-node v22 HAS `invoices.createPreview` —
   use the SDK, but note our API version (2026-06-24.dahlia) moved
   `current_period_end` from the subscription object to the ITEM level.
   The route needs it for `nextRenewalDate` — read
   `item.current_period_end ?? sub.current_period_end` and normalize in
   the adapter so the port shape stays stable. Verify against the real
   API in the integration test, not by trusting types. Keep the
   no-apiVersion-pin divergence note. Known documented divergence to
   keep: Stripe SDK 4xx errors pass through Fastify's default error
   handler (edge fn returned the preview error message as a 400 body in
   the dryRun path — check whether the client surfaces it; if not, note
   and don't wrap).

4. Tests: this route HAS DB access AND WRITES → e2e via `app.inject` +
   the real local `supabase start` Postgres (pool from
   `test/helpers/db.ts`, created in `beforeAll`, never in the describe
   body; `describe.runIf(hasTestDb())`), fakes for Stripe. Tokens
   hand-signed via `test/helpers/tokens.ts` with a SEEDED user id
   (membership rows FK auth.users). Seed builders `seedWorkspace`/
   `seedWorkspaceMember`/`seedSubscription`/`deleteWorkspaces` and
   `SEEDED_USER_2_ID` already exist (landed with portal); extend
   `seedSubscription` if you need stripe_subscription_id (currently only
   sets stripe_customer_id — check first). Isolation = unique workspace
   ids + targeted deletes in afterEach (NOT truncation). Matrix to
   cover: 401 no/garbage token; schema 400s (missing workspaceId,
   newPlan≠teams, newSeats<1/float, bad newInterval, missing dryRun)
   proven pre-query via throwing db; 403 non-admin member (creator/
   viewer role) and non-member and deleted workspace — exact body; 404
   no subscription row; 400 status not active/trialing; 400 no-op (same
   plan+seats+interval); 400 seat floor vs member count (exact
   interpolated body); dryRun 200 → preview math from canned fake data
   (amount_due/100, unit_amount*seats/100, ISO nextRenewalDate) AND
   **DB row unchanged** AND no updateSubscription recorded; apply 200 →
   `subscriptionUpdates` recorded with item id/quantity/price +
   always_invoice AND **DB row updated** (plan/seats/billing_interval;
   updated_at advanced) — this is the first resulting-DB-state write
   assertion; price change included when interval changes, omitted when
   only seats change; canonical log fields (`workspace.id`,
   `stripe.plan`, `stripe.interval`, user_id). Extend
   `test/adapters/stripe.integration.test.ts`: a test-mode
   subscription-bearing flow exercising getSubscription/getPrice/
   previewInvoice/updateSubscription round-trip (create throwaway
   customer + price + subscription via the raw SDK — check test-clock or
   `payment_behavior: 'default_incomplete'` so no real payment method is
   needed); verify where current_period_end actually lives in the
   response; keep the `sk_test_` guard — third-party tier, out of the
   blocking CI job.

5. Convert the call site in `webapp/src/billing/StripeService.ts`
   (`subscriptionChange` — the last supabase.functions.invoke in that
   file; drop its `if (!supabase)` guard like portal did) to
   `invokeFunction` and register `'subscription-change'` in
   MIGRATED_FUNCTIONS in `webapp/src/api/client.ts`.

6. Run: root `npx vitest run server webapp/src/api`, server
   `npm run typecheck`, webapp `npx tsc -b`, eslint on changed files.
   Update the plan's Status (done entry + analysis + next: `unsubscribe`
   pending the old-URL decision), then PAUSE for my verification (local
   webapp flag-on: preview + apply a seat change on a teams workspace —
   sandbox Stripe; then against Railway after deploy; webhook overlap is
   fine, it just re-syncs the same values).

Conventions & gotchas: `server/README.md` governs (ports/fakes, no
console.*, response schemas, level policy). Nothing is ever deleted from
Supabase. Root `.env.test` is committed on purpose. CI runs the root
vitest config with `supabase start` backgrounded — don't move server
tests back to the server-local config. Railway DATABASE_URL uses the
direct IPv6 connection — see README before touching db config. Stripe
values in `server/.env.local` are sandbox/test mode. Debug before fixing
— reproduce or add logs before guessing. Use build:extension:dev, never
build:extension. Known pre-existing failures, not yours:
cloudProjectService.test.ts "passes expected version to CloudStorage";
VideoPage.tsx's 3 react-hooks eslint findings; StripeService.ts has 2
pre-existing `no-explicit-any` eslint findings.

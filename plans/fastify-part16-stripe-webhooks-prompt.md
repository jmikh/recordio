# Part 16 prompt — Wave D #17: stripe-webhooks → /stripe-webhooks

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3, Waves A + B +
C and Wave D #15 + #16 — all user-verified. The prod-webapp flag flip
stays deferred to the END. Also read `plans/suggested_changes.md` and
ADD any new findings there.

Your task: **stripe-webhooks** only (server route/path
`/stripe-webhooks` — the name already says "webhooks", no rename).
Do not start Wave E until I explicitly say go. **One new REQUIRED env
var: `STRIPE_WEBHOOK_SECRET`** (config.ts, .env.example, README env
table; set on Railway BEFORE deploy — the value is the NEW Stripe
endpoint's signing secret, see the cutover step). Second raw-body
route — reuse #16's scoped content-type-parser pattern.

**Cutover is OVERLAPPED, not a hard swap (plan step 17 — billing is
not "barely used"):** ADD a second webhook endpoint in the Stripe
dashboard pointing at `${PUBLIC_URL}/stripe-webhooks` (mirror the
existing endpoint's selected event types), verify events arrive and
are handled, THEN disable the Supabase endpoint. During overlap both
endpoints process every event — safe: the writes are identical and
idempotent (`event.created` ordering guard). Each Stripe endpoint has
its OWN signing secret: Railway gets the NEW endpoint's secret; the
edge fn keeps its old one until disabled. Rollback = re-enable the
Supabase endpoint / disable the new one.

1. Read `supabase/functions/stripe-webhooks/index.ts` and
   `supabase/sql/functions/set_project_expiry.sql`. Behaviors
   (parity unless a decision below says otherwise): raw body +
   `stripe-signature` header → SDK `constructEvent` against
   `STRIPE_WEBHOOK_SECRET`. Events:
   - `checkout.session.completed` → userId from `metadata.userId ||
     client_reference_id`, workspaceId from metadata, subscriptionId —
     any missing → THROW (500, Stripe retries). Retrieve the
     subscription from Stripe (authoritative; check whether the
     adapter's plain `getSubscription` embeds `price.metadata` —
     subscription-change's `expandItemPrices` option exists if
     needed); plan from `price.metadata.plan_type` ('pro'|'teams',
     else THROW); billing_interval from `recurring.interval`
     ('year' → 'yearly' else 'monthly'); period end
     `item.current_period_end ?? sub.current_period_end` (unix
     seconds → ISO, invalid → NULL — port `periodEndToIso` verbatim);
     seats = item quantity for teams else NULL;
     `cancel_at_period_end: false` hardcoded. UPSERT on
     `workspace_id` conflict, over the pool.
   - `customer.subscription.created|updated` → row by
     `stripe_customer_id`; missing → THROW (500 — covers the race
     where this event beats checkout.completed; Stripe's retry
     resolves it). **Out-of-order guard:** discard (200, warn log)
     when `event.created` ≤ stored `stripe_event_at`. Update status/
     plan/period-end/cancel_at_period_end/seats + stamp
     `stripe_event_at`; `!periodEnd` → THROW.
   - `customer.subscription.deleted` → status 'canceled', plan 'pro',
     seats NULL, stamp `stripe_event_at`. NOTE the handler does NOT
     check the ordering guard (stale redelivered `deleted` always
     cancels) — parity, log the smell.
   - Unhandled types → 200 `{ received: true }` (same 200 body for
     every success path).
   **DB-function classification: `set_project_expiry` is EXCLUSIVE to
   this webhook** — but see decision 2b: it is NOT ported. All other
   DB work is plain table reads/upserts — inline SQL over the pool.
   Write the analysis paragraph as in previous waves.

2. **User decisions (2026-07-22), both are documented divergences:**
   - **(a) Signature failures → 400, both cases.** Missing header AND
     invalid signature return 400 with a JSON `{ error }` body
     (`error_type: StripeSignatureInvalid` — already in the enum; the
     adapter's verify throw is caught, not propagated). The edge fn
     returned 400 plain-text `No signature` / 500-via-boundary (+ a
     Sentry event per garbage signature). Stripe retries any non-2xx,
     so behavior toward Stripe is identical; bad signatures stay out
     of Sentry.
   - **(b) The webhook NEVER touches projects.** Do NOT port the
     `set_project_expiry` calls (activation-clears / +14d on
     deactivation are all dropped) — subscription changes no longer
     write `projects.expires_at`. Pin it: e2e tests assert projects
     rows are untouched by every handler. Do NOT graveyard the SQL
     function in this wave — the still-live edge fn calls it during
     the overlap window; list it as ORPHANED-after-cutover for the
     Step 5 decommission instead. Consequence for
     suggested_changes.md: `projects.expires_at` becomes fully
     vestigial-except-stamping (only project-create-v2 stamps it, the
     dashboard ProjectCard badge still displays it, nothing clears or
     deletes it — a lapsed-then-renewed subscriber keeps a stale
     countdown badge). Update the existing vestigial-expiry bullet:
     cleanup candidate = drop the stamping + badge + column together,
     user to confirm post-migration.

3. Adapter: implement the REAL `verifyWebhook(rawBody, signature)` in
   `src/adapters/stripe.ts`, replacing the throwing stub —
   `stripe.webhooks.constructEvent` (or the async variant) with the
   secret from a new `webhookSecret` field on the adapter config
   (optional in the type like Mux's; throw 'not configured' when
   absent; wire `config.STRIPE_WEBHOOK_SECRET` in server.ts). Return
   the event as the port's `StripeWebhookEvent`. The SDK enforces a
   **300 s timestamp tolerance by default — keep it** (this closes
   the replay-window smell Mux still has; note the contrast). Extend
   the port's types minimally for the handlers (checkout session
   shape: metadata / client_reference_id / customer / subscription —
   raw snake_case passthrough per convention). Unit-test with REAL
   vectors via `stripe.webhooks.generateTestHeaderString({ payload,
   secret })` (extend `test/adapters/stripe.*` in the BLOCKING tier —
   pure function, no HTTP, not the integration file): valid → event
   returned; tampered body / wrong secret / garbage header → throws;
   stale timestamp beyond tolerance → throws.

4. Route `server/src/routes/stripeWebhooks.ts` — POST
   `/stripe-webhooks`. Scoped
   `addContentTypeParser('application/json', { parseAs: 'string' })`
   inside the plugin (encapsulation — same as #16; the #16 isolation
   test already proves the pattern, add one asserting THIS plugin's
   parser doesn't leak either). No body schema; response schemas:
   200 `{ received: Type.Literal(true) }`, 400 `{ error }`, 500 as
   usual. Flow: missing `stripe-signature` → 400 → verifyWebhook
   (catch → 400 `Invalid signature`) → dispatch per step 1 with the
   step-2 divergences. `updated_at`/now from `deps.clock` (the +14d
   math is gone with decision 2b). Log fields: `stripe.event_type`
   on every request; `workspace.id` where known (extend the deleted
   handler's SELECT to include workspace_id for logging); emit the
   pre-seeded `subscription.changed` catalog event on each
   successful mutating handler. Register in app.ts (no options).

5. Tests — e2e real Postgres + fakeStripe (`FAKE_STRIPE_SIGNATURE`
   drives the fake's verify, which parses the raw body as the event;
   an override-capture test proves the EXACT raw string reaches it)
   in `test/stripeWebhooks.test.ts`: 400 missing header / bad
   signature exact bodies (throwing-db); unhandled event → 200
   `{ received: true }` no queries; checkout.completed → row
   upserted with plan/interval/seats/period-end mapping from a
   canned fake subscription (+ the update-on-conflict path over an
   existing row); checkout missing userId/workspaceId/subscriptionId
   → 500; plan_type metadata missing → 500; subscription.updated →
   row updated + `stripe_event_at` stamped; **out-of-order pin**
   (older `event.created` → 200, row unchanged); unknown customer →
   500; `!periodEnd` → 500; subscription.deleted → canceled/pro/
   seats-NULL (+ the no-ordering-guard parity pin: a stale deleted
   still cancels); **projects-untouched pins for every mutating
   handler** (seed a project with a non-NULL and a NULL expires_at;
   assert both survive verbatim — decision 2b); canonical log fields
   + `subscription.changed` event. Seed helpers exist
   (`seedWorkspace`/`seedSubscription`/`seedProject`); extend
   `seedSubscription` with `stripeEventAt`/`currentPeriodEnd` if
   needed. No client changes (Stripe is the only caller;
   MIGRATED_FUNCTIONS untouched).

6. Run: root `npx vitest run server`, server `npm run typecheck`,
   eslint on changed files. Update the plan's Status (done entry +
   analysis + next: Wave E emails) and suggested_changes.md (the
   vestigial-expiry update from 2b; set_project_expiry orphaned
   after cutover; the deleted-handler ordering gap; anything new).
   Then PAUSE for my verification, in this order: (1) Railway: set
   `STRIPE_WEBHOOK_SECRET` = the NEW endpoint's signing secret —
   create the endpoint first (Stripe dashboard → Developers →
   Webhooks → add endpoint,
   `https://recordio-production.up.railway.app/stripe-webhooks`,
   same event selection as the existing endpoint: at minimum
   checkout.session.completed + customer.subscription.created/
   updated/deleted) — then deploy; (2) overlap-verify: run a
   test-mode checkout + a subscription change from the flag-on local
   webapp, watch BOTH endpoints deliver 200s (Stripe dashboard) and
   the Railway logs show the handlers firing, DB row correct;
   (3) disable the SUPABASE endpoint in the Stripe dashboard;
   (4) one more subscription change to confirm the server endpoint
   alone keeps the row in sync; note that with decision 2b live,
   subscription changes no longer touch project expiry badges.

Conventions & gotchas: `server/README.md` governs. Nothing is ever
deleted from Supabase (set_project_expiry stays deployed; it goes on
the decommission list, not the graveyard). Root `.env.test` is
committed on purpose. CI runs the root vitest config with
`supabase start` + `sql/deploy.sh`. Ajv coercion is ON (moot here —
raw body). The gitignored `server/.env.local`/`.env.prod` are stale
(missing every var since Wave B; `.env.local` already holds a
test-mode STRIPE_WEBHOOK_SECRET — likely the OLD endpoint's, replace
it when the new endpoint exists). No stashing for inspection —
`git show HEAD:path`. Debug before fixing. Use build:extension:dev,
never build:extension. Known pre-existing failures, not yours:
cloudProjectService.test.ts "passes expected version to
CloudStorage"; VideoPage.tsx 3 react-hooks eslint findings;
StripeService.ts 2 `no-explicit-any`; cloudStorage.ts
`project_data: any`; useCloudRender.ts 6 `no-explicit-any`;
Header.tsx 4 findings.

# Part 5 prompt — Wave A #3 (2/3): stripe-portal

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3, Wave A #1
(storage-download-urls), #2 (shared-video-get) — both user-verified against
Railway — and #3.1 (stripe-checkout) — code complete + verified locally
flag-on; check Status for whether its Railway verification happened. The
prod-webapp flag flip stays deferred to the END of the migration — do NOT
push cutover env vars into `webapp/.env`.

Your task: **stripe-portal** only. Do not touch subscription-change until
I explicitly say go after verifying portal.

1. Read `supabase/functions/stripe-portal/index.ts`. It calls exactly ONE
   DB function: `subscription_get` (SECURITY DEFINER,
   `supabase/sql/functions/subscription_get.sql`). Classification is
   already done: **shared** — client RPCs (`webapp/src/auth/AuthManager.ts`,
   `webapp/src/workspace/switchWorkspace.ts`) and the unmigrated
   `transcribe` edge fn also call it, so the SQL function STAYS untouched.
   **Critical gotcha:** you cannot call it via the Db port — its membership
   check is `wm.user_id = auth.uid()`, and over the server's pg pool
   (postgres role, no JWT claims) `auth.uid()` is NULL → it returns NULL
   for everyone. Port the query inline instead: `subscriptions JOIN
   workspace_members` with an explicit `$user_id` param, same membership
   semantics. The route only needs `stripe_customer_id`. Note in the
   analysis: the RPC's `p_workspace_id NULL` fallback (oldest owned
   workspace) is dead weight for this route — the edge fn 400s without
   workspaceId, so the fallback branch never runs here; don't port it.
   Write the short analysis paragraph (dead weight / simplification /
   consistency / smells-not-fixed) as in previous waves.
2. Port as `server/src/routes/stripePortal.ts` following
   `stripeCheckout.ts` as the pattern: TypeBox request AND response
   schemas, `requireUser`, `req.logCtx` fields typed in `src/logging.ts`
   (`workspace.id` exists), response shape identical (`{ url }`). Keep the
   exact 404 body `{ error: 'No subscription found for this workspace' }`
   (parity: non-member and no-subscription both 404 — the RPC returned NULL
   for both). Missing workspaceId → schema 400 (documented divergence:
   Fastify default body).
3. The `StripePort` adapter already exists (`server/src/adapters/stripe.ts`,
   landed with checkout). Implement `createPortalSession` (currently
   throws); `fakeStripe.createPortalSession` already records calls. **No
   new env vars.** Known documented divergence to keep: Stripe SDK 4xx
   errors pass through Fastify's default error handler (edge fn returned
   opaque 500) — same as checkout, note it, don't wrap.
4. Tests: this route HAS DB access → e2e via `app.inject` + the real local
   `supabase start` Postgres (pool from `test/helpers/db.ts` — create it in
   `beforeAll`, never in the describe body; `describe.runIf(hasTestDb())`),
   fakes for Stripe. Auth tokens hand-signed via `test/helpers/tokens.ts`
   (sub must be a seeded user id where FKs apply). Isolation = unique ids +
   targeted deletes in afterEach (NOT truncation — parallel suites share
   the DB); add seed builders for subscriptions/workspace_members to
   `test/helpers/db.ts` if missing. Cover the membership matrix: member
   with subscription → 200 + portal session params recorded; non-member →
   404; member but no subscription row → 404; no/invalid token → 401;
   missing workspaceId → 400; canonical log fields. Assert HTTP response
   AND that the route is read-only on DB state. Extend
   `test/adapters/stripe.integration.test.ts` with a `createPortalSession`
   case (create a throwaway test-mode customer first); keep the `sk_test_`
   prefix guard — third-party tier, stays out of the blocking CI job.
5. Convert the call site in `webapp/src/billing/StripeService.ts`
   (`createPortalSession` only) to `invokeFunction` and register
   `'stripe-portal'` in MIGRATED_FUNCTIONS in `webapp/src/api/client.ts`.
6. Run: root `npx vitest run server webapp/src/api`, server
   `npm run typecheck`, webapp `npx tsc -b`, eslint on changed files.
   Update the plan's Status (done entry + analysis + next), then PAUSE for
   my verification (local webapp + flag on against local server needs a
   subscription-bearing workspace — complete a test checkout first if the
   local DB has none; then against Railway after deploy).

Conventions & gotchas: `server/README.md` governs (ports/fakes, no
console.*, response schemas, level policy). Nothing is ever deleted from
Supabase. Root `.env.test` is committed on purpose (well-known local
values; `!.env.test` gitignore exception). CI runs the root vitest config
with `supabase start` backgrounded — don't move server tests back to the
server-local config. Railway has outbound IPv6 and DATABASE_URL uses
Supabase's direct connection — see README's direct-vs-pooler note before
touching db config. Stripe values in `server/.env.local` are sandbox/test
mode (verified working with checkout). Debug before fixing — reproduce or
add logs before guessing. Use build:extension:dev, never build:extension.
Known pre-existing failures, not yours: cloudProjectService.test.ts
"passes expected version to CloudStorage"; VideoPage.tsx's 3 react-hooks
eslint findings; StripeService.ts has 2 pre-existing `no-explicit-any`
eslint findings.

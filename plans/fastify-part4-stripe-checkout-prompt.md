# Part 4 prompt — Wave A #3: stripe-checkout

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status" section
is the source of truth. Done so far: Steps 0–3, Wave A #1
(storage-download-urls) and Wave A #2 (shared-video-get) — both code
complete AND user-verified flag-on against the deployed Railway server.
The prod-webapp flag flip is deliberately deferred to the END of the
migration (availability decision, recorded in Status) — per-function
verification = local webapp against prod Railway, so do NOT push cutover
env vars into `webapp/.env`.

Your task: Wave A #3, ONE function at a time, starting with
**stripe-checkout**. Do not touch stripe-portal or subscription-change
until I explicitly say go after verifying checkout.

1. Read `supabase/functions/stripe-checkout/index.ts`. First step per the
   plan: list every DB function it calls and classify each as exclusive
   (port its logic to TS in the route) vs shared with client RPCs or
   unmigrated functions (keep calling via the Db port) — grep
   `supabase/sql/functions/` callers and client `supabase.rpc(...)` names.
   Write the short analysis paragraph (dead weight / simplification /
   consistency / smells-not-fixed).
2. Port as `server/src/routes/stripeCheckout.ts` following
   sharedVideoGet/storageDownloadUrls as patterns: TypeBox request AND
   response schemas, `requireUser`, `req.logCtx` fields typed in
   `src/logging.ts`, response shape identical to the edge function.
3. This is the first Stripe consumer → the real `StripePort` adapter lands
   with it (`server/src/adapters/stripe.ts`, stripe SDK to server runtime
   deps, sized to what routes actually use — fakeStripe in `test/fakes/`
   already exists). New env vars (STRIPE_SECRET_KEY etc.) are **required**
   in `config.ts` — I never make new vars optional; I add them to Railway
   immediately. Update README env table + `.env.example`/`.env.local`
   (test-mode key locally).
4. Tests: e2e via `app.inject` + the real local `supabase start` Postgres
   (pool from `test/helpers/db.ts` — create it in `beforeAll`, never in
   the describe body; `describe.runIf(hasTestDb())`), fakes for Stripe.
   Auth tokens hand-signed via `test/helpers/tokens.ts` (sub must be a
   seeded user id where FKs apply). Isolation = unique ids + targeted
   deletes in afterEach (NOT truncation — parallel suites share the DB).
   Assert HTTP response AND resulting DB state. Adapter integration test
   vs Stripe test mode goes in `test/adapters/` auto-skipping without env
   (stays out of the blocking CI job — third-party tier, unlike the
   local-stack supabaseApi one).
5. Convert the call site in `webapp/src/billing/StripeService.ts`
   (stripe-checkout only) to `invokeFunction` and register
   `'stripe-checkout'` in MIGRATED_FUNCTIONS in `webapp/src/api/client.ts`.
6. Run: root `npx vitest run server webapp/src/api`, server
   `npm run typecheck`, webapp `npx tsc -b`, eslint on changed files.
   Update the plan's Status (done entry + analysis + next), then PAUSE for
   my verification (local webapp + flag on against local server, then
   against Railway after I add the Stripe vars and deploy).

Conventions & gotchas: `server/README.md` governs (ports/fakes, no
console.*, response schemas, level policy). Nothing is ever deleted from
Supabase. Root `.env.test` is committed on purpose (well-known local
values; `!.env.test` gitignore exception). CI runs the root vitest config
with `supabase start` backgrounded — don't move server tests back to the
server-local config. Railway has outbound IPv6 enabled and DATABASE_URL
uses Supabase's direct connection (db.<ref>:5432, IPv6-only host) — see
README's direct-vs-pooler note before touching db config. Debug before
fixing — reproduce or add logs
before guessing. Use build:extension:dev, never build:extension. Known
pre-existing failures, not yours: cloudProjectService.test.ts "passes
expected version to CloudStorage"; VideoPage.tsx's 3 react-hooks eslint
findings.

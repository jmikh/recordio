# Part 7 prompt — Wave A #5: unsubscribe

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3 and all of Wave A
#1–#3 (storage-download-urls, shared-video-get, stripe-checkout,
stripe-portal, subscription-change) — check Status for whether
subscription-change's user verification happened before starting. The
prod-webapp flag flip stays deferred to the END of the migration.
Also read `plans/suggested_changes.md` and ADD any new findings there.

Your task: **unsubscribe** only. Do not start Wave A #6
(project-update-thumbnail) until I explicitly say go.

This route breaks several patterns from previous waves — read these
first:

- **It is a GET, public, and returns HTML** — a link target in sent
  emails (`GET /unsubscribe?token=...`), not a client-invoked JSON API.
  Responses are branded HTML confirmation pages (success + three failure
  variants), `Content-Type: text/html; charset=utf-8`.
- **No webapp call site** — do NOT touch `MIGRATED_FUNCTIONS` /
  `invokeFunction`; nothing in webapp/src calls this. The "caller" is the
  URL embedded in emails by `send-welcome-email`
  (`supabase/functions/send-welcome-email/index.ts:117`), which migrates
  in Wave E — that's when this route's real cutover happens. Old emails
  (tokens live 365 days) keep hitting the edge-fn URL, which stays
  deployed per the no-delete rule; the keep-alive/redirect/let-break
  decision is a DECOMMISSION-time decision for the user, not this task.
- **Token verification secret gotcha (investigate before coding):** the
  token is an HS256 JWT signed with `SUPABASE_SERVICE_ROLE_KEY` as the
  HMAC secret (`{ sub: userId, purpose: 'unsubscribe', exp: +365d }`).
  Verification only works if the server uses the SAME string value that
  send-welcome-email signs with. Prod edge functions get the LEGACY
  `eyJ…` service-role JWT auto-injected; Railway's
  `SUPABASE_SERVICE_ROLE_KEY` (added Wave A #2) may hold the NEW
  `sb_secret_…` format — if the values differ, every prod token 400s.
  Ask the user to confirm which value Railway holds vs what the prod
  edge runtime injects BEFORE cutover-relevant decisions; if they
  differ, propose a dedicated env var for the unsubscribe HMAC secret
  (and note in suggested_changes that signing low-privilege tokens with
  the service-role key is a smell regardless).

1. Read `supabase/functions/unsubscribe/index.ts`. **DB-function
   classification: none called** — it's a direct `user_profiles` update
   (`email_subscribed = false, updated_at = now()` by user_id) with the
   service-role client; port = one UPDATE via the Db port. Naturally
   idempotent (second click → same state). Parity behaviors to keep:
   missing token → 400 HTML 'Missing unsubscribe token…'; bad/expired
   signature → 400 HTML 'This unsubscribe link has expired or is
   invalid.'; wrong purpose or missing sub → 400 HTML 'Invalid
   unsubscribe token.'; DB failure → 500 HTML 'Something unexpected
   happened…'; unknown user id → UPDATE matches 0 rows → still the 200
   success page (smell: record in suggested_changes, don't fix). Write
   the analysis paragraph as in previous waves.

2. Port as `server/src/routes/unsubscribe.ts`:
   - `app.get`, NO `requireUser`; per-route rate limit like
     shared-video-get's (this is a public browser target; 60/min/IP is
     fine).
   - Keep `token` OPTIONAL in the querystring schema — a missing token
     must produce the branded HTML 400, not Fastify's default JSON
     validation body (a human in a browser reads this page). Same for
     every error path: HTML, never JSON.
   - Response schema: JSON serialization doesn't apply to HTML — use
     Fastify's per-content-type response schema
     (`response: { 200: { content: { 'text/html': … } } }`) if it
     serializes strings cleanly, otherwise omit the response schema and
     document the exception to the README rule (verify in tests either
     way — assert the exact HTML).
   - Port the `confirmationPage(success, message)` HTML template
     verbatim into the route module (first consumer; don't create a
     shared templates dir for one function).
   - JWT verify via `jose` (already a dependency — see
     `src/plugins/auth.ts`): HS256, secret from config (see the secret
     gotcha above), require `purpose === 'unsubscribe'` and string
     `sub`. Do NOT reuse `requireUser` — different secret, different
     claims, HTML errors.
   - Sentry parity: the edge fn captureException'd unexpected errors
     but still returned the branded 500 page. Fastify's
     default/Sentry error handler would return JSON — so catch
     in-handler, send the HTML 500, and capture explicitly (importing
     `@sentry/node` in a route is acceptable infra precedent —
     `server.ts` does; it's not a business port). Set a `logCtx`
     `error_type` (add an enum value to `ErrorType` in
     `src/logging.ts` if none fits).

3. Tests: HAS DB access → e2e via `app.inject` + real local Postgres
   (`describe.runIf(hasTestDb())`, pool in `beforeAll`); no Stripe/S3
   involvement. Token helper: sign HS256 tokens with the same secret the
   app is built with (tests control both sides — pass the secret via
   AppOptions). Suite needs a user_profiles row it owns: add a
   `seedUser` builder to `test/helpers/db.ts` (auth.users insert — copy
   the minimal column set from `supabase/seed.sql` — plus its
   user_profiles row; targeted delete in afterEach) rather than mutating
   the shared seeded users' flags. Cover: valid token → 200, exact
   success HTML, `email_subscribed` flipped false and `updated_at`
   advanced; **idempotency: same token twice → second run 200, same DB
   state** (run-twice rule from the plan); missing token → 400 exact
   HTML; garbage token → 400 'expired or is invalid'; expired token
   (sign with past exp) → same 400; valid signature wrong purpose → 400
   'Invalid unsubscribe token.'; token signed with the WRONG secret →
   400; unknown user id → 200 success page + no row changed (parity);
   Content-Type text/html on every path; 429 over the per-route limit;
   canonical log fields (user id contribution: the route has no
   req.userId from auth — decide whether to logCtx the token's sub and
   document); DB read-only on failure paths.

4. No client work (see above — no call site). No Railway env vars IF the
   secret question resolves to the existing `SUPABASE_SERVICE_ROLE_KEY`;
   a dedicated secret var otherwise (required in config.ts per the
   no-optional-vars preference, README + .env.example + .env.local/.prod
   placeholders like previous waves).

5. Run: root `npx vitest run server webapp/src/api`, server
   `npm run typecheck`, eslint on changed files (no webapp changes
   expected). Update the plan's Status (done entry + analysis + next:
   project-update-thumbnail) and add new findings to
   `plans/suggested_changes.md`, then PAUSE for my verification (local:
   hand-sign a token for a seeded user — e.g. the tests' helper — open
   `http://localhost:8090/unsubscribe?token=…` in a browser, check the
   page and the flag; Railway: same against prod with a throwaway/test
   user, NOT a real customer).

Conventions & gotchas: `server/README.md` governs (ports/fakes, no
console.*, level policy). Nothing is ever deleted from Supabase. Root
`.env.test` is committed on purpose. CI runs the root vitest config with
`supabase start` backgrounded. Railway DATABASE_URL uses the direct
IPv6 connection — see README before touching db config. Debug before
fixing — reproduce or add logs before guessing. Use build:extension:dev,
never build:extension. Known pre-existing failures, not yours:
cloudProjectService.test.ts "passes expected version to CloudStorage";
VideoPage.tsx's 3 react-hooks eslint findings; StripeService.ts has 2
pre-existing `no-explicit-any` eslint findings.

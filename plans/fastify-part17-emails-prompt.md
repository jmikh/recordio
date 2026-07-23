# Part 17 prompt — Wave E: welcome + invite emails, unsubscribe REMOVED

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3 and Waves
A + B + C + D (all user-verified) — these are the LAST two
edge-function migrations. The prod-webapp flag flip stays deferred to
the END. Also read `plans/suggested_changes.md` and ADD any new
findings there.

Your task: **send-welcome-email** and **send-workspace-invite**
(server routes `/send-welcome-email` and
`/send-workspace-invite-email` — user naming decision 2026-07-23: the
invite route gains "email"), PLUS the user-decided REMOVAL of the
`unsubscribe` edge fn and its DB column. **One new REQUIRED env var:
`RESEND_API_KEY`** (config.ts, .env.example, README env table,
placeholder appended to the gitignored `.env.prod`; set on Railway
BEFORE deploy). The real email adapter (Resend) lands here — the last
`unimplementedPort` dies.

**STALE-PLAN CORRECTIONS (verified 2026-07-23):** the plan's Wave E
text says #18 is an "auth.users trigger" with a "welcome-email-sent
flag" — BOTH wrong. The welcome email is fired by the client-called
`trial_start()` SQL RPC via `net.http_post` (body
`{ record: { id, email } }` — a leftover DB-webhook shape), and
idempotency is trial_start's own `trial_ends_at IS NOT NULL` guard
(a trial starts once → the email fires once). No flag exists; do not
add one.

**User decisions (2026-07-23):**
- **unsubscribe is REMOVED, not migrated**: its whole footprint is
  the `user_profiles.email_subscribed` column, the skip-check in
  send-welcome-email, the 1-year HS256 unsubscribe-JWT mint + footer
  link, and the edge fn itself. Nothing else reads the column (webapp
  never touches it). Accepted consequences: unsubscribe links in
  ALREADY-SENT welcome emails dead-end after undeploy, and future
  welcome emails carry no opt-out link.
- **Inviter-name FIX (documented divergence, pin it):** the edge fn
  selects `user_profiles.display_name`, which DOESN'T EXIST (the
  column is `name`) — the select silently errors and the inviter name
  has always fallen back to the auth email. The server reads `name`,
  falls back to `SupabaseApiPort.getUserById(...).email`, then
  `'Someone'`.
- **Auth for both routes: `requireServiceBearer(
  config.SUPABASE_SERVICE_ROLE_KEY)`** (exists since Step 1; check in
  onRequest so auth precedes schema validation, renderJobWebhook
  pattern). The SQL fns already send `Bearer <Vault
  SUPABASE_SECRET_KEY>` — cutover step verifies the two values match.

1. Read `supabase/functions/send-welcome-email/index.ts`,
   `supabase/functions/send-workspace-invite/index.ts`,
   `_shared/emails/resend.ts` + `layout.ts`,
   `supabase/sql/functions/trial_start.sql` and
   `workspace_invite.sql`. **DB-function classification: trial_start
   and workspace_invite are SHARED client RPCs, auth.uid()-dependent —
   their logic stays SQL; they are edited ONLY to repoint the
   `net.http_post` URL** (step 6). The routes' own reads (workspace
   name, `user_profiles.name`) go inline over the pool; the auth-email
   fallback uses the existing `SupabaseApiPort.getUserById`. Write the
   analysis paragraph as in previous waves.

2. **Unsubscribe removal:** migration (follow
   `supabase/migrations/CLAUDE.md` — real `date -u` timestamp, sorts
   last, IF EXISTS) dropping `user_profiles.email_subscribed`; update
   `sql/tables/user_profiles.sql`; apply locally (`supabase migration
   up`). Delete `supabase/functions/unsubscribe/` from the repo (no
   SQL to graveyard — it has no DB function; the edge fn UNDEPLOY is a
   manual verification step). Overlap note for the plan entry: the
   still-deployed edge send-welcome-email survives the column drop
   gracefully (its `.select('email_subscribed')` error is swallowed by
   the destructure → it just sends), so the window between migration
   and repoint is safe.

3. Adapter `src/adapters/email.ts` (last real adapter): raw fetch to
   `https://api.resend.com/emails`, payload
   `{ from, to: [to], subject, html, reply_to }`, defaults
   `from = 'Recordio Team <john@recordio.io>'`,
   `replyTo = 'john@recordio.io'`. **Result-shaped per the port
   contract — never throws**: non-2xx → `{ success: false, error:
   'Resend API <status>: <body snippet>' }`, transport error →
   `{ success: false, error: message }`. `baseUrl` test override like
   the mux adapter. Wire in server.ts (replaces
   `unimplementedPort('email')`). Divergence: the Deno helper
   degraded to a result-error when `RESEND_API_KEY` was unset; the
   server makes it REQUIRED config (fail the deploy loudly). Adapter
   test vs an ephemeral local HTTP server (blocking tier, mirrors
   `test/adapters/mux.test.ts`): auth header, exact payload shape,
   defaults + explicit from/replyTo, non-2xx → success:false with
   snippet, 200 → success:true.

4. Templates as pure functions (new `src/emails/` — layout.ts,
   welcomeEmail.ts, workspaceInviteEmail.ts): ported VERBATIM except
   the layout loses the `unsubscribeUrl` param entirely (footer link
   gone — decision above; the welcome fn's JWT machinery is not
   ported). Constants stay hardcoded as in the edge fns (`PHOTO_URL`,
   `APP_URL = 'https://app.recordio.io'`) — note them in the analysis.
   No separate template unit tests — the route tests assert on
   `fakeEmail.sent` HTML.

5. Routes:
   - `server/src/routes/sendWelcomeEmail.ts` — POST
     `/send-welcome-email`. Body schema
     `{ record: { id: String(minLength 1), email: Optional(String) } }`
     (parity: missing record → 400, the edge fn's `No record`; schema
     400s use Fastify's default body — same documented divergence as
     every wave; pg_net reads no bodies). Missing/empty email → 200
     `{ skipped: true, reason: 'no email' }` (parity branch even
     though trial_start only posts when email exists). NO
     email_subscribed check (column gone). Send via the port;
     `!result.success` → THROW 500 (pg_net ignores it; Railway logs
     are the surface). 200 `{ sent: true }`.
   - `server/src/routes/sendWorkspaceInviteEmail.ts` — POST
     `/send-workspace-invite-email`. Body schema: workspace_id,
     email, role, token, invited_by (all String minLength 1; replaces
     the edge fn's single `Missing fields` 400 — documented). Flow:
     workspace name over the pool (missing → `'a workspace'`,
     parity) → inviter name: `user_profiles.name` →
     `supabaseApi.getUserById(invited_by)?.email` → `'Someone'` (the
     FIX — getUserById failure degrades, same
     SupabaseApiUnavailable-style catch as sharedVideoGet) →
     `acceptUrl = ${APP_URL}/accept-invite?token=${token}` → send →
     `!success` → THROW. 200 `{ sent: true }`.
   - Both: `requireServiceBearer` in onRequest (401 exact
     `{ error: 'Unauthorized' }` BEFORE validation, pinned); add
     `email.template` ('welcome' | 'workspace-invite') to
     `DomainLogFields` and set it + `workspace.id`/user id fields
     where known. Register both in app.ts (no options).

6. **Cutover — repoint the two SQL fns:** add Vault secret
   `SERVER_URL` (local: `vault.create_secret` in `supabase/seed.sql`
   next to the existing ones, value `http://localhost:8090`; prod: the
   user adds it via Dashboard → Vault). Edit `trial_start.sql` and
   `workspace_invite.sql`: `url := (SELECT decrypted_secret FROM
   vault.decrypted_secrets WHERE name = 'SERVER_URL') ||
   '/send-welcome-email'` (resp. `/send-workspace-invite-email`) —
   bearer header UNCHANGED. Deploy locally (`sql/deploy.sh`). The
   still-deployed edge fns simply stop being called; they die at
   Step 5 decommission (nothing else deleted from Supabase — the
   unsubscribe undeploy is the one user-approved exception).

7. Tests (fakeEmail; invite suite e2e on real Postgres for the
   lookups): welcome — 401 no/wrong bearer with garbage body
   (auth-precedes-validation pin), 400 no record, skipped-no-email
   (nothing sent), success asserts `fakeEmail.sent[0]` (to, exact
   subject `Welcome to Recordio — I'd love your feedback`, html
   contains the greeting + PHOTO_URL, **html does NOT contain
   'unsubscribe'/'Unsubscribe' — the removal pin**, from/replyTo
   left undefined → adapter defaults), Resend failure
   (`nextResult.success false`) → 500, canonical log fields. invite —
   401s; schema 400s per missing field (throwing-db); success pins
   workspace name + **inviter NAME (the fix — seed
   `user_profiles.name`, assert the auth email is NOT used)** + role
   label capitalization + acceptUrl with the token + exact subject;
   fallback chain (no profile name → fake supabaseApi email;
   getUserById failure/null → `'Someone'`); unknown workspace →
   `'a workspace'` (parity); Resend failure → 500; log fields.
   Helper note: seeded users already have user_profiles rows
   (signup trigger) — a `setUserProfileName(db, userId, name)`
   helper that UPDATEs and returns the previous value (restore in
   afterEach) beats an insert helper. No client changes
   (Postgres is the only caller; MIGRATED_FUNCTIONS untouched —
   `trial_start`/`workspace_invite` stay client RPCs).

8. Run: root `npx vitest run server`, server `npm run typecheck`,
   eslint on changed files. Update the plan's Status (done entry +
   analysis + next: **the ENDGAME — prod flag flip, then the Step 5
   decommission checklist**; correct the stale Wave E section text)
   and suggested_changes.md (mark the broken-display_name find as
   FIXED here; note the unsubscribe removal; anything new). Then
   PAUSE for my verification, in this order:
   1. Railway: set `RESEND_API_KEY` (same value as the edge secret),
      deploy (config requires it).
   2. Verify Vault `SUPABASE_SECRET_KEY` equals Railway's
      `SUPABASE_SERVICE_ROLE_KEY` (the routes 401 everything
      otherwise); align if not.
   3. Supabase Dashboard → Vault: add `SERVER_URL` =
      `https://recordio-production.up.railway.app`.
   4. `supabase db push --linked` (drops email_subscribed).
   5. `supabase/sql/deploy.sh --remote` (repoints both SQL fns — the
      cutover moment).
   6. `supabase functions delete unsubscribe` (the one approved
      early edge-fn removal).
   7. Verify end-to-end: fresh account → start trial → welcome email
      arrives WITHOUT an unsubscribe link; invite someone to a
      workspace → invite email arrives showing the inviter's NAME;
      both routes 200 in Railway logs.

Conventions & gotchas: `server/README.md` governs. Nothing else is
deleted from Supabase (the send-* edge fns idle until Step 5). Root
`.env.test` is committed on purpose. CI runs the root vitest config
with `supabase start` + `sql/deploy.sh` (the repointed SQL fns deploy
there; pg_net posts to SERVER_URL fail async + silent locally —
harmless). Ajv coercion is ON (documented caveat). The gitignored
`server/.env.local`/`.env.prod` are stale (missing every var since
Wave B). No stashing for inspection — `git show HEAD:path`. Debug
before fixing. Use build:extension:dev, never build:extension. Known
pre-existing failures, not yours: cloudProjectService.test.ts "passes
expected version to CloudStorage"; VideoPage.tsx 3 react-hooks eslint
findings; StripeService.ts 2 `no-explicit-any`; cloudStorage.ts
`project_data: any`; useCloudRender.ts 6 `no-explicit-any`;
Header.tsx 4 findings.

# Suggested changes (running log)

Improvements, smells, and cleanup candidates discovered during the
Fastify migration (`plans/fastify-part1-edge-functions-migration.md`) but
deliberately NOT done — the migration keeps behavior 1:1 with the edge
functions unless a divergence is explicitly documented in the plan.

**Instructions for agents:** whenever a migration step (or any work in
this repo) surfaces a smell, dead code, security gap, or refactor that is
out of scope for the current task, ADD IT HERE instead of fixing it —
one bullet, with the source file and the date found. Don't remove items
without the user's say-so; mark them `DONE (date)` when addressed.

## Security / correctness smells (kept for edge-fn parity)

- **stripe-checkout**: client-supplied `userEmail` is forwarded to Stripe
  unchecked against the token's email (`server/src/routes/stripeCheckout.ts`).
  Found 2026-07-16.
- **stripe-checkout**: `workspaceId` is never validated against the
  caller's membership — any authed user can start a checkout targeting
  any workspace id (the webhook applies it). Found 2026-07-16.
- **stripe-checkout**: `seats` has no upper bound. Found 2026-07-16.
- **stripe-checkout / stripe-portal**: success/cancel/return URLs are
  client-controlled and forwarded to Stripe unchecked. Found 2026-07-16.
- **storage-download-urls**: hardcoded admin-bypass user id
  (`01f290d7-…`) in the route — should become env config
  (`server/src/routes/storageDownloadUrls.ts`). Found 2026-07-13.
- **shared-video-get**: the completed-video lookup ignores `is_deleted`
  despite the original comment claiming otherwise — a soft-deleted
  completed video can outrank a newer pending one
  (`server/src/routes/sharedVideoGet.ts`). Found 2026-07-16.
- **shared-video-get**: `canceled` mux rows are silently ignored.
  Found 2026-07-16.
- **subscription-change**: the dryRun preview reports the CURRENT billing
  interval while the renewal amount uses the TARGET price — inconsistent
  pair when previewing an interval change
  (`server/src/routes/subscriptionChange.ts`, pinned by test).
  Found 2026-07-16.
- **subscription-change**: apply is not atomic — Stripe update then DB
  update; a crash between leaves the DB stale until the webhook syncs
  (webhook is authoritative, so acceptable). Found 2026-07-16.
- **subscription-change**: the seat floor counts current members but not
  pending invitations. Found 2026-07-16.
- **stripe routes generally**: a malformed (non-UUID) `workspaceId` hits
  the pg uuid cast and 500s — the edge fns also 500'd (via RPC error),
  but a schema `format: 'uuid'` or explicit check would 400 cleanly.
  Found 2026-07-16.
- **stripe-portal**: non-member and no-subscription are indistinguishable
  404s (the RPC returned NULL for both) — fine for information hiding,
  awkward for support debugging. Found 2026-07-16.

- **project-update-thumbnail**: ContentType is hardcoded `image/webp`
  regardless of the actual blob, and the file content is never validated
  as an image (`server/src/routes/projectUpdateThumbnail.ts`).
  Found 2026-07-16.
- **project-update-thumbnail**: S3 put → DB update is not atomic — a
  crash between leaves an orphan S3 object (harmless: deterministic
  path, overwritten next time). Found 2026-07-16.
- **project-update-thumbnail**: an editor's upload lands under the
  CALLER's user-id prefix (`{callerId}/{projectId}/thumbnail.webp`), so
  the projects row repoints and the owner's previous thumbnail object is
  orphaned in S3 (edge-fn parity, pinned by test). Found 2026-07-16.
- **_shared/projectAccess.ts (Deno)**: `getProjectIfEditor` destructures
  only `data`, swallowing DB errors as "no access" → a DB outage looks
  like a 404. The server port throws instead; fix the Deno copy or note
  it dies with Wave B. Found 2026-07-16.
- **asset-create**: the extension (and the size) come solely from the
  client-supplied `fileName`/`sizeBytes` — the actual uploaded content is
  never validated (the presigned PUT has no ContentType/length
  conditions), so any bytes can land under a `.jpg` key
  (`server/src/routes/assetCreate.ts`, edge-fn parity). Found 2026-07-16.
- **asset-create**: the library-limit count and the insert are not
  atomic — two concurrent uploads at 9/10 can both pass the check and
  end at 11/10 (edge-fn parity; a partial unique index or
  count-in-insert CTE would close it). Found 2026-07-16.
- **asset-create**: `pending` rows whose upload is never confirmed are
  never reaped — orphans accumulate (invisible to the limit count, so
  harmless-ish; a cleanup cron or TTL would tidy). Found 2026-07-16.
- **project-create-v2**: no workspace membership check — any authed
  user can create a project into ANY workspace id (the edge fn used the
  service-role client the same way)
  (`server/src/routes/projectCreateV2.ts`, parity). Found 2026-07-17.
- **project-create-v2**: upsert takeover — the upsert keys on the
  client-supplied project id with no ownership check, so an existing
  project row can be overwritten (project_data, name, owner_id all
  repointed to the caller) by anyone who knows/guesses its uuid
  (edge-fn parity, pinned by the upsert test as same-owner behavior).
  A `WHERE projects.owner_id = $caller` guard on the conflict branch
  would close it. Found 2026-07-17.
- **project-create-v2**: `past_due` subscriptions get non-expiring
  projects, same as `active` (edge-fn parity — may be intentional grace
  behavior). Found 2026-07-17.
- **webapp cloudStorage**: the `quota_exceeded` error branches in
  `createProject`/`createProjectV2` are vestigial — no edge fn or
  server route ever returns that error shape. Found 2026-07-17.
- **server-wide**: Fastify's default Ajv has `coerceTypes` on, so a
  numeric STRING in a JSON body (e.g. `sizeBytes: "2048"`) is coerced
  and accepted where the edge fns' `typeof` checks 400'd. Pinned by an
  assetCreate test. Consider `coerceTypes: false` (or leave — clients
  send correct types). Found 2026-07-16.

## Server config / infra cleanups

- Make `SUPABASE_JWT_SECRET` optional in `server/src/config.ts` — prod
  signs ES256 only (legacy HS256 key rotated out ~6 months ago); the
  secret path serves local/test hand-signed tokens. Noted 2026-07-16.
- Migrate the prod webapp's legacy `eyJ…` anon key to the new
  `sb_publishable_…` key, **then** revoke the previous JWT signing key in
  the Supabase dashboard — not before; revoking breaks legacy API keys.
  Noted 2026-07-16.
- `webapp/.env` (gitignored) holds server-side secrets (live Stripe
  secret key, Resend, Mux) that aren't `VITE_`-prefixed and don't belong
  in the webapp env. Noted 2026-07-16.
- `stripe-add-seats` edge function has zero callers anywhere in the repo
  — dead code; decommission rather than port (user to confirm).
  Noted ~2026-07-13.
- `project-create` edge function is dead code (user confirmed
  2026-07-16, not ported): its webapp chain `CloudStorage.createProject`
  ← `CloudProjectService.importRecordingLocal` has zero callers — only
  the V2 pipeline (ImportPage → `importRecordingLocalV2` →
  `project-create-v2`) is used. Decommission the edge fn at the end;
  also delete the dead client methods (and audit the rest of the v1
  pipeline around them, e.g. `uploadMedia`, for reachability).
  Found 2026-07-16.

## Test-infra improvements

- Extract the copy-pasted log-capture block (`lines[]` +
  `logStream: { write(chunk) { …JSON.parse… } }`) into a
  `test/helpers/logCapture.ts` helper — currently duplicated in
  stripeCheckout, sharedVideoGet (×2), stripePortal and
  subscriptionChange tests. Noted 2026-07-16.
- A `buildTestApp(depOverrides?, opts?)` helper for the repeated
  `buildApp(createFakeDeps(…), { supabaseJwtSecret: TEST_JWT_SECRET,
  logLevel: 'silent' })` preamble in every suite. Noted 2026-07-16.

## Server structure conventions (decide before Wave B)

- Where multi-step business logic lives: keep handlers inline until a
  route needs multi-step orchestration or two routes share logic, then
  extract plain functions taking ports into `src/services/` (same shape
  the plan prescribes for Wave C scheduler jobs). Don't create the folder
  speculatively. Noted 2026-07-16.
- `AppOptions` accretes one business-config field per route
  (`stripePriceIds` was the first) — decide between named fields vs a
  grouped `opts.config` object before it gets messy. Noted 2026-07-16.
- Consolidate the `FastifyRequest.userId` declaration (currently in
  `src/app.ts`) with `FastifyRequest.user` (in `src/plugins/auth.ts`) —
  both are set only by the auth plugin. Noted 2026-07-16.

## Stale docs / comments

- `supabase/sql/functions/subscription_workspace_get.sql` header says
  "Called by: WorkspaceSettingsPage billing tab" — stale; its only caller
  was the `subscription-change` edge fn (now migrated → the SQL fn is
  orphaned, listed for Step 5 decommission). Found 2026-07-16.
- `supabase/functions/shared-video-get/index.ts` comment numbering skips
  3 (copy-paste residue) — moot once decommissioned. Found 2026-07-16.

## Known pre-existing failures (not introduced by the migration)

- `cloudProjectService.test.ts` › "passes expected version to
  CloudStorage" — stale expectation; `saveProject` no longer passes the
  4th `true` arg to `saveProjectMetadata`.
- `VideoPage.tsx` — 3 react-hooks eslint findings.
- `StripeService.ts` — 2 `no-explicit-any` eslint findings.

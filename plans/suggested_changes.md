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
- **asset-create**: ~~`pending` rows whose upload is never confirmed
  are never reaped~~ CORRECTED 2026-07-17: they ARE reaped daily by
  the pure-SQL `cron_cleanup_pending_assets` (1 h TTL) — but that
  cron deletes only the ROWS, leaving any uploaded blobs behind
  ("storage lifecycle rules" it cites don't exist). The cron WAS
  decommissioned in part13 (2026-07-18, user decision — the
  pending-asset flow is being redesigned, see the
  asset-uploads-through-server bullet below): pending rows now
  accumulate again (invisible to the limit count, harmless-ish) until
  the redesign lands. Found 2026-07-16.
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
- **render-job-create**: dispatch is fire-and-forget — a worker outage
  leaves the job `pending` with the user polling until the stale-job
  cron fails it; no immediate feedback
  (`server/src/routes/renderJobCreate.ts`, edge-fn parity, failures now
  at least logged). Found 2026-07-17.
- **render-job-create**: a retry by a different editor regenerates
  `render_storage_path` under the RETRYING caller's prefix — renders
  for one project can scatter across user prefixes (same class as the
  thumbnail caller-prefix smell; RPC parity). Found 2026-07-17.
- **render-job-create**: `quality` hardcoded to '1080p'; the edge fn's
  "checks Pro subscription" header comment is stale — no plan check
  exists, any project editor can render (confirm intended).
  Found 2026-07-17.
- **transcribe**: no per-user rate limit or in-flight dedup on an
  expensive AI endpoint — a double-trigger is two Whisper bills, and
  only the global 300/min backstop throttles it
  (`server/src/routes/transcribe.ts`, edge-fn parity). Found 2026-07-17.
- **transcribe**: the whole mic audio is buffered in memory per request
  (a long WAV is large); streaming to the Whisper API would cap the
  footprint. Found 2026-07-17.
- **subscription-status inconsistency**: transcribe gates on
  `active|trialing` while project-create-v2's expiry check treats
  `active|past_due` as entitled — decide one policy (parity kept in
  both ports). Found 2026-07-17.
- **migrations vs sql/ drift**: the baseline schema migration snapshots
  `sql/`-managed function bodies and rots (found: a stale
  `render_job_get_or_create` without the attempt_count bump — a fresh
  `supabase start` ran different SQL than production until CI gained a
  `sql/deploy.sh` step, 2026-07-17). Consider stripping sql/-managed
  functions from future schema dumps, or regenerating the snapshot
  whenever sql/ changes. Found 2026-07-17.
- **shared projectMedia logic ×3**: `getProjectMediaPaths` now exists
  in webapp `shared/utils/`, Deno `_shared/`, and
  `server/src/services/` — the Deno copy dies at decommission; webapp
  vs server stay two (client is typed against Project, server against
  unknown). Consolidate if a shared package ever lands.
  Found 2026-07-17.
- **mux-video-create**: `mux_video_get_or_create` ignores `is_deleted`
  when matching rows — a soft-deleted mux_video at (project_id,
  cloud_version) is returned as a cache-hit/dedup (and the partial
  unique indexes only cover non-deleted rows, so a fresh insert would
  collide anyway). Decide whether deleted rows should be resurrected
  via the retry branch instead (`supabase/sql/functions/
  mux_video_get_or_create.sql`, RPC parity). Found 2026-07-17.
- **mux-video-create**: a crash between the RPC insert and the render
  call leaves a `pending` mux_video forever — only the failure CATCH
  marks rows `failed`, and no cron reaps stale pending mux_videos
  (render_jobs have the stale-job cron; mux_videos have nothing)
  (`server/src/routes/muxVideoCreate.ts`, edge-fn parity).
  Found 2026-07-17.
- **mux-video-create client**: publish is fire-and-forget with no user
  feedback — a failed mux-video-create only lands in Sentry (and
  before the invokeFunction conversion, HTTP errors weren't even
  captured: `.catch` never fires on an invoke that resolves with
  `{ error }`); the share toast says success regardless
  (`webapp/src/editor/components/header/Header.tsx`). Found 2026-07-17.
- **render attribution asymmetry**: mux-video-create attributes
  render_jobs/mux_videos/render paths to the project OWNER while the
  direct render-job-create route uses the CALLER — the same render can
  land under different prefixes depending on which entry point ran
  first (both pinned by tests, edge-fn parity; same family as the
  retrying-caller prefix smell above). Found 2026-07-17.
- **purge-deleted-projects (edge fn, until decommission)**: two bugs the
  part13 server job (`projects.purge-deleted`) FIXES but the still-live
  edge fn keeps: (a) it hard-deletes the project row and the FK cascade
  drops mux_videos WITHOUT deleting their Mux assets — a permanent leak
  (no cleanup trigger exists); (b) its Supabase-Storage `.list()` is
  non-recursive, so `renders/` subfolder files are orphaned on every
  purge. Both moot once the edge fn is decommissioned. Found 2026-07-17.
- **purge-deleted-projects**: stale docs — the edge fn header says
  "3 days" and `cron_purge_deleted_projects.sql` said "3+ days"; the
  code's window is 30 days (the server job ports the code).
  Found 2026-07-18.
- **project purge scope**: the purge deletes only the `${created_by}/`
  prefix — caller-prefixed files (editor-uploaded thumbnails,
  retrying-editor renders; known smells above) orphan in storage
  forever. Found 2026-07-18.
- **mux_video_purge_candidates**: LIMIT 50 with no ORDER BY
  (nondeterministic batch) and no `is_deleted` filter — soft-deleted
  rows are purged via the superseded path only if a completed row
  outranks them; is_deleted-but-not-superseded rows are never purged
  (`supabase/sql/functions/mux_video_purge_candidates.sql`).
  Found 2026-07-17.
- **cron_render_purge was broken**: it posted hourly (pg_net) to a
  `render-purge` edge function that never existed — silent 404s,
  old-version render files never purged. Found 2026-07-17;
  RESOLVED 2026-07-18: cron decommissioned, replaced by the
  `render_jobs.purge-superseded` server job (part13).
- **project-create-v2**: `expires_at` stamping (+14 d for
  non-subscribed workspaces) is now vestigial — auto-expiry was turned
  off 2026-07-18 (`cron_cleanup_expired_projects` decommissioned), so
  nothing acts on the column; the route keeps stamping it (parity port
  untouched). Revisit if expiry ever returns. Found 2026-07-18.
- **Planned redesign — asset uploads through the server** (user
  decision 2026-07-17, post-migration work): replace the
  presign → client-upload → confirm flow with a single upload to the
  Fastify server (assets are small audio/images; per-route `bodyLimit`
  ~20–50 MB; verify Railway passes a ~30 MB body once). Kills the
  pending state machine, the removed reaper cron's job, the
  unvalidated-content smell (server sniffs magic bytes + enforces real
  size), and closes the count+insert race. Project media (large
  recordings) STAYS on the presigned direct path. Noted 2026-07-17.
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

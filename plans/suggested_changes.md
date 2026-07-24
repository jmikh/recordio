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
- **shared-video-get**: ~~the completed-video lookup ignores `is_deleted`
  despite the original comment claiming otherwise — a soft-deleted
  completed video can outrank a newer pending one~~ MOOT 2026-07-22:
  `mux_videos.is_deleted` was removed entirely (re-publish deadlock fix,
  Wave D #16) — multiple completed rows are legal now and the newest
  wins by cloud_version (`server/src/routes/sharedVideoGet.ts`).
  Found 2026-07-16.
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
- **_shared/projectAccess.ts (Deno)**: ~~`getProjectIfEditor`
  swallowed DB errors as "no access"~~ MOOT 2026-07-24 (Step 5): the
  Deno copy died with the edge tree; the server port throws.
  Found 2026-07-16.
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
- **webapp cloudStorage**: ~~the `quota_exceeded` error branches in
  `createProject`/`createProjectV2` are vestigial~~ DONE 2026-07-24
  (Step 5): createProject deleted with the v1 chain; the v2 branch and
  the uncaught `StorageQuotaExceededError` class removed.
  Found 2026-07-17.
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
- **shared projectMedia logic ×2** (was ×3 — the Deno `_shared/` copy
  died at Step 5, 2026-07-24): `getProjectMediaPaths` exists in webapp
  `shared/utils/` and `server/src/services/` (client typed against
  Project, server against unknown). Consolidate if a shared package
  ever lands. Found 2026-07-17.
- **mux-video-create**: ~~`mux_video_get_or_create` ignores `is_deleted`
  when matching rows — a soft-deleted mux_video at (project_id,
  cloud_version) is returned as a cache-hit/dedup~~ MOOT 2026-07-22:
  the `is_deleted` column is gone (Wave D #16); matching any row at
  (project_id, cloud_version) is now the only possible behavior
  (`supabase/sql/functions/mux_video_get_or_create.sql`).
  Found 2026-07-17.
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
- **purge-deleted-projects (edge fn)**: ~~two bugs the part13 server
  job FIXES but the still-live edge fn keeps~~ MOOT 2026-07-24
  (Step 5): the edge fn and its cron are decommissioned; the server
  job `projects.purge-deleted` (which fixed both bugs) is the only
  purge path. Its stale "3 days" docs died with it too.
  Found 2026-07-17.
- **project purge scope**: the purge deletes only the `${created_by}/`
  prefix — caller-prefixed files (editor-uploaded thumbnails,
  retrying-editor renders; known smells above) orphan in storage
  forever. Found 2026-07-18.
- **mux_video_purge_candidates**: ~~LIMIT 50 with no ORDER BY
  (nondeterministic batch) and no `is_deleted` filter~~ PARTLY MOOT
  2026-07-22: the SQL function was DELETED (Wave D #16 — the query went
  inline into `jobs/muxVideosPurgeSuperseded.ts`) and the is_deleted
  concern died with the column. Still true: the inline query keeps
  LIMIT 50 with no ORDER BY (nondeterministic batch) — as does its
  mirror `jobs/renderJobsPurgeSuperseded.ts`. Found 2026-07-17.
- **cron_render_purge was broken**: it posted hourly (pg_net) to a
  `render-purge` edge function that never existed — silent 404s,
  old-version render files never purged. Found 2026-07-17;
  RESOLVED 2026-07-18: cron decommissioned, replaced by the
  `render_jobs.purge-superseded` server job (part13).
- **project-create-v2 / projects.expires_at**: `expires_at` stamping
  (+14 d for non-subscribed workspaces) is now vestigial — auto-expiry
  was turned off 2026-07-18 (`cron_cleanup_expired_projects`
  decommissioned), so nothing deletes on the column; the route keeps
  stamping it (parity port untouched). UPDATED 2026-07-22 (Wave D #17
  decision): the server stripe-webhooks route does NOT port the
  `set_project_expiry` calls either, so once the Supabase endpoint is
  disabled the webhook never clears or rewrites expires_at — the
  dashboard ProjectCard countdown badge still displays it, so a
  paying subscriber's pre-existing badge goes stale (never cleared on
  subscription activation). CORRECTED 2026-07-23: `trial_start()` is
  still a live writer (clears expires_at when a trial starts), so the
  remaining writers are project-create-v2 (stamps) + trial_start
  (clears); nothing deletes. Cleanup candidate: drop the stamping +
  the badge + the column + trial_start's clear together, user to
  confirm post-migration. Found 2026-07-18.
- **Planned redesign — asset uploads through the server** (user
  decision 2026-07-17, post-migration work): replace the
  presign → client-upload → confirm flow with a single upload to the
  Fastify server (assets are small audio/images; per-route `bodyLimit`
  ~20–50 MB; verify Railway passes a ~30 MB body once). Kills the
  pending state machine, the removed reaper cron's job, the
  unvalidated-content smell (server sniffs magic bytes + enforces real
  size), and closes the count+insert race. Project media (large
  recordings) STAYS on the presigned direct path. Noted 2026-07-17.
- **render-job-webhook**: the duration/progress UPDATE and the terminal
  `render_job_complete` RPC are two non-atomic writes — a crash between
  them leaves durations stamped on a still-pending job (the stale-jobs
  watchdog rescues it; edge-fn parity)
  (`server/src/routes/renderJobWebhook.ts`). Found 2026-07-21.
- **render-job-webhook**: heartbeat numbers are unvalidated — negative
  or absurd progress/durations are accepted verbatim (edge-fn parity;
  the worker is the only trusted caller). Found 2026-07-21.
- **render-job-webhook**: the cancel signal rides the NEXT heartbeat
  (~15 s worst-case latency before the worker aborts, by design); and
  two racing first-heartbeats could each compute `start_duration_s`
  (last write wins — harmless). Found 2026-07-21.
- **server-wide**: Fastify's default Ajv has `coerceTypes` on, so a
  numeric STRING in a JSON body (e.g. `sizeBytes: "2048"`) is coerced
  and accepted where the edge fns' `typeof` checks 400'd. Pinned by an
  assetCreate test. Consider `coerceTypes: false` (or leave — clients
  send correct types). Found 2026-07-16.
- **re-publish deadlock**: nothing ever set `mux_videos.is_deleted =
  true`, and the partial unique index
  `idx_mux_videos_one_active_completed` made a second published
  version's `asset.ready` violate the index — the webhook 500'd
  forever and the purge could never break the tie (candidates must sit
  below the highest COMPLETED version; v2 never completed). Found
  2026-07-21; RESOLVED 2026-07-22 (Wave D #16, user decision): the
  soft-delete machinery was removed entirely (migration
  `20260721221112` drops both indexes + the column;
  `mux_video_purge_candidates` deleted, purge job inline; pinned by an
  e2e test — v2 completes alongside v1 and shared-video-get serves v2).
- **mux-video-webhook**: no timestamp tolerance on the `mux-signature`
  check — a captured webhook replays forever (edge-fn parity; Mux's
  docs suggest rejecting stale timestamps)
  (`server/src/adapters/mux.ts`). Found 2026-07-22.
- **mux_video_complete**: matches a row by `mux_asset_id` in ANY
  status — a late/replayed `asset.ready` silently revives a
  canceled/failed row to completed (maybe fine: the asset genuinely
  exists at Mux; note the interaction with the unlimited-replay smell
  above) (`supabase/sql/functions/mux_video_complete.sql`).
  Found 2026-07-22.
- **render_purge_candidates.sql is ORPHANED**: its only intended
  caller was the `render-purge` edge function that never existed
  (part13 replaced that whole path with the inline-SQL server job but
  missed this fn). Decommission candidate: delete the file + graveyard
  DROP — ask the user. Found 2026-07-22.
- **stripe-webhooks**: the `customer.subscription.deleted` handler has
  NO `event.created` ordering guard (updated/created do) — a stale
  redelivered deleted always cancels the row; the next genuine
  subscription event un-cancels it, but there's a wrong-status window
  (`server/src/routes/stripeWebhooks.ts`, edge-fn parity, pinned by
  test). Found 2026-07-22.
- **stripe-webhooks**: a subscription created OUTSIDE the checkout
  flow (e.g. manually in the Stripe dashboard) can never sync —
  `customer.subscription.created` for an unknown customer 500s until
  Stripe stops retrying (~3 days), and no row is ever created
  (edge-fn parity; the throw exists to cover the
  event-beats-checkout race). Found 2026-07-22.
- **stripe-webhooks**: only `items.data[0]` is read everywhere — a
  multi-item subscription's other items are ignored for
  plan/seats/period-end (edge-fn parity; the product never creates
  multi-item subs). Found 2026-07-22.
- **set_project_expiry is ORPHANED after the #17 cutover** (user
  decision 2026-07-22 — the server webhook doesn't touch projects):
  its only caller is the edge stripe-webhooks fn, which dies when the
  Supabase endpoint is disabled. Do NOT graveyard before then (the
  edge fn calls it during the overlap window) — Step 5 decommission
  list (`supabase/sql/functions/set_project_expiry.sql`).
  Found 2026-07-22.
- **send-workspace-invite (edge fn)**: selected the nonexistent
  `user_profiles.display_name` — the silently-swallowed error meant
  the inviter name ALWAYS fell back to the auth email. FIXED in the
  server port 2026-07-23 (Wave E, user decision): reads the real
  `name` column → auth email → 'Someone', pinned by test. (The buggy
  edge copy was deleted at Step 5, 2026-07-24.) Found 2026-07-23.
- **email hooks are fire-and-forget with no retry**: trial_start /
  workspace_invite fire pg_net posts and never check the result — a
  failed welcome/invite email is only a Railway log line (the invite
  UI reports success regardless). Edge parity; a retry queue or at
  least a `job.failed`-style alert would close it. Found 2026-07-23.
- **email templates hardcode APP_URL and PHOTO_URL**
  (`server/src/emails/` — `https://app.recordio.io/...`), ported
  as-is from the edge fns; env-config candidates if a staging app
  host ever exists. Found 2026-07-23.
- **no email opt-out exists anymore** (user decision 2026-07-23 —
  unsubscribe removed with its column): fine while the only emails
  are transactional-ish (welcome, invites); if actual marketing
  emails ever land, a fresh opt-out mechanism is required (legal in
  most jurisdictions). Found 2026-07-23.
- **local Vault vs server env key mismatch**: local Vault
  `SUPABASE_SECRET_KEY` is the legacy demo service-role JWT while
  `server/.env.example` suggests the `sb_secret_` format for
  `SUPABASE_SERVICE_ROLE_KEY` — if they differ locally, the pg_net
  email hooks 401 against a locally-running server (tests are
  unaffected, they inject the bearer). Align the two for local
  end-to-end email testing. Found 2026-07-23.
- **server/README env-var table drift**: the table stops at the S3
  group (+ the `MUX_WEBHOOK_SECRET`/`STRIPE_WEBHOOK_SECRET` rows) —
  `RENDER_WORKER_URL`,
  `RENDER_SECRET`, `OPENAI_API_KEY`, `MUX_TOKEN_ID`,
  `MUX_TOKEN_SECRET`, `PUBLIC_URL` never got rows despite the "add
  each when it lands" note; the gitignored `server/.env.local` /
  `.env.prod` are likewise missing every required var added since
  Wave B (placeholders appended for `MUX_WEBHOOK_SECRET` only).
  Found 2026-07-22.

- **asset_list**: ~~orders by `(row_data->>'created_at') DESC` — TEXT
  comparison of the timestamptz's rendered form~~ DONE for the live path
  2026-07-24: the inline-SQL port in `routes/rpc/assets.ts` orders by the
  column. The smell survives only in the frozen SQL fallback fn until the
  Part 2 end sweep drops it. Found 2026-07-24 (Part 2 Batch 1).

- **project_update_name / project_rename are exact duplicates** (same
  SQL body, both editor-gated name updates) — ported as two identical
  routes for call-site parity; consolidate to one route + one call path
  later (`server/src/routes/projectUpdateName.ts`/`projectRename.ts`).
  Found 2026-07-24 (Part 2 Batch 2).
- **Header.tsx share-state effect reads a field that doesn't exist**: ~~it
  checks `data?.share_slug` but project-get returns `slug` — the branch
  never fires, so shareSlug never auto-populates on editor open (a second
  "Publish" click re-uses the existing slug anyway via the server, so the
  visible effect is only the button state). Probable intent: `data.slug`.
  Ported verbatim.~~ DONE 2026-07-25 (shared-api-contract Step 1): the
  typed contract made the dead read a compile error; fixed to
  `data.slug` — shareSlug now auto-populates, so an already-shared
  project opens with Republish/copy-link enabled (small deliberate
  behavior change). Found 2026-07-24 (Part 2 Batch 2).
- **cloudProjectService read a phantom `cloudProject.user_id`** (same
  bug class as the share_slug read, caught by the same compile pass):
  project_get — the SQL fn AND the route port — never returned a
  top-level `user_id`, so the pre-v5 storagePath backfill
  (`cloudStorage.loadProject` path) has been building
  `undefined/{projectId}/…` paths all along; only projects predating
  storagePath-on-sources were affected. FIXED 2026-07-25 to
  `created_by` (the media-path prefix convention — project-create-v2
  and the purge both key on it). Found 2026-07-25 (shared-api-contract
  Step 1).
- **Railway build context vs `shared/api`**: the server now imports
  `../shared/api/*` (relative, bundled by tsup), but the Railway
  service is configured with root directory `server/` (README). If
  Railway isolates the build context to the root directory, the next
  deploy FAILS at tsup (import not found). Fix if so: widen the root
  dir + explicit build/start commands (`cd server && …`) + watch paths
  (`server/**`, `shared/api/**`), or a render-worker-style Dockerfile.
  Even if the build context is fine, check watch paths: a
  shared/api-only commit must still trigger a server deploy.
  Found 2026-07-25 (shared-api-contract Step 1).
- **project_list orders by the text rendering of updated_at** (same class
  as the asset_list smell) — fixed on the live path (the route orders by
  the column); the smell survives only in the frozen SQL fallback.
  Found 2026-07-24 (Part 2 Batch 2).

- **Stale-bundle reload nudge** (from `plans/shared-api-contract.md`,
  where the deploy-skew policy lives): nothing today tells an open tab
  its bundle is stale (verified 2026-07-25 — `VITE_APP_VERSION` only
  feeds Sentry release tagging; the server version is only in the
  /health body; the editor's lone `window.location.reload()` is the
  sync-conflict flow). Design when picked up: server sends its version
  (already in `AppOptions`) as an `x-server-version` response header on
  every request + `Access-Control-Expose-Headers` for it (webapp is
  cross-origin); `authAwareFetch` remembers the FIRST value seen per
  session and shows a "new version available — reload" toast when it
  CHANGES mid-session. First-seen-vs-now sidesteps comparing server SHA
  to bundle SHA (separate artifacts, separate deploys — direct
  comparison false-positives forever). Shrinks the skew window to near
  zero for every future contract change. Noted 2026-07-25.

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
- ~~`stripe-add-seats` edge function has zero callers anywhere in the
  repo — dead code~~ DONE 2026-07-24 (Step 5): deleted with the edge
  tree; on the user's dashboard-deletion list. Noted ~2026-07-13.
- ~~`project-create` edge function is dead code~~ DONE 2026-07-24
  (Step 5): edge fn deleted with the tree; the dead client chain
  (`createProject` ← `importRecordingLocal`, plus v1 `uploadMedia`)
  deleted after a reachability audit (`uploadBlob` and
  `confirmProjectUpload` kept — live v2/asset users).
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

- `webapp/.env.example` + `vite-env.d.ts` say the local-dev
  `VITE_API_URL` is `http://localhost:8090` — DONE 2026-07-24 (fixed to
  8080 during the Part 2 regular-routes rework). Found 2026-07-24
  (Part 2 Batch 1 smoke test).

## Known pre-existing failures (not introduced by the migration)

- `cloudProjectService.test.ts` › "passes expected version to
  CloudStorage" — stale expectation; `saveProject` no longer passes the
  4th `true` arg to `saveProjectMetadata`.
- `VideoPage.tsx` — 3 react-hooks eslint findings.
- `StripeService.ts` — 2 `no-explicit-any` eslint findings.
- `useAssetLibraryStore.ts` (`removeAsset`) — 1 `no-unused-vars` eslint
  finding (the `_` destructure-to-exclude); verified on HEAD 2026-07-24.

# Part 13 prompt — Wave C: scheduled jobs (projects.purge-deleted, mux_videos.purge-superseded, render_jobs.purge-superseded)

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth, and its "Wave C — Scheduled jobs"
section is the design spec for this part. Done so far: Steps 0–3, all
of Wave A, ALL of Wave B (user-verified). The prod-webapp flag flip
stays deferred to the END. Also read `plans/suggested_changes.md` and
ADD any new findings there.

Your task: **Wave C** — three in-process server jobs plus the minimal
scheduler that runs them, and the decommission of three pg_cron
entries (user decisions 2026-07-18, listed in step 6).

**Job naming (user decision 2026-07-18):** jobs are named
`{table}.{verb}-{qualifier}` — the table exactly as in Postgres
(plural), a CLOSED verb set (`purge` = irreversibly destroy rows +
external resources; `expire` = TTL status flip; `fail-stale` =
heartbeat watchdog; "cleanup" is banned as vague), qualifier = the
candidate condition. Dot mirrors the log-field namespacing
(`mux.asset_id`); `job.name` in logs gets prefix-filterable. The
three jobs: **`projects.purge-deleted`** (daily, ports
purge-deleted-projects), **`mux_videos.purge-superseded`** (hourly,
ports mux-video-purge), **`render_jobs.purge-superseded`** (hourly,
NEW — see step 1). Existing pg_cron names/files are NOT renamed.
**No ledger table, no schema changes (user decision 2026-07-17):**
both jobs are delete-by-condition and fully re-run/double-run safe, so
the scheduler tracks periods IN MEMORY and the log events double as
the metrics/audit surface (one place to look: Railway logs) — do not
add a job_runs table or any DB claim. Do not start Wave D until I
explicitly say go. **No new env vars** (Mux + S3 + Sentry already
configured), no new npm dependencies. The 5 pure-SQL pg_cron jobs stay
in pg_cron untouched.
The 2 migrated crons' pg_cron entries are NOT deleted (user
decommissions manually at the end); until then old cron and server job
overlap — harmless, both are delete-by-condition.

This is the first NON-ROUTE shape: no HTTP surface, no auth, no
`app.inject()`. Jobs are plain functions taking injected deps — tested
exactly like services; the scheduler is tested separately.

**Parity is LOOSENED for this wave (user decision 2026-07-17):**
crons are not on the user path, and the user judged the edge-fn
versions "a bit buggy" — FIX the bugs called out below instead of
porting them. Keep the overall behavior recognizable (same
conditions, same batch limits) and document every deliberate change
in the plan entry, but exact-error-string/check-order parity rules do
NOT apply here.

1. Read `supabase/functions/purge-deleted-projects/index.ts`,
   `supabase/functions/mux-video-purge/index.ts`,
   `supabase/sql/crons/cron_purge_deleted_projects.sql`,
   `cron_mux_video_purge.sql`, and
   `supabase/sql/functions/mux_video_purge_candidates.sql`.
   **DB-function classification: `mux_video_purge_candidates` is
   EXCLUSIVE to this cron, no params, no auth.uid()** → stays SQL over
   the pool (CI already runs `sql/deploy.sh`). Parity notes:
   - purge-deleted-projects: window is **30 days** (the code's
     `thirtyDaysAgo`) — the edge fn header comment says "3 days" and
     the cron SQL comment says "3+ days"; both are stale (log in
     suggested_changes, port the CODE). Batch LIMIT 20.
     **BUG TO FIX (user-directed): the edge fn hard-deletes the
     project row, and the FK cascade silently deletes its mux_videos
     rows WITHOUT deleting their Mux assets — dangling assets leak at
     Mux forever (verified: `supabase/sql/triggers/` has no cleanup
     trigger).** New per-project pipeline, order load-bearing:
     mark `permanently_deleted` (skip if already true — resume of a
     previous failed run) → **purge ALL of the project's mux_videos
     rows first via the shared `purgeMuxVideo` helper (step 3b) —
     any status including pending (a 30-day-deleted project has no
     legitimate in-flight work)** → delete storage under
     `${created_by}/${project.id}` (recursive — this also covers the
     render files render_jobs rows point at, so their cascade is
     fine) → hard-DELETE the row ONLY after all of the above
     succeeded (pin with tests: a Mux-delete failure OR a storage
     failure leaves the row, marked, for the next run). Per-project
     catch: one bad row must not kill the batch.
   - mux_videos.purge-superseded: `SELECT * FROM
     mux_video_purge_candidates()` (rows older than the highest
     completed version per project, non-pending, LIMIT 50) → per row:
     the same shared `purgeMuxVideo` helper. Per-row catch, row left
     for next run.
   - **render_jobs.purge-superseded — NEW JOB (found 2026-07-17):
     `cron_render_purge` posts hourly to a `render-purge` edge
     function that DOES NOT EXIST** (no `supabase/functions/
     render-purge/` folder — silent pg_net 404s; old-version render
     files were never purged). Implement what the cron's comment
     intended, mirroring the mux candidates shape: render_jobs below
     the highest COMPLETED version per project, non-pending, LIMIT
     50 — as a plain SQL query over the pool (no RPC: this logic is
     server-exclusive from birth, no sql/functions file). Per row:
     delete `render_storage_path` from storage (skip if NULL) →
     DELETE the row ONLY after the file is confirmed gone. By
     construction the latest completed render survives — its file
     backs the user's mp4 download (useCloudRender presigns it), so
     do NOT widen the candidate set. Note and document: a superseded
     mux_videos row may still reference a superseded render file —
     fine, Mux ingested it long ago and the reference is only used
     for purging.
   - Write the analysis paragraph as in previous waves.

2. **S3Port additions** (first bulk operations):
   `listObjects(prefix): Promise<string[]>` (full keys) and
   `deleteObjects(keys): Promise<void>` (no-op on empty array).
   Adapter: ListObjectsV2 with a ContinuationToken pagination loop +
   DeleteObjects batch (1000-key API cap — chunk if ever needed).
   **Deliberate divergence, document AND pin with a test:** the Deno
   `.storage.list(prefix)` was NON-recursive — files under the
   `renders/` subfolder were silently orphaned on every purge. S3
   prefix listing is recursive, so the port version deletes the whole
   prefix including `renders/v*.mp4` (this FIXES the orphan bug; the
   edge fn keeps leaking until decommission — log it in
   suggested_changes). Extend fakeS3 (objects Map already exists —
   list = key-prefix filter, delete = Map deletes, plus recorded
   `deletedKeys`). One narrow case in the existing
   `s3.integration.test.ts` optional tier.

3. **Jobs** as plain functions in `src/jobs/` (new folder — the
   services/ rule says don't create folders speculatively; this one is
   earned: three jobs now, scheduler consumes them). File names
   mirror job names:
   - `src/jobs/projectsPurgeDeleted.ts` —
     `projectsPurgeDeleted(deps, log)` → `{ processed, succeeded,
     failed }`. The 30-day cutoff comes from `deps.clock.now()`, NEVER
     `Date.now()` (fakeClock drives the tests).
   - `src/jobs/muxVideosPurgeSuperseded.ts` —
     `muxVideosPurgeSuperseded(deps, log)` → `{ purged, total }`.
   - `src/jobs/renderJobsPurgeSuperseded.ts` —
     `renderJobsPurgeSuperseded(deps, log)` → `{ purged, total }`.
   - **3b. Shared helper `src/services/muxPurge.ts`** (user rule:
     anything called from multiple places becomes a function) —
     `purgeMuxVideo(deps, { id, muxAssetId, renderStoragePath })`:
     if muxAssetId → `MuxPort.deleteAsset` (404-as-success is
     already the port contract and adapter behavior); if
     renderStoragePath → delete from storage; DELETE the mux_videos
     row ONLY after both externals are confirmed gone (pin). Both
     jobs call this; it throws on failure and the caller's per-item
     catch decides (skip row / skip project).
   - Per-item failures: `log.warn({ err, ... })` + continue (parity:
     the edge fns captureException'd per item and moved on; the
     scheduler's onJobError hook — below — is for whole-job failures).
     Whole-job summary is logged by the scheduler, not the job.

4. **Scheduler** `src/scheduler.ts` — deliberately minimal, per the
   plan spec: `startScheduler(deps, jobs, { log, onJobError })` →
   returns `{ stop() }`. One tick on start + `setInterval` hourly.
   Each tick, for each job: compute the current period from
   `deps.clock.now()` — `daily` → UTC date, `hourly` → UTC hour — and
   run the job unless an **in-memory last-run-period map** says it
   already ran this period. NO DB claim, NO ledger: a deploy resets
   the map and the startup tick simply re-runs the jobs — that is
   accepted and harmless by design (delete-by-condition; the second
   run finds nothing), and the `job.trigger` log field makes those
   runs identifiable. A tick must never throw: catch everything,
   `log.error` + `onJobError(err)`. Job registry entries:
   `{ name: 'projects.purge-deleted', period: 'daily', run }`,
   `{ name: 'mux_videos.purge-superseded', period: 'hourly', run }`,
   `{ name: 'render_jobs.purge-superseded', period: 'hourly', run }`
   (the naming scheme from the header; the plan entry records the
   edge-fn → job-name mapping for grep-ability).
   **Logging IS the metrics/audit surface** (user decision — one
   place to look, Railway logs). Two `logEvent` catalog entries,
   emitted by the scheduler (direct logging is correct here — this is
   the non-request work the logging header reserves it for):
   - `'job.completed'`: `job.name`, `job.trigger`
     (`'startup' | 'interval'`), `duration_ms`,
     `job.items_processed`, `job.items_failed`, `job.batch_full`
     (processed == the job's batch LIMIT → backlog signal; jobs
     return their counts, the scheduler normalizes into these
     fields).
   - `'job.failed'` (whole-job throw): `job.name`, `job.trigger`,
     `duration_ms` — alerting keys off the event name, no parsing.
   Per-item failures stay `log.warn` inside the jobs (step 3) —
   canonical events carry aggregates only, same rule as routes.
   **Timing divergences (document):** daily ran at 03:00 UTC → now
   the first tick after UTC midnight (or after deploy); hourly ran at
   :15 → now on the process's tick cadence (anchored at startup).
   Both harmless for 30-day/next-version purges. **Known accepted
   limitation (document in the plan entry, not a smell to fix): a
   dead scheduler emits nothing — liveness is "do I see
   job.completed lines in Railway".**
   **Wiring: server.ts, NOT app.ts** — `buildApp` stays a pure
   factory with no side effects; server.ts starts the scheduler after
   `listen` with `onJobError: Sentry.captureException` and stops it
   on shutdown if a hook exists. Tests never start the scheduler
   implicitly.

5. Tests — jobs e2e against real Postgres + fakes, called directly;
   scheduler tests need NO db at all (fakeClock + stub jobs):
   - **Cross-suite hazard, handle it explicitly:** all three jobs
     read GLOBALLY (no per-project scope) and the root vitest run
     executes suites in parallel against the shared DB.
     projectsPurgeDeleted only matches `deleted_at < now() - 30d` —
     other suites seed `deletedAt: new Date().toISOString()`
     (recent), so they're safe; keep it that way (your seeds use
     >30d-old timestamps, assert only on your own rows). The two
     purge-superseded jobs are riskier: a candidate is any row below
     a project's highest COMPLETED version — before writing the
     suites, check whether any parallel suite seeds a project with a
     completed mux_video/render_job plus lower-version rows
     (sharedVideoGet and renderJobCreate are the ones to check); if
     one does, your job run would DELETE their rows mid-test — fix by
     adjusting your assertions to own-rows-only AND confirming the
     other suite's seeds can't form a purgeable shape (adjust their
     seed versions if needed, with a comment).
   - projectsPurgeDeleted: purges a >30d soft-deleted project
     (permanently_deleted marked, ALL storage keys under the prefix
     deleted — seed fakeS3 with a top-level file AND a
     `renders/v1.mp4` subkey to pin the recursive-delete fix, row
     hard-deleted with cascades); **mux-leak fix pin: seed the
     project with mux_videos rows (incl. one pending and one with a
     mux_asset_id) → fakeMux.deletedAssetIds contains the asset and
     the rows are purged BEFORE the project row goes; a deleteAsset
     failure → project row kept + marked (no cascade happened, no
     dangling Mux asset), counted failed, retried next run**; skips
     <30d and non-deleted rows; resumes a previously-marked row;
     storage failure (deleteObjects override throws) → row kept +
     marked, counted failed, batch continues to the next project;
     respects LIMIT 20.
   - muxVideosPurgeSuperseded: seed completed v3 + older
     completed/failed v1/v2 → old rows purged (fakeMux.deletedAssetIds,
     fakeS3 deleted render paths, rows gone), v3 kept; pending rows
     never purged; rows with NULL mux_asset_id / NULL
     render_storage_path skip that step and still delete; deleteAsset
     failure → row kept for next run, batch continues.
   - renderJobsPurgeSuperseded: seed completed v3 + older
     completed/failed v1/v2 render_jobs (with render_storage_path
     files in fakeS3) → old rows purged, files deleted, v3 row AND
     its file kept (the mp4-download pin); pending rows never purged;
     NULL render_storage_path rows still delete; storage failure →
     row kept for next run, batch continues.
   - scheduler (fakeClock + stub jobs, no db): startup tick runs
     every job once; two ticks in the same period → one run;
     advancing fakeClock past a period boundary → runs again; daily
     vs hourly period computation; a fresh scheduler instance re-runs
     the current period (the accepted deploy behavior — the test
     documents it, don't "fix" it); `job.completed` carries the
     normalized count fields and `job.trigger` distinguishes
     startup vs interval (capture with the logStream pattern); a
     throwing job → tick survives, other jobs still run, `job.failed`
     emitted, onJobError called; `stop()` clears the interval.
   - No client changes at all (crons have no webapp callers; nothing
     for MIGRATED_FUNCTIONS).

6. **Decommission THREE pg_cron entries** (follow the
   supabase/CLAUDE.md removal process for each: delete the
   `sql/crons/` source file, add the `cron.unschedule` — plus any
   `DROP FUNCTION` — to `sql/graveyard.sql`, run `sql/deploy.sh`
   locally; the user runs `--remote` manually):
   - `cron_cleanup_pending_assets.sql` (jobname
     `assets-stale-cleanup`; user decision 2026-07-17 — asset uploads
     are being redesigned to go through the server, and the cron had
     its own bug: it deleted pending user_assets rows while leaving
     any uploaded blobs behind, citing "storage lifecycle rules" that
     don't exist). Also CORRECT the stale suggested_changes bullet
     claiming pending rows are "never reaped" — they were reaped
     daily (1 h TTL); after this removal they truly accumulate until
     the flow is redesigned (note that consciously).
   - `cron_cleanup_expired_projects.sql` (jobname
     `projects-delete-expired` + `DROP FUNCTION
     public.cleanup_expired_projects()`; user decision 2026-07-18 —
     no auto-expiring projects for now). Loose end to log in
     suggested_changes: project-create-v2 still stamps `expires_at`
     (+14 d for non-subscribed workspaces) — vestigial data nothing
     acts on anymore; do NOT change the route (parity port stays).
   - `cron_render_purge.sql` (jobname `render-jobs-purge`; broken —
     it targeted a nonexistent edge fn, see step 1 — and its intent
     is now the `render_jobs.purge-superseded` server job).

7. Run: root `npx vitest run server`, server `npm run typecheck`,
   eslint on changed files. Update the plan's Status (done entry +
   analysis + next: Wave D webhooks) and add findings to
   `plans/suggested_changes.md` — candidates spotted at prompt time:
   the 3-days-vs-30-days stale comments; the Deno non-recursive
   storage list orphaning `renders/` files on every purge (edge fn
   keeps leaking until decommission); purge only clears the
   `created_by` prefix, so caller-prefixed files (editor-uploaded
   thumbnails, retrying-editor renders — known smells) orphan
   forever; the EDGE purge fn keeps leaking Mux assets via the
   project-delete cascade until decommission (verified — no cleanup
   trigger exists; the server job fixes it, see step 1);
   `mux_video_purge_candidates` has LIMIT 50 with no ORDER BY
   (nondeterministic batch) and ignores `is_deleted`; the
   cron_render_purge finding (record as found 2026-07-17, RESOLVED by
   this part); the vestigial `expires_at` stamping (step 6); the
   planned asset-upload-through-server redesign (user decision
   2026-07-17, post-migration: single upload to Fastify with a
   per-route `bodyLimit` ~20–50 MB replaces presign+confirm — kills
   the pending state machine and the content-validation smells;
   project media stays presigned; verify Railway passes a ~30 MB body
   once). Then PAUSE for my verification (local: start the server,
   watch the startup-tick `job.completed` events with their counts;
   seed a purgeable mux_video locally and see it purged; then Railway
   deploy — no new env vars — verify `job.completed` lines in Railway
   logs; the two remaining watchdog pg_cron entries keep running,
   untouched).

Conventions & gotchas: `server/README.md` governs. The edge-function
side of Supabase is never touched; this part DOES remove three
pg_cron entries (explicit user decisions, step 6) — locally only;
the user applies `--remote`. No schema changes in this part. Root
`.env.test` is committed on purpose. CI runs the root vitest config
with `supabase start` + `sql/deploy.sh`. No stashing for inspection — `git show HEAD:path`.
Debug before fixing. Use build:extension:dev, never build:extension.
Known pre-existing failures, not yours: cloudProjectService.test.ts
"passes expected version to CloudStorage"; VideoPage.tsx 3 react-hooks
eslint findings; StripeService.ts 2 `no-explicit-any`; cloudStorage.ts
`project_data: any`; useCloudRender.ts 6 `no-explicit-any`; Header.tsx
4 findings.

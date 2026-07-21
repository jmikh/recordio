# Part 14 prompt — Wave D #15: render-job-hook

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3, Waves A + B
(user-verified) and Wave C (scheduler + 3 jobs). The prod-webapp flag
flip stays deferred to the END. Also read
`plans/suggested_changes.md` and ADD any new findings there.

Your task: **render-job-hook** only — the first Wave D webhook and
the first NON-JWT route: the render worker authenticates with the
shared `RENDER_SECRET` bearer (exact match, same env var the server
already requires for dispatch). Do not start mux-video-hook or
stripe-webhooks until I explicitly say go. Full parity rules apply
again (this IS on the render path users watch).

**One new REQUIRED env var: `PUBLIC_URL`** (config.ts, .env.example —
local `http://localhost:8090`, Railway
`https://recordio-production.up.railway.app`; set on Railway BEFORE
deploy). It exists so the server can hand out its OWN hook URL —
see the cutover step.

1. Read `supabase/functions/render-job-hook/index.ts`,
   `supabase/sql/functions/render_job_complete.sql`, and the worker
   side: `render-worker/src/server.ts` (`updateJob` — confirm the
   auth header it sends; heartbeats ~15 s with `progress`, honors
   `cancel: true` in the response to abort, reports terminal
   `completed`/`failed`).
   **DB-function classification: `render_job_complete` is SHARED**
   (called by the edge hook AND the pure-SQL stale-jobs watchdog
   cron) but takes explicit params, no auth.uid() → the SQL function
   stays UNTOUCHED and the route calls it over the pool (same as
   render_job_get_or_create). Its behavior matters: pending-only
   guard, and on failed/canceled it cascades to pending mux_videos
   for the same (project_id, cloud_version) — the completed→Mux
   upload is the HOOK's job, not the RPC's.

2. Route `server/src/routes/renderJobWebhook.ts` — POST
   `/render-job-webhook` (**naming: the SERVER route/path says
   "webhook", user decision 2026-07-21 — the URL is ours to choose;
   only the edge fn keeps the "hook" name**). NO requireUser: its own preHandler-style check,
   `Authorization === 'Bearer ' + renderSecret` (plain compare,
   edge-fn parity; the secret is high-entropy) → else 401
   `Unauthorized` exact body. Route option `renderSecret` (wired from
   config in app.ts — same injection style as statusCallbackUrl).
   Body: `jobId` (minLength 1) + all-optional `status`
   (Type.String()), `progress`, `error`, `download_duration_s`,
   `render_duration_s`, `upload_duration_s` (Type.Number() —
   documented Ajv-coercion caveat, same as elsewhere; the worker
   sends real numbers). Responses: 200
   `{ ok: Type.Literal(true), cancel: Type.Boolean() }`; 400/500
   additionalProperties:true; 404 exact `Job not found`.
   Flow (exact parity):
   - read job (`status, created_at, start_duration_s, project_id,
     cloud_version, render_storage_path`) → missing → 404.
   - job not pending → `{ ok: true, cancel: true }` (this is the
     cancel signal the worker polls — NO updates, NO RPC).
   - build updates from `deps.clock.now()` (NOT new Date()):
     progress/durations if present; `start_duration_s` computed on
     FIRST update (now − created_at); on `status === 'completed'`
     also `total_duration_s` + `progress = 1`. One UPDATE.
   - terminal (`completed` | `failed`): call
     `render_job_complete($jobId, $status, $error ?? null)` over the
     pool. On `failed`: the edge fn captureException'd the
     worker-reported error — port as `req.log.error` with the message
     + `render.job_id` (Sentry picks up route errors via the existing
     handler only on throws — this must NOT throw; the hook itself
     succeeded. Decide and document whether to also call
     Sentry.captureException via a route option or leave it as an
     error log — prefer the error log, one place to look).
   - on `completed` + render_storage_path: look up a PENDING
     mux_video for (project_id, cloud_version) → if found,
     `uploadToMux(deps, ...)` from `services/muxUpload.ts` (built
     shared for exactly this in part12). A failed upload is logged
     but still returns 200 `{ ok: true, cancel: false }` — uploadToMux
     already marked the row failed (pin with a test).
   - emit the existing `logEvent` catalog entry
     `'render_job.completed'` on completed (it was pre-seeded in the
     catalog for this route); logCtx fields: `render.job_id`,
     `project.id`, `mux.asset_id`/`mux.video_status` when the upload
     runs.

3. **Cutover (server-side only, no client change):** in app.ts,
   `statusCallbackUrl` becomes `${PUBLIC_URL}/render-job-webhook`
   (passed via a new opts field from server.ts) — replacing the
   `${supabaseUrl}/functions/v1/render-job-hook` construction. This
   completes the note left open in renderJobCreate's header. Update
   that header comment. Overlap is automatic and safe: the URL is
   per-job payload — in-flight jobs dispatched earlier keep calling
   the still-live EDGE hook; prod renders (edge render-job-create,
   flag off) also keep using it until the flag flip. Both hooks stay
   live until decommission. Existing renderJobCreate/muxVideoCreate
   tests assert the OLD callback URL — update those assertions to the
   new construction (that's the one intended test change; everything
   else must pass unchanged).

4. Tests — e2e real Postgres + fakes (`test/renderJobWebhook.test.ts`):
   401 missing/wrong secret (exact body, no DB read — throwing-db
   app); schema 400 missing jobId; 404 unknown job; heartbeat:
   progress + durations persisted, `start_duration_s` set once
   (second heartbeat doesn't overwrite it — pin); non-pending job
   (completed/failed/canceled seeds) → `{ ok, cancel: true }` and row
   untouched; completed WITHOUT pending mux → job completed,
   total_duration_s + progress 1, no mux/S3 calls; completed WITH
   pending mux_video → RPC completes job, presigned render URL →
   fakeMux asset created, mux row gains mux_asset_id +
   render_storage_path with status still pending; completed with mux
   upload FAILURE (override createAsset throw) → STILL 200, mux row
   failed with mapped error, job still completed; failed → job
   failed with error AND pending mux_video cascaded to failed with
   the worker's error string (RPC behavior — pin); failed with no
   error message → cascade uses `Render failed` default; canonical
   log fields + `render_job.completed` event assert. Optional: one
   ephemeral-HTTP test is NOT needed (no new adapter).

5. Run: root `npx vitest run server`, server `npm run typecheck`,
   eslint on changed files. Update the plan's Status (done entry +
   analysis + next: #16 mux-video-hook) and add findings to
   `plans/suggested_changes.md` — candidates spotted at prompt time:
   the duration UPDATE and the terminal RPC are two non-atomic writes
   (a crash between leaves durations without terminal state — cron
   rescues); heartbeat numbers are unvalidated (negative/absurd
   durations accepted, edge parity); the cancel signal rides the
   NEXT heartbeat (~15 s latency, by design); `start_duration_s`
   NULL-check means a heartbeat race could compute it twice (last
   write wins, harmless). Then PAUSE for my verification (local:
   flag-on cloud render end-to-end with the local worker — watch the
   hook heartbeats, completion, and Mux upload in server logs; then
   Railway: set PUBLIC_URL, deploy, run a real cloud render from the
   local webapp pointed at Railway).

Conventions & gotchas: `server/README.md` governs. Nothing is ever
deleted from Supabase. Root `.env.test` is committed on purpose. CI
runs the root vitest config with `supabase start` + `sql/deploy.sh`
(render_job_complete deploys there). Ajv coercion is ON. No stashing
for inspection — `git show HEAD:path`. Debug before fixing. Use
build:extension:dev, never build:extension. Known pre-existing
failures, not yours: cloudProjectService.test.ts "passes expected
version to CloudStorage"; VideoPage.tsx 3 react-hooks eslint
findings; StripeService.ts 2 `no-explicit-any`; cloudStorage.ts
`project_data: any`; useCloudRender.ts 6 `no-explicit-any`;
Header.tsx 4 findings.

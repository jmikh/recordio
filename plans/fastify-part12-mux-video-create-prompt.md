# Part 12 prompt — Wave B #9: mux-video-create

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3, all of Wave A,
and Wave B #7/#12/#10/#8 — all user-verified. The prod-webapp flag flip
stays deferred to the END. Also read `plans/suggested_changes.md` and
ADD any new findings there.

Your task: **mux-video-create** only — the LAST plain Wave B route.
Do not start Wave C until I explicitly say go.

Flow: `{ projectId, cloudVersion }` → editor check → share-link check →
`mux_video_get_or_create` RPC → if new/retried: get-or-create the
render job — **in-process now, not HTTP** — and if the render is
already complete, upload it to Mux. First MuxPort adapter. **Two new
REQUIRED env vars: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`** (config.ts,
.env.example; Railway needs them before deploy — same values as the
edge-function secrets). No new npm dependencies (Mux is 2 REST calls —
raw fetch, like the Whisper adapter).

**Architectural payoff (user-approved when #10 was ported):** the edge
fn calls render-job-create over HTTP with the service-role key —
that's why the edge render-job-create has a service-role auth path.
In-process, that becomes a plain function call: extract the
render-job-create core (project read → `render_job_get_or_create` RPC
→ presigns → fire-and-forget worker dispatch — everything AFTER the
route's editor check) into `src/services/renderJobs.ts` as
`getOrCreateRenderJob(deps, { projectId, userId, statusCallbackUrl })`
returning `{ jobId, status, renderStoragePath }`. The
`renderJobCreate` route keeps its schema/auth/editor-check and
delegates to it (its tests must still pass unchanged — that's the
refactor guard); mux-video-create calls it directly. The server never
implements the service-role auth path — it dies with the edge fn at
decommission.

**Attribution subtlety (parity, pin with a test):** mux-video-create
passes the project OWNER's id — not the caller's — to BOTH RPCs (the
edge fn resolved `owner_id` via getProjectIfEditor and the edge
render-job-create service-role path re-derived it). So when an
explicit editor triggers it, `mux_videos.user_id` AND
`render_jobs.user_id`/render path are the OWNER's — unlike the direct
/render-job-create route where the caller's id is used.

1. Read `supabase/functions/mux-video-create/index.ts` and
   `supabase/functions/_shared/muxUpload.ts`.
   **DB-function classification: `mux_video_get_or_create` is
   EXCLUSIVE to this edge fn, takes explicit `p_user_id`, no
   auth.uid()** → stays SQL over the pool (same as
   render_job_get_or_create; CI already runs `sql/deploy.sh`).
   Behaviors: check order = editor access (404 `Project not found or
   access denied`) → `slug` present (400 `Project not shared. Create a
   share link first.`) → RPC. Existing row (`is_new` false) → return
   `{ status, muxVideoId }` as-is (completed or pending). New/retried →
   in-process render get-or-create; on ANY failure there, mark the
   mux_video `failed` with error `Render dispatch failed` before
   rethrowing (pin: the row must not sit pending forever). If the
   render is already `completed` with a path → muxUpload; on its
   failure the row is marked failed with the mapped error string and
   the route 500s. Both success paths return
   `{ status: 'pending', muxVideoId }` — the Mux webhook (Wave D)
   completes it. Write the analysis paragraph as in previous waves.

2. `src/services/projectAccess.ts`: extend `getProjectIfEditor`'s
   SELECT with `slug` (the Deno version took a columns param; the
   thumbnail route ignores the extra field).

3. Port `_shared/muxUpload.ts` as `src/services/muxUpload.ts` (it's
   shared on purpose — render-job-hook reuses it in Wave D):
   `uploadToMux(deps, { muxVideoId, renderStoragePath })` →
   `S3Port.presignDownload(path, 3600)` (divergence, document: the
   edge fn used a Supabase-Storage signed URL — same object, different
   URL flavor; Mux just fetches it) → `MuxPort.createAsset(url)` →
   UPDATE mux_videos SET mux_asset_id, render_storage_path,
   updated_at (status STAYS pending). Keep the failure contract: catch
   each step, mark the row `failed` with the edge fn's error strings
   (`Failed to generate signed URL`, `Mux API request failed`,
   `Mux API error: <status>`), return `{ success, muxAssetId?, error }`.

4. Adapter `src/adapters/mux.ts` (first MuxPort adapter): raw fetch.
   `createAsset` = POST `https://api.mux.com/video/v1/assets`, basic
   auth `btoa(tokenId:tokenSecret)`, body
   `{ input: [{ url }], playback_policy: ['public'] }` → `data.id`;
   throw on non-2xx with status + snippet. `deleteAsset` = DELETE
   `/video/v1/assets/:id`, 404 counts as success (per the port
   contract; mux-video-purge needs it in Wave C — implement now, it's
   3 lines). `verifyWebhookSignature`: config takes an OPTIONAL
   `webhookSecret`; without it the method throws 'not configured' —
   the required `MUX_WEBHOOK_SECRET` env var lands with Wave D, don't
   add it now. Wire in server.ts with MUX_TOKEN_ID/MUX_TOKEN_SECRET.

5. Route `server/src/routes/muxVideoCreate.ts`: `requireUser`; body
   `{ projectId minLength 1, cloudVersion Type.Integer({ minimum: 1 }) }`
   (same Ajv-coercion reasoning as render-job-create); route option
   `statusCallbackUrl` (same app.ts wiring — pass it through to the
   render service). Responses: 200
   `{ status: Type.String(), muxVideoId: Type.String() }`; 400/500
   `additionalProperties: true`; 404 exact body. Log fields:
   `project.id` + `mux.video_status` exist; set `mux.asset_id` when an
   upload happens.

6. Tests — e2e real Postgres + fakeMux + fakeRenderWorker + fakeS3.
   `seedProject`'s `slug` option currently can't produce NULL
   (`opts.slug ?? default`) — change it to `slug?: string | null` with
   an `=== undefined` check (needed for the not-shared test).
   `seedMuxVideo` exists; `seedRenderJob` exists. Matrix: 401
   no/garbage; schema 400s via throwing db; 404 unknown / soft-deleted
   / non-editor (DB unchanged); **400 not-shared exact body** (slug
   NULL, no RPC side effects); existing completed row →
   `{ status: 'completed', muxVideoId }` with NO render job and NO mux
   call; existing pending row → dedup, no side effects; **new row +
   render pending** → mux row pending, render_jobs row created, worker
   dispatched, NO mux asset, response pending; **new row + render
   already completed** (seed a completed render_jobs row with a path)
   → S3 presignDownload of the render path, `fakeMux.createdAssets[0]`
   inputUrl is the presigned URL, mux_videos row gains mux_asset_id +
   render_storage_path with status still 'pending', response
   `{ status: 'pending' }`; **retry** — seed a failed mux_video →
   reset to pending (error/mux_asset_id/mux_playback_id nulled by the
   RPC) and the pipeline runs; **render-failure compensation** —
   override `deps.s3.presignUpload` to throw (inside the render
   service) → 500 AND the mux_video row is `failed` with error
   `Render dispatch failed`; **mux-failure** — override
   `deps.mux.createAsset` to throw → 500 AND the row is `failed`;
   **editor-attribution pin** — explicit editor triggers a fresh
   pipeline → `mux_videos.user_id` and `render_jobs.user_id`/path are
   the OWNER's id; canonical log fields. The renderJobCreate suite
   must pass UNCHANGED after the service extraction. Optional
   third-party tier: skip a Mux integration test (creating real assets
   costs storage; the adapter is 2 trivial calls) — note that in the
   plan instead.

7. Client (`webapp/src/editor/components/header/Header.tsx` ~line
   135): convert the invoke to `invokeFunction` (read the surrounding
   error handling first — type the response so it typechecks without
   `any`), register `'mux-video-create'` in MIGRATED_FUNCTIONS.

8. Run: root `npx vitest run server webapp/src/api`, server
   `npm run typecheck`, webapp `npx tsc -b`, eslint on changed files.
   Update the plan's Status (done entry + analysis + next: Wave C
   scheduler) and add findings to `plans/suggested_changes.md` —
   candidates spotted at prompt time: the RPC ignores `is_deleted`
   when matching rows; a mid-pipeline crash between the RPC and the
   render call leaves a pending mux_video forever (only the failure
   CATCH marks it failed — no reaper); `MUX_API_URL` env override
   exists in the Deno helper but is dropped. Then PAUSE for my
   verification (local webapp flag-on: publish/share a project video
   from the editor header — fresh version, then re-trigger the same
   version for the dedup path; then against Railway after deploy —
   set MUX_TOKEN_ID/MUX_TOKEN_SECRET there first).

Conventions & gotchas: `server/README.md` governs. Nothing is ever
deleted from Supabase. Root `.env.test` is committed on purpose. CI
runs the root vitest config with `supabase start` + `sql/deploy.sh`.
Ajv coercion is ON. No stashing for inspection — `git show HEAD:path`.
Debug before fixing. Use build:extension:dev, never build:extension.
Known pre-existing failures, not yours: cloudProjectService.test.ts
"passes expected version to CloudStorage"; VideoPage.tsx 3 react-hooks
eslint findings; StripeService.ts 2 `no-explicit-any`; cloudStorage.ts
`project_data: any`; useCloudRender.ts 6 `no-explicit-any`.

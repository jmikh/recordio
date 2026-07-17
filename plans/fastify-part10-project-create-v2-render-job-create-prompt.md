# Part 10 prompt — Wave B #12 `project-create-v2` + #10 `render-job-create`

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3, ALL of Wave A
(verified), and Wave B #7 `asset-create` (verified). The prod-webapp
flag flip stays deferred to the END of the migration. Also read
`plans/suggested_changes.md` and ADD any new findings there.

Your task: **two functions, strictly one at a time** —
`project-create-v2` first, PAUSE for user verification, then
`render-job-create` only on the user's explicit go. Do not start
anything else after.

**`project-create` (#11) is NOT being ported — dead code (user decision
2026-07-16):** its only caller chain
(`CloudStorage.createProject` ← `CloudProjectService.importRecordingLocal`)
has zero callers in the webapp; only the V2 pipeline is used
(`ImportPage.tsx` → `importRecordingLocalV2`). It's already struck from
the plan and logged in suggested_changes for decommission. Nothing is
ever deleted from Supabase — just don't port it.

---

## Function 1 — `project-create-v2` (Wave B #12)

1. Read `supabase/functions/project-create-v2/index.ts`.
   **DB-function classification: none called** — one `subscriptions`
   read + one `projects` upsert with the service-role client; plain SQL
   over the pg pool. Behaviors to port: `workspaceId` required;
   `project` with `project.id` required; stamp storage paths into the
   struct for whichever sources exist (`${userId}/${projectId}/screen.webm`,
   `camera.webm`, `mic.wav` — written into
   `project.screenSource.storagePath` etc. BEFORE the upsert, so the
   stored `project_data` contains them); subscription lookup by
   workspace_id — status `active` or `past_due` → `expires_at` NULL,
   anything else (or no row) → now + 14 days; `duration_ms` =
   `Math.round(project.timeline.durationMs)` or null; `name` defaults
   `'Untitled'`; upsert (id, workspace_id, created_by = owner_id =
   caller, name, project_data, upload_status 'pending', duration_ms,
   expires_at); response
   `{ projectId, bucket: 'project-media', uploads: [{ fileType, storagePath }] }`.
   The TUS upload itself stays on Supabase Storage REST (Part 4) and the
   `project_confirm_upload` RPC stays client-called — neither is part of
   this task. No S3 calls at all in this route. Write the analysis
   paragraph as in previous waves.

2. Port as `server/src/routes/projectCreateV2.ts`: `requireUser`.
   Schema: `workspaceId` minLength 1, `name` optional string, `project`
   as `Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: true })`.
   **CRITICAL GOTCHA — Ajv `removeAdditional`:** Fastify's default Ajv
   strips body properties not in the schema. `project` is an arbitrary
   struct (the entire editor project) — the schema MUST NOT strip any of
   it (that's what `additionalProperties: true` is for) and a test MUST
   prove the stored `project_data` round-trips unknown nested fields
   verbatim. Schema 400s replace the edge fn's `Missing workspaceId` /
   `Missing project or project.id` bodies (documented divergence, same
   as all waves). Use `app.deps.clock.now()` (Clock port, already in
   deps) for the 14-day expiry so tests pin it with fakeClock — do NOT
   use `Date.now()`. Log fields: `project.id`, `workspace.id` exist in
   `DomainLogFields`.

3. Tests (`server/test/projectCreateV2.test.ts`): HAS DB access → e2e
   via `app.inject` + real local Postgres (`describe.runIf(hasTestDb())`,
   pool lazily in `beforeAll`). Builders exist: `seedWorkspace`,
   `seedSubscription`, `deleteProjects`, `deleteWorkspaces`. Test
   project ids: fresh `randomUUID()` per test, tracked for cleanup via
   `deleteProjects`. Matrix: 401 no/garbage token; schema 400s (missing
   workspaceId, missing project, project without id) via throwing db;
   success → 200 response shape with only the sources present in the
   struct (screen only / all three), storage paths stamped both in the
   response AND inside the stored `project_data`; **round-trip test**:
   a project with deep unknown fields (`timeline`, `settings.background`,
   arbitrary keys) is stored byte-identical apart from the stamped
   paths (the removeAdditional gotcha); expires_at: active sub → NULL,
   past_due → NULL, trialing → set, no subscription row → set — pin the
   exact +14d instant via fakeClock; duration_ms rounded / null when
   timeline absent; name defaults 'Untitled'; upsert semantics — second
   call with the same project id updates name/project_data (edge-fn
   parity, pinned); DB unchanged on reject paths; canonical log fields.

4. Client: `webapp/src/storage/cloudStorage.ts:createProjectV2` —
   convert the invoke to `invokeFunction` and register
   `'project-create-v2'` in `MIGRATED_FUNCTIONS`
   (`webapp/src/api/client.ts`). Don't touch `createProject` (dead v1,
   being decommissioned) or the TUS upload code.

5. Run the full check suite (below), update the plan Status (done entry
   + analysis + smells into suggested_changes.md), then **PAUSE** for
   user verification (local webapp flag-on: import a recording via the
   Import page — screen-only and screen+camera+mic if easy — confirm
   the project appears, media plays after upload, and `expires_at`
   matches the workspace's subscription; then against Railway after
   deploy).

Smells already suspected (verify and log, don't fix): no workspace
membership check — any authed user can create a project in ANY
workspace id; upsert with a client-supplied id and no ownership check
means an existing project row can be overwritten/hijacked by id
collision; `past_due` treated as entitled to non-expiring projects.

---

## Function 2 — `render-job-create` (Wave B #10) — only on explicit go

1. Read `supabase/functions/render-job-create/index.ts`, its shared
   helpers `_shared/projectAccess.ts` (already ported →
   `src/services/projectAccess.ts`) and `_shared/projectMedia.ts` (port
   now, see below), and `supabase/sql/functions/render_job_get_or_create.sql`.

2. **Auth scope decision (user-approved 2026-07-16): port ONLY the
   user-JWT path.** The edge fn also accepts the service-role key
   (internal caller: the `mux-video-create` edge fn) — that path keeps
   hitting the EDGE function until #9 migrates, at which point the
   ported mux-video-create calls the shared service function in-process
   instead of over HTTP. Do NOT implement service-role auth on the
   server. `requireUser` + `getProjectIfEditor` (any owner/editor can
   start a render — the edge fn's "Pro subscription" comment is stale,
   there is no such check in the code).

3. **DB-function classification: `render_job_get_or_create` is
   EXCLUSIVE to this edge fn** (no client `supabase.rpc` callers) BUT it
   takes explicit `p_user_id` — no `auth.uid()` — so unlike
   subscription-change's RPC it works over the pg pool as-is: call it
   via `SELECT * FROM render_job_get_or_create($1, $2, $3)` through the
   Db port; do NOT port it inline (it's the atomic
   cache-hit/dedup/retry/insert core — reimplementing it in TS would
   lose the atomicity and fork the logic). First route to call a
   `sql/functions/` DB function from the server. Test-infra note: the
   baseline migration (`00000000000000_schema.sql`) contains the
   IDENTICAL function body, so the local/CI `supabase start` DB has it
   without running `sql/deploy.sh` — verified 2026-07-16; sanity-check
   nothing diverged since.

4. Port as `server/src/routes/renderJobCreate.ts`. Flow: schema-validate
   `{ projectId, cloudVersion }` (cloudVersion `Type.Integer()` — the
   RPC param is INT; edge fn only checked non-null/undefined —
   documented divergence); editor access via `getProjectIfEditor` → 404
   `Project not found or access denied`; fetch `id, name, project_data,
   duration_ms` (SIMPLIFICATION: the edge fn does this as a separate
   admin query with its own 404 `Project not found` — collapse into one
   route query or extend the service helper, and document that the
   second 404 body disappears — it was reachable only via a
   delete-between-queries race; note `duration_ms` is selected but never
   used → dead weight, drop it); call the RPC; if `is_new` is false →
   200 `{ jobId, status, renderStoragePath }` straight from the RPC row
   (cache hit / dedup — no presigning, no dispatch); else presign a GET
   for every media path from `getProjectMediaPaths(project_data)` (1 h)
   + a PUT for `render_storage_path` (1 h), then dispatch to the render
   worker and return 200 `{ jobId, status: 'pending', renderStoragePath }`.

5. Port `_shared/projectMedia.ts` → `server/src/services/projectMedia.ts`
   (plain functions over `unknown`/loose project_data — screen, camera,
   mic, settings.background, settings.audio.music paths). Note it's the
   THIRD copy (webapp `shared/utils/projectMedia.ts`, the Deno copy, now
   the server) — add a suggested_changes bullet about consolidating once
   the Deno copy dies.

6. Render worker: `RenderWorkerPort` + `createFakeRenderWorker` already
   exist. Write the real adapter `server/src/adapters/renderWorker.ts` —
   one POST `${RENDER_WORKER_URL}/render`, `Authorization: Bearer
   ${RENDER_SECRET}`, JSON body `{ jobId, projectData, projectName,
   quality: '1080p', mediaUrls, uploadUrl, statusCallbackUrl }`.
   **Fire-and-forget parity:** the edge fn does NOT await the dispatch
   and swallows failures (the hook-timeout cron is the safety net) — in
   the route, call `submitJob(...)` without awaiting, `.catch()` into a
   request-scoped `req.log.warn` (console.* is banned; the canonical
   event has already been or will be emitted — a floating catch-log is
   the one acceptable direct log here, same as startup logs).
   `statusCallbackUrl` = `${SUPABASE_URL}/functions/v1/render-job-hook`
   — the EXISTING Supabase hook URL until Wave D (per plan); build it
   from config `SUPABASE_URL` (already required); the edge fn's
   `RENDER_CALLBACK_URL_DEV` split is dropped (server runs on the host).

7. **Two new env vars — REQUIRED in `server/src/config.ts`**
   (`RENDER_WORKER_URL`, `RENDER_SECRET`, both minLength 1 — per the
   established rule new vars are required, no optional-with-degrade
   groups). Update `server/.env.example`, the root `.env.test`
   (well-known local values are fine — the port is faked in tests, but
   config loading must pass), `server/README.md` env table if one
   exists, and remind the user to set both on Railway BEFORE deploy.
   Wire the adapter in `server/src/server.ts`/`deps.ts` alongside the
   existing s3/stripe adapters.

8. Tests (`server/test/renderJobCreate.test.ts`): e2e real Postgres +
   fakeS3 + fakeRenderWorker (extend the fake with a `submissions`
   array if it doesn't record already — check it). New builders:
   `seedRenderJob` (+ targeted cleanup; check the `render_jobs` DDL for
   NOT NULL columns) — render_jobs rows likely cascade with their
   project, verify. Matrix: 401 no/garbage token; schema 400s (missing
   projectId, missing/null cloudVersion, non-integer cloudVersion) via
   throwing db; 404 unknown project / soft-deleted / non-owner-non-editor
   (DB unchanged, no dispatch); **cache hit**: seed a completed job at
   (project, version) → 200 completed + path, NO new row, NO presigns,
   NO dispatch; **dedup**: seed a pending job → 200 pending, no
   dispatch; **retry**: seed a failed job → 200 pending, SAME row id,
   attempt_count bumped, dispatch happens; **new job**: 200 pending,
   row created with the RPC-computed `render_storage_path`
   (`{userId}/{projectId}/renders/v{n}.mp4`), presigned GETs for exactly
   the media paths in project_data + one PUT for the render path (all
   3600 s), fakeRenderWorker received the full submission incl. the
   Supabase `statusCallbackUrl` and quality '1080p'; **owner vs
   explicit editor** both allowed (editor's job still attributed to the
   EDITOR's user id — parity: the user path uses the caller's id, and
   note the render_storage_path is then under the editor's prefix —
   likely a smell to log); dispatch-failure tolerance: fake throws →
   response is still 200 (fire-and-forget); canonical log fields
   (`project.id`, `render.job_id` exists in DomainLogFields — set it).

9. Client (`webapp/src/editor/components/settings/useCloudRender.ts:149`):
   convert the invoke to `invokeFunction` (note the call site reads
   `data?.error` / `data?.message` on failure — server business errors
   are 4xx with `{ error }` bodies which arrive as FunctionsHttpError,
   same as the edge path via invoke; nothing to change beyond the
   invoke swap) and register `'render-job-create'` in
   `MIGRATED_FUNCTIONS`. Don't touch mux-video-create's service-role
   call (edge-internal).

10. Run the checks, update the plan Status (done entry + analysis +
    next: decide between #8 transcribe / #9 mux-video-create / Wave C
    scheduler) and suggested_changes.md, then **PAUSE** for user
    verification (local webapp flag-on: render a saved project from the
    editor — expect a completed render end-to-end since the callback
    still hits the Supabase hook; re-render the same version to see the
    cache hit; then against Railway after deploy WITH the two new env
    vars set).

---

Checks for each function: root `npx vitest run server webapp/src/api`,
server `npm run typecheck`, webapp `npx tsc -b`, eslint on changed
files.

Conventions & gotchas: `server/README.md` governs (ports/fakes, no
console.*, response schemas, level policy). Nothing is ever deleted
from Supabase. Root `.env.test` is committed on purpose. Railway
DATABASE_URL uses the direct IPv6 connection — see README before
touching db config. Presigned URLs from the server use the adapter's
`S3_ENDPOINT`; for render-job-create they are consumed by the RENDER
WORKER, not the browser — locally a worker inside Docker may not reach
`localhost:9000`, which is fine for tests (fakes) and works in prod
(real S3 endpoint); flag it to the user during local verification.
Response schemas: business 400/404s send exact edge-fn bodies; declare
400/500 with `{ additionalProperties: true }` (see subscriptionChange
for the precedent). Fastify's default Ajv coerces types (pinned in
assetCreate tests) and strips unknown body fields unless the schema
allows them — the project_data round-trip test is mandatory. Debug
before fixing — reproduce or add logs before guessing. Use
build:extension:dev, never build:extension. Known pre-existing
failures, not yours: cloudProjectService.test.ts "passes expected
version to CloudStorage"; VideoPage.tsx's 3 react-hooks eslint
findings; StripeService.ts 2 `no-explicit-any`; cloudStorage.ts
`project_data: any`; userAssetService.ts `row: any`.

# Part 9 prompt — Wave B #7: asset-create

Continue the Supabase → Fastify migration. Read
`plans/fastify-part1-edge-functions-migration.md` first — its "Status"
section is the source of truth. Done so far: Steps 0–3 and ALL of Wave A
(storage-download-urls, shared-video-get, stripe-checkout, stripe-portal,
subscription-change, project-update-thumbnail; unsubscribe punted to
Wave E) — check Status for whether project-update-thumbnail's user
verification is recorded. The prod-webapp flag flip stays deferred to the
END of the migration. Also read `plans/suggested_changes.md` and ADD any
new findings there.

Your task: **asset-create** only — first Wave B route. Do not start #8
(transcribe) until I explicitly say go.

Despite the Wave B label this is mechanically simple (the Step 0.5
survey confirmed there is NO S3 multipart anywhere): validation → a
library-limit count → insert a pending `user_assets` row → return a
presigned PUT (`S3Port.presignUpload` — already implemented and
integration-tested). The client uploads to S3 directly, then calls the
`asset_confirm_upload` RPC (client-called SQL — NOT part of this task,
stays untouched).

**One deliberate behavior FIX (user decision 2026-07-16), not parity:**
the edge fn returns the rich library-full body
`{ error: 'library_full', message: 'Library full (10/10). Delete an
asset to upload a new one.', count, limit }` with **status 403** — but
`supabase.functions.invoke` surfaces any non-2xx as `data: null` + a
generic FunctionsHttpError, so the client's `AssetLibraryFullError`
branch (`webapp/src/storage/userAssetService.ts:85-90`, keyed on
`data?.error === 'library_full'`) is DEAD code today: users with a full
library get a generic error instead of the friendly one. Fix while
porting: return the SAME body with **status 200**. `invokeFunction`
then hands the client `data` with `error: 'library_full'` and the
existing client branch works verbatim — zero client-code changes.
Document as a deliberate divergence (200-with-error-body is the
contract the client was clearly written for); note that the flag-off /
edge-fn path keeps the old broken-generic behavior until cutover.

1. Read `supabase/functions/asset-create/index.ts`.
   **DB-function classification: none called** — direct `user_assets`
   count/insert/delete with the service-role client; plain SQL over the
   pg pool. Behaviors to port: assetType must be background|music;
   fileName required; sizeBytes must be a number > 0; extension
   allow-list per type (background: jpg/jpeg/png/webp/avif; music:
   mp3/wav/aac/m4a/ogg — from `fileName.split('.').pop()`, lowercased);
   size caps 25 MB background / 50 MB music; library limit 10 per type
   counting ONLY `status = 'ready' AND is_deleted = false`; storage path
   `${userId}/assets/${assetId}.${ext}` with a fresh route-generated
   uuid; pending row insert (id, user_id, asset_type, storage_path,
   name = fileName, size_bytes, status 'pending'); presign PUT 3600 s;
   **compensating cleanup** — if presigning throws, DELETE the pending
   row before rethrowing (first route with this pattern). Write the
   analysis paragraph as in previous waves.

2. Port as `server/src/routes/assetCreate.ts`: `requireUser`. Schema:
   `assetType` as a Literal union, `fileName` minLength 1, `sizeBytes`
   `Type.Number({ exclusiveMinimum: 0 })` — schema 400s replace the
   edge fn's per-field 400 bodies (documented divergence, same as all
   waves; no call site reads non-2xx bodies). The extension and
   size-cap checks are cross-field → handler checks with the exact
   edge-fn bodies. 200 response is a Union: the success shape
   `{ signedUrl, storagePath, assetId }` | the library_full shape
   `{ error, message, count, limit }` (see the subscription-change
   route for the Union + additionalProperties precedents). Log fields:
   `storage.bytes` exists; add `asset.type` to `DomainLogFields`.

3. Tests: HAS DB access → e2e via `app.inject` + real local Postgres
   (`describe.runIf(hasTestDb())`, pool in `beforeAll`), fakeS3.
   Add a `seedUserAsset` builder + targeted cleanup to
   `test/helpers/db.ts` (note: `user_assets.id` is TEXT, not uuid;
   check the table DDL for NOT NULL columns). Matrix: 401 no/garbage
   token; schema 400s (bad assetType, missing fileName, sizeBytes
   0/negative/string) via throwing db; handler 400s with exact bodies
   (bad extension for each type, oversize per type — boundary: exactly
   at the cap passes, cap+1 fails); library limit — seed 10 ready
   assets → **200 with the exact library_full body** and NO insert;
   soft-deleted and pending rows do NOT count toward the limit (seed 10
   where some are deleted/pending → succeeds); success → 200, response
   shape, `presignedUploads` recorded (key + 3600), DB row exists with
   status 'pending' and all fields, storagePath extension matches the
   (lowercased) input extension; **presign failure → pending row
   deleted, 500** (override `deps.s3.presignUpload` to throw, then
   assert the row is gone — the compensating-cleanup test); canonical
   log fields. Assert DB unchanged on every reject path.

4. Client (`webapp/src/storage/userAssetService.ts:uploadAsset`):
   convert ONLY the `asset-create` invoke to `invokeFunction` and
   register `'asset-create'` in MIGRATED_FUNCTIONS
   (`webapp/src/api/client.ts`). The `library_full` branch needs no
   change — that's the point of the fix. Keep the `!supabase` guard
   (the RPC + later steps still use supabase directly). Don't touch
   `CloudStorage.uploadBlob` or the confirm RPC.

5. Run: root `npx vitest run server webapp/src/api`, server
   `npm run typecheck`, webapp `npx tsc -b`, eslint on changed files.
   Update the plan's Status (done entry + analysis + next: transcribe)
   and add findings to `plans/suggested_changes.md`, then PAUSE for my
   verification (local webapp flag-on: upload a background image and a
   music file from the editor asset library, hit the full-library case
   if easy; then against Railway after deploy).

Conventions & gotchas: `server/README.md` governs (ports/fakes, no
console.*, response schemas, level policy). Nothing is ever deleted
from Supabase. Root `.env.test` is committed on purpose. CI runs the
root vitest config with `supabase start` backgrounded. Railway
DATABASE_URL uses the direct IPv6 connection — see README before
touching db config. Presigned URLs are consumed by the BROWSER, so the
adapter's `S3_ENDPOINT` (reachable from the user's machine) is the
right endpoint — the edge fn's `S3_ENDPOINT_DEV` split stays dropped.
No new env vars. Debug before fixing — reproduce or add logs before
guessing. Use build:extension:dev, never build:extension. Known
pre-existing failures, not yours: cloudProjectService.test.ts "passes
expected version to CloudStorage"; VideoPage.tsx's 3 react-hooks eslint
findings; StripeService.ts has 2 `no-explicit-any` findings;
cloudStorage.ts has a `project_data: any` finding.

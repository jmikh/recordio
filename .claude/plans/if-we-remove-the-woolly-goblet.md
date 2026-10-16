# Storage upload authority (tiered plan)

> On approval this is saved as
> `plans/storage-upload-authority/storage-upload-authority-tiered-plan.md`
> (planning skill convention). Step docs are written as each step starts.

## Context

The browser uploads to the `project-media` bucket with TUS, using its own
Supabase login. The only guard is a set of storage.objects policies that say
"the first folder must be your own user id"
(`supabase/migrations/20260602212305_…`, `20260724105919_…`). That causes
several problems:

- **The camera matte can't be uploaded correctly by anyone except the
  creator.** The job builds its own path from the logged-in user
  (`cameraMatteJob.ts:69`). A collaborator's matte lands outside the
  creator's prefix, so the purge job misses it. While impersonating, the job
  is skipped entirely, so the editor shows "Computing background mask…"
  forever. That's how this started: Sentry RECORDIO-9C, where a user's matte
  job failed and we couldn't rerun it for them.
- **The policies let any user write anything under their own prefix:** other
  projects, `renders/`, thumbnails, screenshot renders, and library assets,
  which skips the size/type caps on the server routes.
- **Impersonation tokens are valid Supabase JWTs**
  (`adminImpersonate.ts:68-73`), so a token holder can upload straight to
  Storage and skip the impersonation allow list.
- **The confirm routes check nothing in storage.**
  `project-confirm-upload` and `screenshot-confirm-upload` flip
  `upload_status` to `ready` whether or not the files exist.

The goal: the server decides every write and the client keeps resumable TUS
uploads. This replaces step 4 of
`plans/storage-followups/storage-followups-tiered-plan.md` (camera matte via
presigned PUT, which would have lost resumability).

## Design

### Mechanism: Supabase signed resumable uploads
Supabase Storage accepts TUS uploads at
`/storage/v1/upload/resumable/sign` with an `x-signature` header. The value
is a token from `createSignedUploadUrl(path, { upsert })`, minted with the
service role. Each token is valid for one object key for about 2h and
doesn't depend on the uploader's login. The client keeps tus-js-client (6 MiB
chunks, retries, resume). Only the endpoint and the auth header change.

### Where the server is the judge
1. **Path:** only the server builds keys, always with `storagePaths.ts` and
   the row's `created_by`. `cloudStoragePath` is deleted.
2. **Who:** every token comes from a route that checked access first: owner
   plus pending for recordings, create for screenshots, editor for the
   matte. Because tokens come from routes, the impersonation allow list
   applies to uploads too.
3. **What:** a token covers exactly one key and expires.
4. **Result:** confirm and attach routes `HEAD` the object before they
   change any row.
5. **Nothing else:** all three storage.objects policies on `project-media`
   are dropped, so a user JWT (impersonation tokens included) can no longer
   read or write Storage directly. Reads already go only through presigned
   URLs from the server (audited: no direct browser reads, no client
   deletes).

Remaining gap: a token can't cap the file size. The bucket's
`file_size_limit` (5 GiB) is the cap. Setting `allowed_mime_types` on the
production bucket is optional hardening, done in the dashboard.

### Server building blocks
- `SupabaseApiPort.createUploadToken(key)`: the adapter calls
  `storage.from('project-media').createSignedUploadUrl(key, { upsert: true })`
  and returns `token`. The fake records the tokens it issues. Port:
  `server/src/ports/supabaseApi.ts`, adapter: `adapters/supabaseApi.ts`
  (already a service-role supabase-js client).
- `S3Port.headObject(key)` returns `{ size, contentType } | null`, with
  NotFound mapped to null, plus fake support. A TUS object only exists once
  the upload finishes.
- Every response that hands out an upload carries
  `{ storagePath, uploadToken }`.

### Routes
| Route | Check | Returns |
|---|---|---|
| `project-create-v2` (existing) | as today | `uploads[]` gains `uploadToken` |
| `screenshot-create` (existing) | as today | gains `uploadToken` |
| `project-upload-tokens` (new) | caller is owner, project `pending`, not deleted | `{ bucket, uploads[] }` with fresh tokens, used to resume after reload and to refresh a token |
| `project-confirm-upload` / `screenshot-confirm-upload` | + `headObject` on every expected media path | 409 `upload_incomplete` if any is missing |
| `project-camera-matte-upload` (new) | `getProjectIfEditor` | `{ storagePath: projectMediaPath(created_by, id, 'cameraMatte'), uploadToken }` |
| `project-camera-matte-set` (new) | editor access + `headObject` | writes `cameraSource.matte` via `jsonb_set`, **no** `cloud_version` bump → `{ matte }` |

**The matte is a server-owned field.** `project-update` always keeps the
stored `cameraSource.matte` and ignores whatever the client sends. That
normalization runs before the md5 no-op check, so a save that differs only
in the matte stays a no-op. Open editors can't drop or forge it, and
matte-set never causes a conflict.

**Impersonation allow list** (`shared/api/impersonation.ts`): add both matte
routes as sanctioned writes, with a header note. The matte is derived from
the user's own recording, the only visible effect is that "No background"
becomes available, and the user would compute it themselves anyway.
`project-upload-tokens` is not added.

### Client
- `CloudStorage.uploadBlobResumable` takes a target
  `{ bucket, storagePath, uploadToken, refreshToken? }`:
  - endpoint `…/upload/resumable/sign`
  - headers `apikey` + `x-signature`, set in an async `onBeforeRequest` so a
    refreshed token applies to the next chunk
  - on 401/403, call `refreshToken()` once and retry
  - a custom `fingerprint` of bucket + path + size. Today blobs with the same
    type and size can resume each other's uploads.
- Recordings: `uploadMediaV2` uses the tokens from create, and refreshes and
  resumes through `project-upload-tokens` (`resumePendingUploads`,
  `tryResumeUpload`).
- Screenshots: use the token from create, with no refresh. They're small and
  a retry re-imports.
- Matte job: `project-camera-matte-upload`, then TUS, then
  `project-camera-matte-set`, then a local `setCameraMatte` for the UI. The
  `getImpersonation()` gate is removed (the template-mode gate stays).

### Rollout order
1. Server first, additive.
2. Then the webapp.
3. The policy-drop migration last, after the new webapp is live. Tabs still
   running the old bundle would fail uploads after the drop, and a reload
   fixes them.

Uploads in progress across the deploy restart from zero, because the tus
fingerprint now includes the endpoint and path.

### Out of scope (go to agent suggestions)
- `project-create-v2` / `screenshot-create` can take over an existing row
  through the upsert. Step 1 of storage-followups covers projects. Screenshots
  have the same hole.
- Existing collaborator mattes under the wrong prefix: they still load but
  aren't purged.
- Template mode still shows "Computing background mask…" for "No
  background" (`useMatteWaitMessage.ts:18`).

## Steps
1. **Spike (local Supabase, policies dropped locally).** Confirm the
   following, and pick a fallback for anything that fails:
   - A signed TUS upload works for a multi-chunk blob, and upsert
     overwrites.
   - A fresh token for the same key continues an interrupted upload.
   - A token for another key is refused.
   - A user-JWT TUS upload is refused.
   - `headObject` is null before the upload completes and present after.
2. **Server building blocks.** `createUploadToken`, `headObject`, fakes and
   tests.
3. **Server routes for recordings and screenshots.** Tokens on create,
   `project-upload-tokens`, confirm verification, shared API schemas, tests.
4. **Client uploader.** The signed endpoint, refresh, fingerprint, and the
   wiring for recordings and screenshots. Unit tests.
5. **Camera matte becomes server-owned.** The two routes, `project-update`
   keeping the stored matte, the allow list, the client job (no impersonation
   gate), and deleting `cloudStoragePath`. The e2e fixture changes to create
   first, then upload to the returned paths with the service role. Also the
   decoder bug from RECORDIO-9C: re-check `throwIfStopped()` after the
   backpressure wait (`computeCameraMatte.ts:224-228`) so the real decoder
   error is what gets reported.
6. **Drop the storage policies.** A migration that drops
   `project_media_authenticated_{insert,update,select}`. It ships after the
   webapp, and a check of the production dashboard confirms no other
   project-media policies exist.
7. **Docs.** The `storagePaths.ts` header and the `isProjectPath` comment
   (the matte is no longer an exception), the `cloudStorage.ts` doc, and
   storage-followups step 4 marked superseded.

## Verification
- **Server:** `npm test` in `server/`. Cover:
  - the token routes and their access checks (owner/pending, editor,
    impersonation allowed or refused)
  - confirm returning 409 when an object is missing
  - matte-set: no version bump, path is under `created_by`
  - `project-update` keeping the stored matte, and the no-op case
- **Webapp:** the vitest suite (`cloudProjectService.test.ts`, new
  `cloudStorage` tests), plus a typecheck of both packages.
- **e2e:** `screenshot.spec.ts` (real TUS plus confirm) and `import.spec.ts`,
  extended to wait for the upload to finish.
- **Manual, local:**
  1. Import a recording, reload mid-upload, and confirm it resumes from the
     dashboard.
  2. Open a project as a collaborator and check the matte lands under the
     creator's prefix.
  3. Impersonate the RECORDIO-9C user's project. The matte job should run,
     upload, attach, and "No background" should become available.
  4. Check that a direct TUS upload with a user JWT now gets 403.

## Step log

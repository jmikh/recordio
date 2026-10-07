# Storage follow-ups (tiered plan)

## Context

Follow-ups from `plans/storage-download-permissions-oneshot.md` (download
URLs now come only from routes that checked access; library assets are
copied into projects). Its `storage-download-permissions-agent-suggestions.md`
lists what was found and left out of scope. This plan fixes those items,
plus thumbnails going stale on other devices.

Each step is independent and ships on its own. They're ordered by risk:
the security fix comes first, the test-hygiene item last.

## Design

### 1. `project-create-v2` must not take over an existing project (security)
Today the `ON CONFLICT (id) DO UPDATE` overwrites `created_by`, `owner_id`,
`workspace_id` and `project_data` of any existing row with that id. Project
ids are visible to every workspace member through `project-list`.

- Before any work (including the default-asset S3 copies), look up an
  existing row with that id. If there is one, it must be the caller's own
  row (`created_by = caller`) that is still `upload_status = 'pending'` and
  not deleted. Otherwise return **409 `project_exists`**.
- Keep the same condition as a `WHERE` on the `DO UPDATE`, which covers the
  race between the check and the write. No row returned → 409.
- Legitimate retries (same import, still pending) keep working. The step
  doc confirms that no client path calls create-v2 again for a ready
  project (resume flows reuse the existing row).

### 2. Lists return only what the caller can view (privacy)
`project-list` and `screenshot-list` return every row in the workspace and
the dashboard hides the rest client-side, so names/ids of other members'
private items leak.

- Move the existing `can_view` predicate into the `WHERE` (projects: owner,
  any editor grant, or shared workspace/public; screenshots: owner, or
  shared). `thumbnail_url` then simply signs every row that has a thumbnail.
- The step doc checks every consumer of the lists before filtering: the
  dashboard's mine/shared/trash views, `libraryCounts`, `CapRecoveryPanel`
  and the free-plan cap UI. Admin views use `admin-project-list`, which is
  separate.

### 3. Renders under the project creator (hygiene)
Renders sat under the requester's prefix only because downloads used to go
through the caller-prefix check. Downloads now use `render_url`.

- `renderJobs.ts` reads the project's `created_by` (already in the project
  query's row) and passes it to `projectRenderPath`. Update its doc and the
  `storagePaths.ts` header, which currently lists renders as the one
  exception.
- Existing rows keep their stored paths (a cache hit returns the row's own
  path). New and retried renders land under the creator, so the purge job
  deletes them with the project.

### 4. Camera matte uploads through a server-issued URL (hygiene)
`cameraMatteJob.ts` builds `${currentUser}/${projectId}/cameraMatte.webm`
on the client and uploads it via TUS. The storage write policy only allows
writes under the caller's own id, so a collaborator's matte lands outside
the creator's prefix and the purge job misses it. It's the last client-side
path builder.

- New route `project-media-upload-url { projectId, type: 'cameraMatte' }`:
  editor access → `{ storagePath: projectMediaPath(created_by, projectId,
  'cameraMatte'), uploadUrl }`, where `uploadUrl` is a presigned PUT
  (`s3.presignUpload`, already used for render-worker uploads).
- The client PUTs the blob with XHR progress, then attaches `storagePath` as
  today.
- **Spike first:** confirm a browser PUT to a presigned URL works against
  the Supabase Storage S3 endpoint (CORS preflight, Content-Type vs. the
  signature). Fallback if it doesn't: a streaming multipart route on the
  server (like `project-update-thumbnail`, with a larger cap).
- Resumability is lost compared to TUS. That's acceptable because the matte
  is computed on the client and the job can just run again.
- Then delete `cloudStoragePath` from `shared/utils/projectMedia.ts`. No
  storage path is built on any client after this.
- Already-uploaded collaborator mattes stay where they are. They're still
  inside the project namespace so they still load, but they aren't purged.
  A cleanup is optional and not in this plan.

### 5. Defaults only reference the user's library; preview shows it (bug)
"Use as my default settings" can store a project's *copy* path (or, from
pre-copy days, a collaborator's library path) as the default background.
The Personal Settings preview never shows a stored custom background,
because nothing hydrates it.

- `user-project-defaults-set` normalizes `settings.background.storagePath`
  on the server. A project copy whose file name (`<assetId>.<ext>`) matches
  one of the caller's ready `user_assets` rows becomes that row's library
  path. Anything else that isn't already the caller's library path is
  reset to `type: 'color'`, the same semantics as create-v2's reset. Only
  the background matters, because the `audio` tree isn't part of defaults.
- The settings page loads the asset library and hydrates a stored custom
  background through `useAssetLibraryStore.resolveBlobUrl` into the media
  URL store, which `DefaultsPreview` reads.
- create-v2's copy-on-create keeps working unchanged (library path → project
  copy).

### 6. Thumbnails refetch after 48h (stale on other devices)
The thumbnail path is reused on every upload, so another browser keeps its
cached copy indefinitely.

- `BlobCache` records when it cached an entry (a timestamp header on the
  stored `Response`, written by both `put` and downloads).
- `getBlobUrls` takes an optional `maxAgeMs`. An entry older than that, or
  with no timestamp (cached before this change), is treated as a miss
  *when a URL is available*. With no URL it is still served.
- Both dashboards' `loadThumbnails` pass 48h. The editor's own upload
  refreshes the entry through `put`, so the device that made the change is
  never stale.
- Accepted trade-off: other devices may show an old thumbnail for up to 48h.

### 7. Flaky admin subscriber-list test (test hygiene)
`adminImpersonation.test.ts` "lists subscribers…" failed once in a full
parallel run, then passed alone and on rerun. The cause isn't confirmed.
The route has no LIMIT, and the test finds its row by workspace id.

- **Reproduce before fixing** (per CLAUDE.md): loop the full server suite
  until it fails, capture the actual response for the missing row, then fix
  the confirmed cause (likely a cross-suite data interaction).

## Steps

1. **create-v2 ownership guard.** Pre-check plus guarded upsert, 409
   `project_exists`. Tests for takeover attempts and legitimate retries.
2. **List privacy.** `project-list` / `screenshot-list` return only viewable
   rows. Audit the consumers, then tests.
3. **Renders under the creator.** Pass `created_by` to `projectRenderPath`.
   Update docs and tests.
4. **Camera matte server-issued upload.** Spike the presigned PUT, then add
   `project-media-upload-url`, switch the client, and delete
   `cloudStoragePath`.
5. **Defaults normalization + preview.** Normalize in
   `user-project-defaults-set`. The settings page hydrates the stored
   background from the library.
6. **Thumbnail cache age.** `BlobCache` timestamps and `maxAgeMs`; the
   dashboards use 48h.
7. **Flaky admin test.** Reproduce, confirm the cause, then fix.

## Step log

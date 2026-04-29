# Add `cloudUrl` to Project Sources + `getBlobs()` Abstraction

## Context

Media storage paths currently live as DB columns (`screen_storage_path`, `camera_storage_path`, `mic_storage_path`) on the `projects` table. Every consumer (load, export, transfer) independently reads these columns and enumerates asset types with repetitive if-blocks. Adding a new asset type means a DB migration + touching every consumer. The `storage-confirm-media` edge function adds unnecessary round-trips — after each upload it writes the path to a column and checks if all media is done.

This refactor moves the storage path into the project JSON itself as a `cloudUrl` field on each source. A single `getBlobs()` function makes all webapp consumers agnostic of DB structure. The paths are deterministic (`userId/projectId/fileType.ext`), so:
- Existing projects can be backfilled on load without a data migration
- The real paths can be written at row-creation time (not 'pending')
- `storage-confirm-media` becomes unnecessary — the client sets `upload_status = 'ready'` directly after uploads finish

**Scope**: Webapp only. Render worker / backend changes excluded.

---

## Steps

### 1. Add `cloudUrl` to types

**`shared/types/core.ts`** — add `cloudUrl?: string` to `BaseSourceMetadata` (flows to Screen, Camera, Mic automatically)

**`shared/types/settings.ts`** — add `cloudUrl?: string` to `BackgroundSettings` and `MusicSettings` (placeholder, not populated yet)

### 2. Bump schema version

**`webapp/src/core/Project.ts`** — `CURRENT_SCHEMA_VERSION` from `4` to `5`

### 3. Add v5 migration comment

**`webapp/src/core/migrateProject.ts`** — add a `if (version < 5)` block that's a no-op with a comment explaining cloudUrl is backfilled in `loadProject()` (migration doesn't have userId).

### 4. Create `projectBlobs.ts` utility

**New file: `webapp/src/storage/projectBlobs.ts`**

Three exports:

- **`cloudStoragePath(userId, projectId, fileType)`** — returns the deterministic path (`userId/projectId/screen.webm` etc). Extension map: screen→webm, camera→webm, mic→wav, thumbnail→webp.

- **`getBlobs(project): BlobEntry[]`** — iterates screenSource, cameraSource, microphoneSource; returns `{ sourceId, cloudUrl, type }` for each source that has a `cloudUrl`. Consumers use this instead of knowing about individual sources.

- **`hydrateMediaUrls(project, setUrl, onStatus?)`** — calls `getBlobs()`, then `BlobCache.getBlobUrl()` for each entry, and passes the result to `setUrl`. Replaces the manual 3-block hydration in `loadProject`.

### 5. Update `loadProject()` — backfill + use `hydrateMediaUrls`

**`webapp/src/storage/cloudProjectService.ts`** `loadProject()` (lines ~220-290):

After `migrateProject()`, stamp `cloudUrl` on each source if missing:

```
const userId = cloudProject.user_id;
if (!project.screenSource.cloudUrl) {
    project.screenSource.cloudUrl = cloudStoragePath(userId, projectId, 'screen');
}
// same for camera, mic
```

Replace the 3 manual `if (cloudProject.*_storage_path)` hydration blocks (lines 239-254) with:
```
await hydrateMediaUrls(project, setUrl, onStatus);
```

Custom background/music hydration (lines 259-287) stays unchanged.

### 6. Update `importRecordingLocal()` — stamp on creation + write real paths

**`webapp/src/storage/cloudProjectService.ts`** `importRecordingLocal()` (lines ~82-91):

When building source objects, add `cloudUrl: cloudStoragePath(userId, projectId, 'screen')` (and camera/mic). New projects get `cloudUrl` from the start.

### 7. Write real storage paths at insert time (not 'pending')

**`webapp/src/storage/cloudStorage.ts`** `saveProjectMetadata()` (lines 106-117):

Since paths are deterministic, write the actual paths at insert time instead of `'pending'`:

```
screen_storage_path: project.screenSource?.cloudUrl ?? null,
camera_storage_path: project.cameraSource?.cloudUrl ?? null,
mic_storage_path: project.microphoneSource?.cloudUrl ?? null,
```

This keeps the DB columns populated (render worker still reads them) without needing the confirm-media round-trip. `upload_status` still starts as `'pending'` — it flips to `'ready'` after uploads finish (next step).

### 8. Remove `confirmMediaUpload` call + client sets `upload_status = 'ready'`

**`webapp/src/storage/cloudStorage.ts`**:
- In `uploadMediaFile()` (line 416): remove the `await this.confirmMediaUpload(...)` call. The method just uploads the blob and returns the storagePath.
- Add a new static method `setUploadReady(projectId)` that does a direct supabase update: `.update({ upload_status: 'ready' }).eq('id', projectId)`

**`webapp/src/storage/cloudProjectService.ts`** `uploadMedia()` (lines ~165-175):
- After all uploads succeed (where it currently calls `store.setIdle()`), call `CloudStorage.setUploadReady(projectId)` to flip the status.

This replaces the per-file edge function round-trip with a single client-side update after all uploads complete.

---

## What stays unchanged

- **DB columns** — still written (with real paths at insert, not 'pending'), still read by render worker
- **`blobCache.ts`** — already storage-path-agnostic
- **`useMediaUrlStore.ts`** — no changes
- **`ExportManager.ts` (shared)** — already consumes `mediaUrls` by source ID
- **`storage-confirm-media` edge function** — no longer called, can be deleted later
- **`projectTransfer.ts`** — unchanged for now
- **Render worker / backend** — out of scope

## Files to modify

| File | Change |
|------|--------|
| `shared/types/core.ts` | Add `cloudUrl` to `BaseSourceMetadata` |
| `shared/types/settings.ts` | Add `cloudUrl` to `BackgroundSettings`, `MusicSettings` |
| `webapp/src/core/Project.ts` | Bump schema to 5 |
| `webapp/src/core/migrateProject.ts` | Add v5 no-op migration comment |
| `webapp/src/storage/projectBlobs.ts` | **New**: `cloudStoragePath`, `getBlobs`, `hydrateMediaUrls` |
| `webapp/src/storage/cloudProjectService.ts` | Backfill cloudUrl on load, stamp on import, set ready after upload |
| `webapp/src/storage/cloudStorage.ts` | Write real paths at insert, remove confirmMediaUpload call, add setUploadReady |

## Verification

1. Open an existing project — should load normally (cloudUrl backfilled on load, media plays)
2. Record a new project — should import with cloudUrl stamped, media plays immediately, project appears in dashboard (upload_status = 'ready')
3. Check that `cloudUrl` persists in project_data JSONB after save
4. Check that `*_storage_path` columns have real paths (not 'pending') after new project creation

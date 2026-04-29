# Custom Backgrounds & Music — Cloud Asset Library

## Context

Custom backgrounds and music uploads are currently stubbed out. The `useProjectStore` methods (`uploadAndSelectBackground`, `selectBackgroundFromLibrary`) create local blob URLs only — nothing persists to the cloud. The `user_assets` table exists but is unused. This plan wires up the full lifecycle: upload to cloud library, select for project, load on project open, and serve to the render worker.

**Key design principle**: Assets are uploaded once to the user's library. Projects reference them by `storagePath` in the project JSON — the same pattern as screen/camera/mic sources. No separate DB columns on `projects`. The `getProjectMediaPaths()` function is the single source of truth for "what blobs does a project need?", so custom assets just become additional entries there and the entire pipeline (BlobCache hydration, signed URL generation, render worker download) works automatically.

**Library limits**: 10 backgrounds + 10 music tracks per user (counted where `status = 'ready' AND is_deleted = false`). Enforced server-side in the edge function and client-side in the UI.

---

## Phase 1: Database & Type Cleanup

### 1a. Migration — `user_assets` updates

**New file:** `webapp/supabase/migrations/<timestamp>_user_assets_soft_delete.sql`

```sql
-- Soft delete support
ALTER TABLE public.user_assets ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- Upload lifecycle: pending → ready (mirrors projects pattern)
ALTER TABLE public.user_assets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';

-- Index for library queries (active, ready assets)
CREATE INDEX IF NOT EXISTS idx_user_assets_active
    ON public.user_assets(user_id, asset_type)
    WHERE is_deleted = false AND status = 'ready';
```

No new columns on `projects` — custom asset references live in `project_data` JSON via `storagePath`.

### 1b. Type cleanup — `shared/types/settings.ts`

On `BackgroundSettings`:
- `storagePath` already exists — this becomes the authoritative field for custom backgrounds
- Remove `customStorageUrl` (redundant with `storagePath`)
- Remove `customRuntimeUrl` (blob URLs live in `useMediaUrlStore`, not on the project)
- Keep `customLibraryId` — used by the UI to highlight which library entry is selected

On `MusicSettings`:
- `storagePath` already exists — authoritative field for custom music
- Remove `customStorageUrl` (redundant with `storagePath`)
- Remove `customRuntimeUrl` (blob URLs live in `useMediaUrlStore`)
- Keep `customLibraryId`

### 1c. Extend `getProjectMediaPaths()` — `shared/utils/projectMedia.ts`

Add background and music storagePaths to the extraction:

```typescript
export type MediaEntryType = 'screen' | 'camera' | 'mic' | 'background' | 'music';

export interface MediaEntry {
    storagePath: string;
    type: MediaEntryType;
}

// Inside getProjectMediaPaths():
if (project.settings?.background?.storagePath) {
    entries.push({
        storagePath: project.settings.background.storagePath,
        type: 'background',
    });
}

if (project.settings?.audio?.music?.storagePath) {
    entries.push({
        storagePath: project.settings.audio.music.storagePath,
        type: 'music',
    });
}
```

**Also update the Deno copy** at `webapp/supabase/functions/_shared/projectMedia.ts`.

---

## Phase 2: Edge Function — `asset-upload-url`

**New file:** `webapp/supabase/functions/asset-upload-url/index.ts`
**New file:** `webapp/supabase/functions/asset-upload-url/.config.toml`

Modeled on `storage-upload-url` but for user assets. Uses a pending → ready lifecycle to avoid orphan blobs.

**Flow:**
1. Validate asset type, file extension, size limits (25 MB bg, 50 MB music)
2. **Check library limit**: count `user_assets WHERE user_id = X AND asset_type = Y AND status = 'ready' AND is_deleted = false`. Reject with `library_full` error if >= 10
3. Generate asset ID: `crypto.randomUUID()`
4. Build path: `{userId}/assets/{assetId}.{ext}` — server computes the path
5. Insert `user_assets` row with `status: 'pending'` (row exists before upload starts)
6. Create signed upload URL via admin client
7. Return: `{ signedUrl, token, storagePath, assetId }`

**Request:** `{ assetType: 'background' | 'music', sizeBytes, fileName }`
**Response:** `{ signedUrl, token, storagePath, assetId }`
**Error responses:** `library_full` (403), validation errors (400)

**Orphan cleanup**: A cron job deletes `pending` rows older than 1 hour (client crashed between getting URL and confirming upload).

**Existing patterns to reuse:**
- `webapp/supabase/functions/_shared/auth.ts` — `withAuth`, `jsonResponse`, `errorResponse`
- `webapp/supabase/functions/storage-upload-url/index.ts` — overall structure

---

## Phase 2b: Edge Function — `asset-confirm-upload`

**New file:** `webapp/supabase/functions/asset-confirm-upload/index.ts`
**New file:** `webapp/supabase/functions/asset-confirm-upload/.config.toml`

Called by the client after a successful direct upload to storage.

- Request: `{ assetId }`
- Verifies the asset row exists, belongs to the user, and has `status: 'pending'`
- Flips `status` to `'ready'`
- Returns: `{ success: true }`

Similar pattern to `confirm-upload` for projects.

---

## Phase 2c: Cron — Cleanup stale pending assets

**New file:** `webapp/supabase/sql/crons/cron_cleanup_pending_assets.sql`

```sql
-- Delete pending asset rows older than 1 hour (upload never completed)
DELETE FROM public.user_assets
WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 hour';
```

Also delete the corresponding storage blobs if they exist (or let storage lifecycle rules handle it).

---

## Phase 3: `UserAssetService`

**New file:** `webapp/src/storage/userAssetService.ts`

```typescript
export interface UserAsset {
    id: string;
    assetType: 'background' | 'music';
    storagePath: string;
    name: string | null;
    sizeBytes: number;
    createdAt: string;
}

const LIBRARY_LIMIT = 10; // per asset type
```

**Methods:**

| Method | What it does |
|--------|-------------|
| `uploadAsset(file, type)` | Calls `asset-upload-url` edge fn → uploads blob via signed URL → calls `asset-confirm-upload` → caches blob locally via `BlobCache.put()` → returns `UserAsset` |
| `listAssets(type)` | Queries `user_assets` where `status = 'ready' AND is_deleted = false`, ordered by `created_at desc` |
| `deleteAsset(id)` | Soft delete: `update({ is_deleted: true })`. Evicts from BlobCache |
| `canUpload(type)` | Returns `listAssets(type).length < LIBRARY_LIMIT` |

Note: No `getAssetBlobUrl()` method — callers use `BlobCache.getBlobUrl(storagePath)` directly.

**Existing code to reuse:**
- `webapp/src/storage/blobCache.ts` — `BlobCache.put()`, `getBlobUrl()`, `evict()`
- `webapp/src/storage/cloudStorage.ts` — `CloudStorage.uploadBlob()` for the signed URL PUT
- `webapp/src/auth/AuthManager.ts` — Supabase client for DB queries

---

## Phase 4: Wire Up `useProjectStore`

**Modify:** `webapp/src/editor/stores/useProjectStore.ts`

| Stub | Replacement |
|------|-------------|
| `uploadAndSelectBackground(blob)` | Call `UserAssetService.uploadAsset(file, 'background')` → set `storagePath` on background settings → put blob URL in `useMediaUrlStore` keyed by storagePath → return `{ libraryId: asset.id, storagePath: asset.storagePath }` |
| `selectBackgroundFromLibrary(libraryId)` | Look up asset from `UserAssetService`, resolve blob URL via `BlobCache.getBlobUrl(storagePath)` → set in `useMediaUrlStore` → return `{ libraryId, storagePath }` |
| `clearProjectBackground()` | Clear `storagePath` and `customLibraryId` from background settings |

Remove the `customRuntimeUrl` revocation in `loadProject` — `useMediaUrlStore.revokeAll()` handles this.

---

## Phase 5: Wire Up UI Components

### `webapp/src/editor/components/settings/BackgroundSettings.tsx`

- Replace `CustomBackgroundEntry` interface with `UserAsset`
- Replace `loadLibrary()` stub → call `UserAssetService.listAssets('background')`, resolve blob URLs for thumbnails via `BlobCache.getBlobUrl()`
- Replace `handleLibraryDelete` → call `UserAssetService.deleteAsset(id)`, reload library
- **Library limit enforcement**: Check `UserAssetService.canUpload('background')` before showing upload button. If at limit, disable the upload button and show a tooltip like "Library full (10/10) — delete an image to upload a new one"
- Update `handleUpload` and `handleLibrarySelect` to use `storagePath` instead of `customStorageUrl`/`customRuntimeUrl`:
  ```typescript
  updateSettings({
      background: {
          type: 'custom',
          imageUrl: undefined,
          storagePath: asset.storagePath,
          customLibraryId: asset.id,
      }
  });
  ```
- Update `getPreviewStyle()`: read blob URL from `useMediaUrlStore` by `background.storagePath` instead of `background.customRuntimeUrl`

### `webapp/src/editor/components/settings/AudioSettings.tsx`

- Replace `CustomMusicEntry` interface with `UserAsset`
- Replace `loadLibrary()` stub → call `UserAssetService.listAssets('music')`
- Replace `handleUpload` → call `UserAssetService.uploadAsset(file, 'music')`, then `updateSettings(...)` with `storagePath`
- Replace `handleCustomSelect` → resolve blob URL via `BlobCache.getBlobUrl()`, set in `useMediaUrlStore`
- Replace `handleLibraryDelete` → call `UserAssetService.deleteAsset(id)`
- **Library limit enforcement**: Check `UserAssetService.canUpload('music')` before allowing upload. If at limit, disable the upload button and show "Library full (10/10) — delete a track to upload a new one"
- Audio preview: use `BlobCache.getBlobUrl()` instead of `URL.createObjectURL(entry.blob)` (entries no longer carry blobs)
- Update `handlePresetSelect` / `handleCustomSelect`: use `storagePath` instead of `customStorageUrl`/`customRuntimeUrl`

### `webapp/src/editor/hooks/useBackgroundMusic.ts`

- Resolve music URL from `useMediaUrlStore` by `music.storagePath` (for custom) instead of reading `music.customRuntimeUrl`

---

## Phase 6: Cloud Save/Load

### Save: `webapp/src/storage/cloudProjectService.ts`

- `storagePath` on background/music settings is already part of `project_data` JSON — saved automatically, no column writes needed
- The existing `customRuntimeUrl` stripping logic (`key === 'customRuntimeUrl' ? undefined : value`) can be removed once `customRuntimeUrl` is deleted from the types
- Keep stripping any transient blob URLs that shouldn't be persisted (sanity check)

### Load: `webapp/src/storage/cloudProjectService.ts` — `loadProject()`

- The existing hydration block for custom background/music (lines 267-296) changes to:
  ```typescript
  // Hydrate custom asset blob URLs into useMediaUrlStore
  // (getProjectMediaPaths already includes background/music storagePaths,
  //  and hydrateMediaUrls handles them via BlobCache — may need no extra code)
  ```
- If `hydrateMediaUrls()` already iterates `getProjectMediaPaths()`, custom assets are hydrated automatically. Otherwise add background/music to `hydrateMediaUrls`.
- Remove the `recordio-blob://` guard (dead code path)

### Hash: `cloudProjectService.ts` — `projectDataHash()`

- Remove the `customRuntimeUrl` exclusion once the field is deleted from types

---

## Phase 7: Render Worker Support — Nearly Free

The storagePath standardization means most of the render pipeline works automatically:

### 7a. `getProjectMediaPaths()` (done in Phase 1c)

Background and music storagePaths are now returned by `getProjectMediaPaths()`.

### 7b. `render-start-job` edge function — No changes needed

Already uses `getProjectMediaPaths()` to generate signed URLs for all media. Custom background/music storagePaths are included automatically.

### 7c. `render-worker/src/downloadMedia.ts` — No changes needed

Already downloads all media from `Record<string, string>` (storagePath → signedUrl). Custom assets are just additional entries.

### 7d. `render-worker/render-page/main.ts` — Minor patch

The generic `mediaUrls` loop already maps all storagePaths to local HTTP URLs. But ExportManager reads `customRuntimeUrl` for background and music. Since we're removing `customRuntimeUrl` from the project JSON, the render page needs to populate the blob URL in the `env.mediaUrls` map (which ExportManager's environment already receives).

**Option A** (cleaner): Update ExportManager to resolve background/music URLs from `env.mediaUrls` by storagePath, same as it resolves screen/camera sources. Then no render page patching needed.

**Option B** (minimal): Before calling `exporter.exportProject()`, patch the project settings to set the local URL for ExportManager to find:
```typescript
// Patch custom background URL for ExportManager
const bgPath = project.settings?.background?.storagePath;
if (bgPath && mediaUrls[bgPath]) {
    project.settings.background.imageUrl = mediaUrls[bgPath];  // ExportManager reads imageUrl
}
// Patch custom music URL for ExportManager
const musicPath = project.settings?.audio?.music?.storagePath;
if (musicPath && mediaUrls[musicPath]) {
    project.settings.audio.music.presetUrl = mediaUrls[musicPath];  // reuse presetUrl field
    project.settings.audio.music.source = 'preset';  // so audioProcessor reads presetUrl
}
```

Recommend **Option A** — update ExportManager to look up from `env.mediaUrls` by storagePath. This keeps the export pipeline consistent: all media resolved the same way.

### 7e. ExportManager + audioProcessor updates (Option A)

**`shared/export/ExportManager.ts`** (line ~204):
```typescript
// Before:
const bgUrl = bgSettings.customRuntimeUrl || bgSettings.imageUrl;
// After:
const bgUrl = (bgSettings.storagePath && env?.mediaUrls?.[bgSettings.storagePath])
    || bgSettings.imageUrl;
```

**`shared/export/audioProcessor.ts`** (line ~124-126):
```typescript
// Before:
const musicUrl = audioSettings.music.source === 'preset'
    ? audioSettings.music.presetUrl
    : audioSettings.music.customRuntimeUrl;
// After:
const musicUrl = audioSettings.music.source === 'preset'
    ? audioSettings.music.presetUrl
    : (audioSettings.music.storagePath && env?.mediaUrls?.[audioSettings.music.storagePath])
      || undefined;
```

For the webapp (local export), `env.mediaUrls` would be populated from `useMediaUrlStore` with the blob URLs. For the render worker, `env.mediaUrls` already has local HTTP URLs.

### 7f. `render-worker/src/ServerAudioMixer.ts` — Same pattern

Update the `customRuntimeUrl` reference (line ~82) to use `env.mediaUrls[storagePath]` like audioProcessor.

---

## Phase 8: Webapp ExportManager Integration

When the webapp triggers a local export, it needs to pass `env.mediaUrls` with blob URLs for custom assets:

**`webapp/src/editor/export/ExportManager.ts`** (or wherever the local export env is built):
- Build `mediaUrls` from `useMediaUrlStore` state — already keyed by storagePath
- Pass as `env.mediaUrls` to `ExportManager.exportProject()`

This is likely already partially done for screen/camera/mic. Custom assets just need to be included.

---

## Verification Plan

1. **Upload flow**: Upload a background image → verify it appears in Supabase Storage under `{userId}/assets/` → verify `user_assets` row created with `status: 'ready'` → verify it appears in library UI
2. **Select flow**: Select uploaded background for a project → verify project renders with it → save → reload page → verify background persists (storagePath in project_data, blob re-downloaded via BlobCache)
3. **Multi-project**: Use same background in two projects → verify both work → delete asset from library → verify both projects still render (soft delete preserves blob)
4. **Music**: Same test flow for custom music uploads
5. **Library limits**: Upload 10 backgrounds → verify 11th is blocked by edge function → verify UI disables upload button and shows limit message → delete one → verify upload works again
6. **Crash recovery**: Get signed URL → kill tab before confirming → verify pending row is cleaned up by cron after 1 hour
7. **Cloud render**: Trigger server-side render for project with custom background/music → verify `getProjectMediaPaths()` includes them → verify render-start-job signs URLs → verify render worker downloads and uses them
8. **Export**: Local export with custom background/music → verify they appear in the exported video

---

## Files Summary

| Action | File |
|--------|------|
| Create | `webapp/supabase/migrations/<ts>_user_assets_soft_delete.sql` |
| Create | `webapp/supabase/functions/asset-upload-url/index.ts` |
| Create | `webapp/supabase/functions/asset-upload-url/.config.toml` |
| Create | `webapp/supabase/functions/asset-confirm-upload/index.ts` |
| Create | `webapp/supabase/functions/asset-confirm-upload/.config.toml` |
| Create | `webapp/supabase/sql/crons/cron_cleanup_pending_assets.sql` |
| Create | `webapp/src/storage/userAssetService.ts` |
| Modify | `shared/types/settings.ts` — remove `customStorageUrl`, `customRuntimeUrl` |
| Modify | `shared/utils/projectMedia.ts` — add background + music entries |
| Modify | `webapp/supabase/functions/_shared/projectMedia.ts` — Deno copy of above |
| Modify | `shared/export/ExportManager.ts` — resolve bg from `env.mediaUrls` |
| Modify | `shared/export/audioProcessor.ts` — resolve music from `env.mediaUrls` |
| Modify | `render-worker/src/ServerAudioMixer.ts` — same pattern |
| Modify | `webapp/src/editor/stores/useProjectStore.ts` |
| Modify | `webapp/src/editor/components/settings/BackgroundSettings.tsx` |
| Modify | `webapp/src/editor/components/settings/AudioSettings.tsx` |
| Modify | `webapp/src/editor/hooks/useBackgroundMusic.ts` |
| Modify | `webapp/src/storage/cloudProjectService.ts` — simplify hydration |
| Modify | `webapp/src/storage/cloudStorage.ts` — remove customRuntimeUrl stripping |

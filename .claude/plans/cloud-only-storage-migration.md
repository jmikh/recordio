# Cloud-Only Storage Migration — Eliminate IndexedDB

## Context

The webapp currently has a dual-master storage system: IndexedDB (local) + Supabase (cloud), bridged by a ~2,400-line sync layer (`localStorage.ts`, `syncService.ts`, `storageCleanup.ts`, `syncStatusStore.ts`). This creates enormous complexity — debounced sync, conflict resolution, orphan detection, merge logic, migration code — all to keep two sources of truth in agreement.

**Goal**: Make Supabase the sole source of truth. Eliminate IndexedDB entirely. Use the Cache API as a transparent, browser-managed blob cache. Auth is required for all flows.

**Key insight**: During recording import, blobs are already in memory. We upload to cloud AND cache in Cache API simultaneously. When the editor opens, cache hits are instant — no re-download needed.

---

## Architecture: Before → After

```
BEFORE:
  Extension → blobs → IndexedDB → editor (instant)
                    → cloud upload (background, 30s debounce)
  Editor load → IndexedDB project + blob hydration → runtimeUrl
  Dashboard → merge(local projects, cloud projects)
  Auto-save → IndexedDB (2s) → cloud (30s)

AFTER:
  Extension → blobs → cloud upload (blocking, with progress) + Cache API (parallel)
  Editor load → cloud metadata → BlobCache.getBlobUrl() (cache hit or download) → runtimeUrl
  Dashboard → CloudStorage.listProjectsSummary()
  Auto-save → cloud (2s debounce, direct)
```

---

## Files Deleted (~1,800 lines)

| File | Lines | Why |
|------|-------|-----|
| `webapp/src/storage/localStorage.ts` | 960 | Entire IndexedDB layer eliminated |
| `webapp/src/storage/syncService.ts` | 651 | Dual-master orchestration no longer needed |
| `webapp/src/storage/storageCleanup.ts` | 195 | Browser manages Cache API eviction automatically |

## Files Created (~450 lines)

| File | Est. Lines | Purpose |
|------|-----------|---------|
| `webapp/src/storage/blobCache.ts` | ~80 | Cache API wrapper for blob caching |
| `webapp/src/storage/cloudProjectService.ts` | ~250 | High-level project ops (replaces SyncService) |
| `webapp/src/storage/userAssetService.ts` | ~120 | Cloud backgrounds/music library (replaces IndexedDB stores) |

## Files Modified

| File | Scope | Changes |
|------|-------|---------|
| `shared/types/core.ts` | Minor | Update `storageUrl` JSDoc (cloud path, not `recordio-blob://`) |
| `webapp/src/editor/App.tsx` | Major | Rewrite project init: cloud fetch → BlobCache hydration |
| `webapp/src/editor/stores/useProjectStore.ts` | Major | Auto-save to cloud directly, rewrite bg/music actions |
| `webapp/src/pages/ImportPage.tsx` | Major | Auth gate, blocking upload with progress, remove local-only prompts |
| `webapp/src/pages/DashboardPage.tsx` | Medium | Cloud-only project list, remove cleanup/sync imports |
| `webapp/src/bridge/macBridge.ts` | Delete | Unused — delete entirely |
| `webapp/src/editor/components/settings/BackgroundSettings.tsx` | Medium | UserAssetService for library |
| `webapp/src/editor/components/settings/AudioSettings.tsx` | Medium | UserAssetService for library |
| `webapp/src/editor/components/canvas/CanvasContainer.tsx` | Small | Thumbnail upload to cloud |
| `webapp/src/editor/components/header/Header.tsx` | Small | Remove SyncService.flushPendingSync |
| `webapp/src/editor/components/ConflictModal.tsx` | Small | Use cloudProjectService |
| `webapp/src/storage/cloudStorage.ts` | Small | Minor helpers if needed |
| `webapp/src/storage/syncStatusStore.ts` | Small | Keep for upload/download progress UI, remove sync-specific fields |
| `webapp/src/storage/projectTransfer.ts` | Medium | Pull blobs from cloud/cache instead of IndexedDB |
| `webapp/src/hooks/useAuthListener.ts` | Small | Remove SyncService.onLogin/resumePendingUploads |

---

## Implementation Phases

### Phase 1: `blobCache.ts` — Cache API wrapper

**New file**: `webapp/src/storage/blobCache.ts`

```typescript
const CACHE_NAME = 'recordio-media-v1';

export class BlobCache {
  // Cache-or-download: check cache first, download from cloud on miss
  static async getBlob(storagePath: string, onProgress?): Promise<Blob>

  // Get a blob URL (cache-or-download → URL.createObjectURL)
  static async getBlobUrl(storagePath: string, onProgress?): Promise<string>

  // Write a blob to cache (used during import to avoid re-download)
  static async put(storagePath: string, blob: Blob): Promise<void>

  // Check cache hit
  static async has(storagePath: string): Promise<boolean>

  // Evict a single entry
  static async evict(storagePath: string): Promise<void>
}
```

Cache key convention: synthetic URL `/_media/{storagePath}` (never fetched over network — just a stable key).

`getBlob()` flow:
1. `caches.open(CACHE_NAME)` → `cache.match(cacheKey)`
2. Hit → `response.blob()` → return
3. Miss → `CloudStorage.downloadMediaFile(storagePath)` → `cache.put(cacheKey, new Response(blob))` → return blob

No dependencies on other new files. Testable in isolation.

---

### Phase 2: `cloudProjectService.ts` — replaces SyncService

**New file**: `webapp/src/storage/cloudProjectService.ts`

Thin orchestration over `CloudStorage` + `BlobCache`. Replaces the 651-line `SyncService`.

```typescript
export class CloudProjectService {
  // In-memory version tracking (replaces syncMeta IndexedDB store)
  private static cloudVersions = new Map<string, number>();

  // --- Import ---
  // Upload blobs to cloud + cache simultaneously, save metadata, return hydrated project
  static async importRecording(
    recording: RawRecording,
    screenBlob: Blob, userId: string, isPro: boolean,
    onProgress?: (phase: string, fraction: number) => void,
    cameraBlob?: Blob, micBlob?: Blob,
  ): Promise<Project>

  // --- Load ---
  // Load project from cloud, hydrate blob URLs from cache (download on miss)
  static async loadProject(
    projectId: string,
    onProgress?: (status: string) => void,
  ): Promise<Project>

  // --- Save ---
  // Save project metadata to cloud with optimistic concurrency
  static async saveProject(project: Project, userId: string, isPro: boolean): Promise<void>

  // --- List ---
  // List projects from cloud (sole source)
  static async listProjects(): Promise<ProjectListItem[]>

  // --- Delete ---
  static async deleteProject(projectId: string): Promise<void>

  // --- Conflict Resolution ---
  static async resolveConflictReload(projectId: string): Promise<Project>
  static async resolveConflictForce(project: Project, userId: string, isPro: boolean): Promise<void>

  // --- Thumbnails ---
  static async uploadThumbnail(projectId: string, blob: Blob): Promise<void>
}
```

**`importRecording` flow** (the critical path):
1. Build project metadata with `storageUrl` = cloud path (`{userId}/{projectId}/screen.webm`)
2. Upload metadata to cloud: `CloudStorage.saveProjectMetadata()` → get `cloudVersion`
3. For each blob (screen, camera, mic), **in parallel**:
   - `CloudStorage.uploadMediaFile()` with progress callback
   - `BlobCache.put(storagePath, blob)` — cache locally for instant editor access
4. Create `runtimeUrl` = `URL.createObjectURL(blob)` from the in-memory blob
5. Store `cloudVersion` in the in-memory map
6. Return hydrated project (ready for editor, no re-download needed)

**`loadProject` flow**:
1. `CloudStorage.loadProjectMetadata(projectId)` → project_data + storage paths
2. `migrateProject(project_data)` — apply schema migrations
3. For each source (`screen_storage_path`, `camera_storage_path`, `mic_storage_path`):
   - `BlobCache.getBlobUrl(storagePath, onProgress)` → sets `runtimeUrl`
   - Cache hit = instant, cache miss = download from cloud with progress
4. Same for `customStorageUrl` (background/music) if present
5. Store `cloudVersion` in memory
6. Return hydrated project

**`saveProject` flow** (auto-save):
1. Strip runtimeUrls (reuse existing `CloudStorage.stripForCloud()`)
2. **Hash project data, skip if unchanged** — reuse existing SHA-256 hash logic from `SyncService.projectDataHash()`. Store last-saved hash in memory. Only call `CloudStorage.saveProjectMetadata()` when the hash differs. This prevents unnecessary `cloud_version` bumps, which are used downstream to avoid redundant re-renders.
3. If changed: `CloudStorage.saveProjectMetadata(project, userId, expectedVersion, isPro)`
4. Update in-memory `cloudVersion` + `projectHash`

---

### Phase 3: `userAssetService.ts` — cloud backgrounds/music library

**New file**: `webapp/src/storage/userAssetService.ts`

Uses the existing `user_assets` table (already has RLS):
```sql
CREATE TABLE public.user_assets (
    id TEXT NOT NULL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    asset_type TEXT NOT NULL,  -- 'background' | 'music'
    storage_path TEXT NOT NULL,
    name TEXT,
    size_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```typescript
export class UserAssetService {
  static async uploadBackground(blob: Blob, userId: string): Promise<{ id: string; storagePath: string }>
  static async uploadMusic(blob: Blob, name: string, userId: string): Promise<{ id: string; storagePath: string }>
  static async listBackgrounds(): Promise<UserAssetEntry[]>
  static async listMusic(): Promise<UserAssetEntry[]>
  static async deleteAsset(id: string): Promise<void>
  static async getAssetBlobUrl(storagePath: string): Promise<string>  // via BlobCache
}
```

Storage path convention: `{userId}/assets/backgrounds/{assetId}.webp`, `{userId}/assets/music/{assetId}.mp3`

When user selects a background/music for a project, the project's `customStorageUrl` points directly to the asset's cloud path. No blob copying needed (today it copies the blob from library to project-scoped IndexedDB — that goes away).

---

### Phase 4: `storageUrl` semantics change

**File**: `shared/types/core.ts` line 45

Update `storageUrl` from `recordio-blob://{blobId}` to cloud storage path:
```typescript
/** Cloud storage path (e.g., "{userId}/{projectId}/screen.webm"). */
storageUrl: string;
```

The `runtimeUrl` field stays unchanged — still a transient `blob:` URL created via `URL.createObjectURL()` from cached/downloaded blobs.

**Migration**: Add a step in `migrateProject()` (`webapp/src/core/migrateProject.ts`) that handles old `recordio-blob://` URLs if any exist in cloud `project_data`. These can be rewritten to the known cloud path using the pattern `{userId}/{projectId}/{type}.webm`. In practice, all cloud projects should already have `*_storage_path` columns set, so the migration reads from the cloud row.

---

### Phase 5: Rewrite ImportPage

**File**: `webapp/src/pages/ImportPage.tsx`

Major simplification — auth required, no local-only prompts.

**Remove**:
- `existingProjectsPrompt` state + modal (no local projects)
- `syncPromptProjectId` state + "Continue Locally" modal
- `handleStartFresh` (no local projects to delete)
- `cleanupStorageIfNeeded()` call
- `LocalStorage.loadProjectRaw()` check for existing project
- `LocalStorage.listProjects()` / `listSyncMeta()` for unsynced project detection

**Add**:
- Auth gate: if not authenticated, show mandatory login modal before starting import
- Upload progress UI: show phase ("Uploading screen recording...") + progress bar during `CloudProjectService.importRecording()`
- "Do not close this tab" warning during upload

**New flow**:
1. Check auth → show login modal if needed
2. Receive blobs from extension via `useExtensionBridge`
3. Call `CloudProjectService.importRecording(recording, screenBlob, userId, isPro, onProgress, cameraBlob, micBlob)`
4. Navigate to editor on success (blobs are already cached)

---

### Phase 6: Rewrite editor init (`App.tsx`)

**File**: `webapp/src/editor/App.tsx` lines 177-314

Replace the complex local-then-cloud-then-download-then-rehydrate dance with:

```typescript
async function init() {
  if (!projectId) { navigate('/'); return; }
  if (!isAuthed) { navigate('/'); return; } // Auth required

  setLoadingStatus('Loading project...');
  const project = await CloudProjectService.loadProject(projectId, setLoadingStatus);

  if (!project) { navigate('/?error=Project not found'); return; }

  loadProject(project);
  setIsLoading(false);

  CloudStorage.updateLastAccessed(projectId).catch(console.error);
}
```

**Remove**:
- `LocalStorage.loadProject()` call
- `LocalStorage.saveProject()` / `saveSyncMeta()` calls
- IndexedDB-to-cloud version comparison logic
- `SyncService.downloadProjectMedia()` call
- `LocalStorage.touchSyncMetaAccess()` call
- `SyncService.initProjectHash()` / `resumePendingUploads()` calls

The version check + conflict detection moves inside `CloudProjectService.loadProject()` or stays in-memory.

---

### Phase 7: Rewrite auto-save (`useProjectStore.ts`)

**File**: `webapp/src/editor/stores/useProjectStore.ts` lines 235-258

Replace:
```typescript
SyncService.saveProject(fullProject, userId, isPro)
```
With:
```typescript
CloudProjectService.saveProject(fullProject, userId, isPro)
```

Keep the 2s debounce. The 30s cloud debounce inside SyncService is eliminated (it existed because local writes were "free" and cloud writes were expensive — now there's only one write path).

Also rewrite in the same file:
- `uploadAndSelectBackground` (lines 153-171): Use `UserAssetService.uploadBackground()` + set `customStorageUrl` to cloud path
- `selectBackgroundFromLibrary` (lines 173-193): No blob copy needed — just point `customStorageUrl` to the asset's cloud path, get `runtimeUrl` from `BlobCache.getBlobUrl()`
- `clearProjectBackground` (lines 195-204): Remove `LocalStorage.deleteRecordingBlob()` — just clear the setting
- `saveProject` action (lines 142-150): Remove `LocalStorage.saveProject()` — auto-save handles everything

---

### Phase 8: Rewrite settings panels

**BackgroundSettings.tsx**:
- Replace `LocalStorage.listCustomBackgrounds()` → `UserAssetService.listBackgrounds()`
- Replace `LocalStorage.saveCustomBackground(blob)` → `UserAssetService.uploadBackground(blob, userId)`
- Replace `LocalStorage.deleteCustomBackground(id)` → `UserAssetService.deleteAsset(id)`
- Library entries: get display URLs via `UserAssetService.getAssetBlobUrl(storagePath)`

**AudioSettings.tsx**:
- Same pattern: replace all `LocalStorage.listCustomMusic/saveCustomMusic/deleteCustomMusic` with `UserAssetService` equivalents

---

### Phase 9: Mac bridge cleanup

**Delete** `webapp/src/bridge/macBridge.ts` — unused, remove all imports.
**Delete** `webapp/src/pages/MacHandoffPage.tsx` — remove from router in `App.tsx`.

---

### Phase 10: Thumbnails

**CanvasContainer.tsx** line 332:
- Replace `LocalStorage.saveThumbnail(project.id, blob)` with `CloudProjectService.uploadThumbnail(project.id, blob)`
- Thumbnail upload is already debounced (only captures on specific conditions) — keep that logic

**Dashboard thumbnail display**:
- `ProjectListItem` already has cloud `thumbnail_storage_path`
- Display via `BlobCache.getBlobUrl(thumbnailPath)` or signed URL

---

### Phase 11: Remaining consumers

**Header.tsx**: Remove `SyncService.flushPendingSync()` — no pending local syncs to flush. Auto-save writes directly to cloud.

**ConflictModal.tsx**: Replace `SyncService.resolveConflictReload/Force` with `CloudProjectService` equivalents.

**projectTransfer.ts** (zip export/import):
- Export: `BlobCache.getBlob(storagePath)` instead of `LocalStorage.getRecordingBlob()`
- Import: `CloudProjectService.importRecording()` equivalent for zip data. Requires auth.

**useAuthListener.ts**: Remove `SyncService.onLogin()`, `resumePendingUploads()`, `backfillThumbnails()`. No local projects to sync on login.

**DashboardPage.tsx**: Replace `SyncService.listProjects(userId)` with `CloudProjectService.listProjects()`. Remove `cleanupStorageIfNeeded()` import.

---

### Phase 12: Delete old files + cleanup

1. Delete `webapp/src/storage/localStorage.ts`
2. Delete `webapp/src/storage/syncService.ts`
3. Delete `webapp/src/storage/storageCleanup.ts`
4. Grep entire codebase for stale references: `LocalStorage`, `SyncService`, `importFromRawRecording`, `recordio-blob://`, `syncMeta`, `cloudSynced`, `IndexedDB`
5. Remove dead imports, dead types (`SyncMeta`, `CustomBackgroundEntry`, `CustomMusicEntry` from localStorage)
6. Simplify `syncStatusStore.ts` — remove sync-specific fields (`conflict`, `pendingNavigation`), keep upload/download progress

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| **Tab closed during import upload** | Blobs lost. Extension still has originals — user can re-import. Show "do not close" warning. |
| **Slow network on auto-save** | Keep "save in progress" flag to skip overlapping saves. Same debounce pattern as today. |
| **Cache API eviction** | Browser evicts old entries under storage pressure. On cache miss, `BlobCache.getBlob()` re-downloads from cloud. Transparent to the user. |
| **Large recordings (1-2 GB)** | TUS resumable upload already handles this with 6MB chunks + retry. No change to `CloudStorage.uploadBlobTus()`. |
| **Existing local-only projects** | Acceptable to lose. No migration flow needed. |
| **Render worker** | Unchanged. Already uses signed URLs, zero IndexedDB dependency. |

---

## Verification

1. **Recording import**: Record in extension → ImportPage shows upload progress → editor opens with playback working → no re-download on page refresh (cache hit)
2. **Project list**: Dashboard shows only cloud projects, thumbnails load
3. **Auto-save**: Edit project → wait 2s → reload page → changes persisted
4. **Custom backgrounds**: Upload background → appears in library → select for project → persists across reload
5. **Custom music**: Same as backgrounds
6. **Export/import zip**: Export project → import on different account → plays back correctly
7. **Conflict resolution**: Open same project in two tabs, edit both → conflict modal appears → both resolution paths work
8. **Cache eviction**: Clear browser cache → reopen project → downloads from cloud, plays back
9. **Mac bridge**: Record in Mac app → handoff succeeds → editor opens
10. **No IndexedDB**: Open DevTools → Application → IndexedDB → no `recordio-editor` database created

---

## TODO: Custom Backgrounds & Music Cloud Sync

Custom backgrounds and music are currently **local-only** (IndexedDB `customBackgrounds` and `customMusic` stores). They are not synced to cloud at all today. The `user_assets` table exists in the schema and is ready for use, but the full design for cloud-syncing these assets needs to be figured out:

- How should the library UI handle upload latency? (backgrounds are small, music can be large)
- Should assets be shared across projects or per-project?
- How does the asset library interact with the storage quota?
- Should there be a limit on number of custom assets?
- What happens to assets when a project referencing them is deleted?

**For now**: Phase 3 (`userAssetService.ts`) and Phase 8 (settings panels) define the target API shape, but the exact UX and edge cases need further design before implementation.

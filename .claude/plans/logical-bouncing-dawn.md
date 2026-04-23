# Server-Side Project Storage Plan

## Context

Projects are currently stored entirely in IndexedDB (browser-local). "Clear browsing data" permanently destroys all work. The goal is to introduce cloud-backed project storage via Supabase so that authenticated users' projects are durable, accessible from any device, and survive browser data clears. IndexedDB becomes a cache layer.

**Key constraints:**
- **Unauthenticated:** one local project max. No dashboard/library. New recording presents choice: "Sign in to keep both" or "Overwrite."
- **Authenticated (all tiers):** cloud sync enabled. Full library. IndexedDB caches locally with cloud project IDs. Background media download prioritizes recently-accessed projects.
- **Pro/Trial:** cloud data persists indefinitely (no expiration).
- **Not Pro (free/expired):** cloud data has a **14-day expiry from first upload**. After 14 days the data is cleaned up. Re-subscribing to Pro clears the expiry (data persists).
- **Media is immutable** after recording — upload once, cache locally. Only project settings change over time.
- **Published videos are part of the project**, not separate entities. Deleting a project deletes its published video. No separate "Published" tab.
- **Storage quota is per-user** in the database (default 25 GB), not hardcoded.

---

## 1. Database Schema

### 1.1 New table: `projects`

```sql
CREATE TABLE public.projects (
    id TEXT NOT NULL,                        -- client-side ID e.g. "proj-abc123"
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Untitled',
    schema_version INT NOT NULL DEFAULT 3,

    -- Full project JSON (settings, timeline, userEvents, source metadata — no blobs)
    project_data JSONB NOT NULL,

    -- Media storage paths in Supabase Storage bucket
    -- NULL = media doesn't exist for this project (e.g. no camera recorded)
    -- 'pending' = media exists locally but hasn't uploaded yet
    -- actual path = uploaded to cloud
    screen_storage_path TEXT,
    camera_storage_path TEXT,
    mic_storage_path TEXT,
    thumbnail_storage_path TEXT,

    -- Byte sizes of uploaded media (for quota tracking)
    screen_size_bytes BIGINT DEFAULT 0,
    camera_size_bytes BIGINT DEFAULT 0,
    mic_size_bytes BIGINT DEFAULT 0,

    -- Upload tracking
    upload_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'ready'

    -- Published video (replaces old shared_videos table)
    cf_video_uid TEXT,                       -- Cloudflare Stream UID (null = not published)
    published_at TIMESTAMPTZ,
    share_description TEXT DEFAULT '',

    -- Sync
    cloud_version INT NOT NULL DEFAULT 1,    -- incremented on every cloud write
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- last time user opened this project
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,                  -- soft delete
    expires_at TIMESTAMPTZ,                  -- set when user loses Pro (NOW() + 14 days), null when Pro

    PRIMARY KEY (id, user_id)
);

CREATE INDEX idx_projects_user_updated ON public.projects(user_id, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_user_accessed ON public.projects(user_id, last_accessed_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_expires ON public.projects(expires_at)
    WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects"
    ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own projects"
    ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own projects"
    ON public.projects FOR UPDATE USING (auth.uid() = user_id);
```

**Design notes:**
- `project_data JSONB` stores the full Project object (same structure as IndexedDB). JSONB avoids schema migrations when project settings change.
- Composite PK `(id, user_id)` prevents cross-user collision on client-generated IDs.
- `last_accessed_at` drives the background download priority queue.
- `expires_at` — expiration logic depends on user's subscription status:
  - **Non-Pro user uploads a project:** `expires_at = created_at + 14 days` (set at creation time)
  - **Pro user uploads a project:** `expires_at = NULL` (no expiration)
  - **User loses Pro:** `expires_at = NOW() + 14 days` set on all their projects
  - **User becomes Pro:** `expires_at = NULL` set on all their projects (clears countdown)
  - Cron job soft-deletes projects past their `expires_at`.
- `upload_status` tracks media upload progress:
  - `'pending'` on creation (some media still needs to upload)
  - `'ready'` when all media is uploaded (all non-NULL paths have real storage paths, no `'pending'` values remain)
  - On app reload, SyncService checks for projects where `upload_status != 'ready'` and resumes uploads.
- Storage path sentinel values: `NULL` means the media type doesn't exist (e.g. no camera was recorded). `'pending'` means it exists locally but hasn't uploaded. This distinguishes "no camera" from "camera not yet uploaded."
- `deleted_at` soft delete — actual Storage file cleanup handled by an edge function.

### 1.2 New table: `user_assets`

For global custom backgrounds and music libraries:

```sql
CREATE TABLE public.user_assets (
    id TEXT NOT NULL PRIMARY KEY,            -- client ID e.g. "bg-uuid" or "music-uuid"
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL,                -- 'background' | 'music'
    storage_path TEXT NOT NULL,
    name TEXT,                               -- display name (music files)
    size_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_assets_user ON public.user_assets(user_id, asset_type);
ALTER TABLE public.user_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own assets"
    ON public.user_assets USING (auth.uid() = user_id);
```

### 1.3 New table: `user_quotas`

Separate from subscriptions (which is a Stripe billing concern). Extensible for future limits.

```sql
CREATE TABLE public.user_quotas (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_limit_bytes BIGINT NOT NULL DEFAULT 26843545600  -- 25 GB default
);

ALTER TABLE public.user_quotas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own quotas"
    ON public.user_quotas FOR SELECT USING (auth.uid() = user_id);
```

Auto-created via the existing `handle_new_user()` trigger. Configurable per-user by support. Future columns: `max_projects`, `max_published_videos`, etc.

### 1.4 Storage quota function

```sql
CREATE OR REPLACE FUNCTION public.get_user_storage_bytes(p_user_id UUID)
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$
    SELECT COALESCE(SUM(screen_size_bytes + camera_size_bytes + mic_size_bytes), 0)
    FROM public.projects
    WHERE user_id = p_user_id AND deleted_at IS NULL;
$$;
```

### 1.5 Cloud data expiration

Per-project `expires_at` column. Lifecycle:
- **Non-Pro user creates a project:** `expires_at = NOW() + INTERVAL '14 days'` (set at creation time — 14-day free cloud storage)
- **Pro user creates a project:** `expires_at = NULL` (no expiration)
- **User loses Pro** (Stripe webhook sets status to `expired`/`canceled`): set `expires_at = NOW() + INTERVAL '14 days'` on all their projects
- **User becomes Pro** (Stripe webhook sets status to `active`): set `expires_at = NULL` on all their projects (cancel countdowns)
- **Cron job:** daily, soft-deletes projects past their `expires_at`

```sql
-- Called from Stripe webhook handler when subscription status changes
CREATE OR REPLACE FUNCTION public.set_project_expiry(p_user_id UUID, p_expires_at TIMESTAMPTZ)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    UPDATE public.projects
    SET expires_at = p_expires_at
    WHERE user_id = p_user_id AND deleted_at IS NULL;
$$;

-- Cron job: runs daily, soft-deletes expired projects
CREATE OR REPLACE FUNCTION public.cleanup_expired_projects() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE public.projects
    SET deleted_at = NOW()
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW()
      AND deleted_at IS NULL;
END;
$$;
```

A separate edge function handles the actual Supabase Storage file deletion + Cloudflare Stream cleanup for soft-deleted projects.

### 1.6 Published videos on `projects` table

Published video fields are added directly to the `projects` table (`cf_video_uid`, `published_at`, `share_description`). The old `shared_videos` and `deleted_videos` tables are **kept in place for now** to avoid breaking production — they will be dropped in a future cleanup once the new flow is fully rolled out.

ShareService is rewired to read/write the new columns on `projects` instead of `shared_videos`.

**UI changes:**
- Remove the separate "Published" tab from the dashboard.
- Show a "Published" badge on project cards with publish/unpublish in the context menu.
- ShareService rewired to read/write `cf_video_uid` + `published_at` on the `projects` row instead of `shared_videos`.

---

## 2. Supabase Storage Bucket

Single bucket: `project-media`

```
project-media/
  {user_id}/
    {project_id}/
      screen.webm
      camera.webm
      mic.wav
      thumbnail.webp         ← small: max 400px wide, WebP ~80%, <50KB
    assets/
      bg-{uuid}.png
      music-{uuid}.mp3
```

### 2.1 Access model: signed URLs via backend (enterprise-ready)

Rather than giving the webapp direct write access to Storage (which would require exposing RLS policies to the client), all uploads and downloads go through **signed URLs generated by the backend**:

1. **Client requests a signed upload URL** from the backend (sends project_id, file type, size)
2. **Backend validates:** auth, subscription status, quota check
3. **Backend generates** a short-lived signed URL for Supabase Storage
4. **Client uploads directly** to Storage using the signed URL (no double-hop through backend)
5. Same pattern for downloads: backend generates signed download URL, client fetches directly

This means:
- No RLS policies needed on storage.objects for client-side access
- Backend controls all authorization (enterprise-ready, auditable)
- No bandwidth penalty (client uploads/downloads directly to S3)
- The existing `backend/` Fastify server gets new routes for URL signing

```sql
-- Bucket creation (no client-side RLS — access is via signed URLs from backend)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-media', 'project-media', false, 5368709120,
    ARRAY['video/webm','video/mp4','audio/wav','audio/webm','audio/mpeg',
          'image/png','image/jpeg','image/webp','image/avif']);
```

New backend routes:
- `POST /storage/upload-url` — returns signed upload URL after auth + quota validation
- `POST /storage/download-url` — returns signed download URL after auth validation
- `POST /storage/confirm-upload` — updates projects table with storage path + size after upload completes

### 2.2 Global assets: duplication model

Global assets (custom backgrounds, music) are stored in `{user_id}/assets/` as the user's reusable library (`user_assets` table). When a user applies a custom background or music to a project, the file is **duplicated** into that project's storage folder (`{user_id}/{project_id}/`). Each project is self-contained.

- **Deleting from global library** does not affect any project — projects have their own copy.
- **Adding to global library** does not touch existing projects.
- **UI deduplication:** when a global asset is duplicated into a project, the project's copy stores a `sourceAssetId` (the global library asset it was copied from). The UI checks this to avoid showing the same asset twice — if a project's asset matches a global library asset by `sourceAssetId`, show it once (as "from library"). If the global asset is later deleted, the project's copy remains and `sourceAssetId` becomes a dangling reference (harmless — just means it no longer deduplicates).
- Trade-off: more storage usage per user, but clean UX — users manage their library freely without worrying about breaking projects.

### 2.3 Thumbnails: small and fast

Thumbnails are resized before upload:
- Max width: 400px (aspect ratio preserved)
- Format: WebP, ~80% quality (~30% smaller than JPEG at equivalent quality)
- Target size: <50KB per thumbnail
- This ensures the project list loads instantly — all thumbnails in a single fast batch

---

## 3. Sync Architecture

### 3.1 New files

| File | Purpose |
|------|---------|
| `webapp/src/storage/cloudStorage.ts` | Client-side: projects table CRUD + signed URL requests for media |
| `webapp/src/storage/syncService.ts` | Orchestration: coordinates IndexedDB ↔ cloud, manages upload/download queues |
| `webapp/src/storage/syncStatusStore.ts` | Zustand store exposing sync state to UI (upload progress, sync status) |
| `webapp/supabase/migrations/YYYYMMDD_create_projects_table.sql` | DB migration |
| `webapp/supabase/functions/cleanup-expired-projects/index.ts` | Edge function: Storage file + CF Stream cleanup for soft-deleted projects |
| `backend/src/routes/storage.ts` | Backend routes: signed URL generation for uploads/downloads, quota enforcement |

### 3.2 cloudStorage.ts — key methods

```typescript
class CloudStorage {
    // Metadata (direct Supabase client — RLS-protected)
    saveProjectMetadata(project: Project, userId: string): Promise<{ cloudVersion: number }>
    loadProjectMetadata(projectId: string): Promise<CloudProject | null>
    listProjectsSummary(): Promise<{ id, name, thumbnail_storage_path, last_accessed_at, updated_at, expires_at, upload_status, cf_video_uid }[]>
    softDeleteProject(projectId: string): Promise<void>
    updateLastAccessed(projectId: string): Promise<void>

    // Publishing (direct on projects table — no shared_videos)
    publishVideo(projectId: string, cfVideoUid: string): Promise<void>
    unpublishVideo(projectId: string): Promise<void>

    // Media (via backend signed URLs — no direct Storage access from client)
    requestUploadUrl(projectId: string, type: 'screen'|'camera'|'mic'|'thumbnail', sizeBytes: number): Promise<{ signedUrl: string }>
    requestDownloadUrl(storagePath: string): Promise<{ signedUrl: string }>
    confirmUpload(projectId: string, type: string, sizeBytes: number): Promise<void>
    uploadBlob(signedUrl: string, blob: Blob, onProgress?: (frac: number) => void): Promise<void>
    downloadBlob(signedUrl: string): Promise<Blob>

    // Quota (via backend)
    getStorageUsage(): Promise<{ usedBytes: number; limitBytes: number }>
}
```

### 3.3 syncService.ts — core orchestration

```typescript
interface SyncState {
    status: 'idle' | 'syncing' | 'error' | 'offline';
    lastSyncedAt: Date | null;
    pendingMediaUploads: number;
    currentUpload: { projectId: string; type: string; progress: number } | null;
    currentDownload: { projectId: string; type: string; progress: number } | null;
}

class SyncService {
    // Called by auto-save (replaces direct ProjectStorage call)
    saveProject(project: Project): Promise<void>

    // Called when opening a project — handles cloud download if media not cached
    loadProject(projectId: string): Promise<Project>

    // Called on dashboard — returns merged project list (local + cloud)
    listProjects(): Promise<ProjectListItem[]>

    // Called after recording import — uploads metadata + queues media uploads
    onProjectCreated(project: Project, blobs: { screen: Blob; camera?: Blob; mic?: Blob }): Promise<void>

    // Called on login — syncs cloud project list, starts background media downloads
    onLogin(userId: string): Promise<void>

    // Delete (local + cloud soft delete + cascade published video)
    deleteProject(projectId: string): Promise<void>

    // Prioritize downloading media for a specific project
    prioritizeProject(projectId: string): void

    // State observable
    subscribe(listener: (state: SyncState) => void): () => void
}
```

### 3.4 How project creation + file sync works

When a new recording is imported:

1. **Blobs saved to IndexedDB** (existing behavior — instant, user can start editing immediately)
2. **Project metadata uploaded to `projects` table** with `upload_status = 'pending'`. Storage paths set to `'pending'` for media that exists, `NULL` for media that doesn't (e.g. no camera).
3. **Media blobs queued for background upload:**
   - Request signed upload URL from backend (validates auth + quota)
   - Upload directly to Supabase Storage using signed URL
   - For files >100MB: use resumable tus upload
   - Upload screen video (largest, can be 5GB), camera (if present), mic (if present)
   - Upload thumbnail (resized to <50KB WebP first)
4. **On each upload completion:** call backend `confirm-upload` to update `projects` row — replace `'pending'` with actual `*_storage_path` and set `*_size_bytes`
5. **When all uploads complete:** set `upload_status = 'ready'`
6. **Upload continues even if user navigates away** from import page (runs in SyncService singleton)
7. **If app closes mid-upload:** on next load, SyncService finds projects where `upload_status != 'ready'` and resumes uploads for any paths still set to `'pending'`

The user doesn't wait for uploads — they edit immediately against local IndexedDB blobs. Cloud upload is fully background.

### 3.5 How project settings sync works

Project settings (timeline, zoom, spotlight, captions, etc.) change frequently during editing. Sync protocol:

1. **Auto-save to IndexedDB** — existing 2s debounce (unchanged)
2. **Auto-sync to cloud** — on the same debounce trigger, upsert `project_data` JSONB in the `projects` table with `cloud_version + 1`
3. **This is cheap** — a few KB of JSON, no media. Supabase handles it in <100ms.
4. If the 2s debounce feels too aggressive for cloud writes, we can extend to 10-20s for the cloud leg only while keeping the IndexedDB leg at 2s. Start with matching debounce and observe.

**Conflict resolution:** Last-write-wins with `cloud_version`. On conflict (another device wrote higher version), show toast and pull cloud version. Multi-device simultaneous editing is not a real scenario for a video editor.

### 3.6 How project loading works on new device / cleared cache

When a logged-in user opens the dashboard:

1. **Fetch project list from cloud:** `listProjectsSummary()` returns id, name, thumbnail path, last_accessed_at, upload_status, cf_video_uid
2. **Check what's in local IndexedDB:** compare cloud list with local projects (matched by project ID + userId)
3. **For each cloud project:**
   - If locally cached (blobs in IndexedDB) → show from cache (fast)
   - If not cached → show with cloud thumbnail (downloaded from Storage) and name
4. **Background media download:** only download blobs for the **5 most recently accessed** projects (ordered by `last_accessed_at` DESC). Older projects show in the list but their media is fetched on demand.
5. **If user opens a project:** `SyncService.prioritizeProject(projectId)` bumps it to the front of the download queue. If media isn't cached yet, show a "Loading project..." screen with progress bar.

### 3.7 IndexedDB local identity + cloud tracking

Once a project is synced to the cloud, the local IndexedDB `syncMeta` store tracks:
- `userId` — which user owns this cloud project
- `cloudId` — the project ID in the `projects` table (same as local `id`)
- `cloud_version`, `last_synced_at`, upload status

**Unauthenticated filtering:** When a user is logged out, only show local projects that have **no `userId`** set (truly local, never-synced). Projects with a `userId` are hidden — they belong to a cloud account. This prevents unauthenticated users from seeing or overwriting cloud-synced projects.

When the user logs back in, their cached projects (filtered by matching `userId`) reappear.

### 3.8 IndexedDB blob cache management (LRU eviction)

IndexedDB stores media blobs as a cache. To prevent unbounded growth (which could cause issues for other sites sharing the browser's storage):

- **LRU limit: keep blobs for the last 5 accessed projects only.** When a new project's blobs are downloaded/saved, evict blobs for the oldest cloud-synced project beyond the 5-project window. These can be re-downloaded from cloud on demand.
- **Never evict blobs for projects that haven't been synced to cloud** (no cloud backup = local-only, losing them would be data loss).
- **On `QuotaExceededError`:** catch the error on any IndexedDB write. Show a toast: "Local storage is full. Freeing space..." Then evict the oldest cached cloud-synced blobs. If eviction isn't sufficient (e.g. single recording is too large): show error "Not enough local storage. Free up browser storage or sign in to save to the cloud."
- **For unauthenticated users** with no cloud backup: never auto-evict. Warn: "Storage is full. Sign in to save your project to the cloud, or delete your existing project."

### 3.9 URL scheme

Keep the existing `recordio-blob://` prefix. When a cloud project's media is downloaded, it's saved to IndexedDB with a `recordio-blob://` URL like any local project. The `storageUrl` in the project always points to local IndexedDB. The cloud `*_storage_path` columns are the cloud-side references — they're separate from the project JSON.

This means **no changes to the hydration logic** in `projectStorage.ts:loadProject()`. The only new path is: if a blob is missing from IndexedDB but the project has a cloud storage path → download from cloud → save to IndexedDB → then hydrate normally.

---

## 4. Modified Files

### 4.1 `webapp/src/storage/projectStorage.ts`
- Bump `DB_VERSION` to 6, add `syncMeta` object store (tracks: userId, cloudId, cloud_version, upload status, last_synced_at per project)
- Add `hasRecordingBlob(id): Promise<boolean>` — check existence without loading the blob
- Add methods to read/write sync metadata
- Add LRU blob eviction: `evictOldestCachedBlobs(keepCount: number)` — deletes blobs for cloud-synced projects beyond the keep window
- No changes to hydration logic (storageUrl stays `recordio-blob://`)

### 4.2 `webapp/src/editor/stores/useProjectStore.ts`
- Auto-save subscriber: replace `ProjectStorage.saveProject(fullProject)` with `SyncService.saveProject(fullProject)`
- SyncService internally calls `ProjectStorage.saveProject()` first (same fast local path), then queues cloud sync if user has pro

### 4.3 `webapp/src/pages/DashboardPage.tsx` (major rewrite)
- **Unauthenticated / no pro:** No dashboard grid. Show either:
  - Last local project as a single card → clicking opens editor
  - Or empty state: "Start recording with the extension"
  - Sign-in CTA: "Sign in to save your projects to the cloud"
- **Authenticated + pro:** Full library grid from `SyncService.listProjects()`. Sync status indicator. Cloud storage usage. No separate "Published" tab — published state shown as badge on project cards.
- **Expired pro (within 2-week grace):** Library visible with countdown banner: "Your projects will be removed from the cloud in X days. Re-subscribe to keep them." Read-only access to locally cached projects.
- **Remove the "Published" tab entirely.** Published state becomes a property on the project card (badge + context menu actions).

### 4.4 `webapp/src/pages/ImportPage.tsx`
- After `importFromRawRecording`, call `SyncService.onProjectCreated()` to upload metadata + queue media
- **Unauthenticated with existing local project:** Show choice dialog:
  - "Sign in to keep both projects" → auth flow → both sync to cloud
  - "Overwrite existing project" → delete old, save new
- **Unauthenticated with no existing project:** Just save and proceed (no dialog)

### 4.5 `webapp/src/editor/stores/useUserStore.ts`
- Add `isExpiredPro(): boolean` — authenticated but no pro access (was previously Pro)

### 4.6 `webapp/src/editor/App.tsx`
- On project load, if authenticated: update `last_accessed_at` in cloud
- On project load, if authenticated: check cloud for newer `cloud_version`, pull if newer
- If project has `expires_at`: show countdown banner ("X days until this project is removed from cloud. Upgrade to Pro.")

### 4.7 `webapp/src/editor/services/ShareService.ts`
- Rewire to read/write `cf_video_uid`, `published_at`, `share_description` on the `projects` table instead of `shared_videos`
- Drop all references to `shared_videos` and `deleted_videos` tables
- When a project is soft-deleted, the cleanup edge function reads `cf_video_uid` and deletes from Cloudflare Stream

### 4.8 `webapp/src/App.tsx` (router)
- For unauthenticated users: default route (`/`) shows either the single project editor or empty recording CTA (not the full DashboardPage)
- For authenticated users: default route shows the dashboard (existing behavior)

---

## 5. UX for Auth/Subscription States

### 5.1 Unauthenticated (no dashboard, no library)

Local projects with a `userId` set (previously synced to a cloud account) are **hidden** from the unauthenticated view. Only truly local projects (no `userId`) are visible.

| Action | Behavior |
|--------|----------|
| Visit `/` | If local project (no userId) exists: show it as single card with "Open" + sign-in CTA. If none: "Start recording" CTA. Cloud-synced projects from a previous session are hidden, not shown or overwritable. |
| New recording (no existing local) | Save to IndexedDB, open editor. |
| New recording (existing local, no userId) | Choice dialog: "Sign in to keep both" / "Overwrite". |
| Edit/export | Full editing at free tier (480p/720p with watermark). |
| Sign in | Existing local project(s) migrate to cloud. Hidden cloud-synced projects reappear. Transition to library view. |
| Browser data cleared | Local project gone. Expected — communicated upfront. |

### 5.2 Authenticated + Pro/Trial

| Action | Behavior |
|--------|----------|
| Dashboard | Full library grid, synced from cloud. Sync status indicator. Published badge on project cards. |
| New recording | Saves locally + metadata to cloud + queues media upload. `expires_at = NULL`. |
| Open project | Loads from local cache. If not cached: downloads media with progress indicator. Updates `last_accessed_at`. |
| Edit | Full editing. Auto-saves locally (2s) + to cloud. |
| Export | Full quality per subscription tier. |
| New device | Project list from cloud with thumbnails. Background download prioritizes recent projects. |
| Delete project | Deletes locally + soft-deletes in cloud + cascades to published video on Cloudflare Stream. |

### 5.3 Authenticated + Free (no Pro, no trial)

| Action | Behavior |
|--------|----------|
| Dashboard | Full library grid, synced from cloud. Projects show expiry countdown badges. |
| New recording | Saves locally + syncs to cloud. `expires_at = NOW() + 14 days`. Banner: "Upgrade to Pro to keep your projects permanently." |
| Open project | Same as Pro — loads from cache or downloads. Full editing. Free-tier export (480p/720p with watermark). |
| Edit | Full editing. Auto-saves locally + to cloud. |
| After 14 days | Projects auto-deleted from cloud by cron. Locally cached copy remains until browser data cleared. |

### 5.4 Expired Pro (was Pro, now isn't — 2-week grace)

| Action | Behavior |
|--------|----------|
| Dashboard | Library visible with countdown banner showing days until `expires_at`: "Re-subscribe within X days to keep your cloud projects." |
| Open project (cached) | Full editing (they're authenticated). Free-tier export. |
| Open project (not cached) | Downloads from cloud (still within grace period). |
| New recording | Syncs to cloud with `expires_at = NOW() + 14 days` (same as free user). |
| Published videos | Stay live during grace. Deleted along with project data after `expires_at`. |
| Re-subscribe | Immediately restores full access. `expires_at` set to NULL on all projects. All cloud data intact. |
| After `expires_at` passes | Cron soft-deletes projects. Edge function cleans up Storage files + CF Stream published videos (FK cascade). |

### 5.5 Past Due

Same as expired Pro but softer message: "Your payment needs updating." Link to Stripe billing portal.

### 5.6 Key state transitions

**New recording with existing local project (unauthenticated):**
```
[Record] → "You already have a project"
  ├─ "Sign in to keep both" → Auth flow → migrate both to cloud → library view
  └─ "Overwrite" → Delete old → Save new → Open editor
```

**First login (has local project):**
1. Migrate local project to cloud (upload metadata + queue media)
2. Transition to dashboard/library view

**Logout:**
1. Keep local IndexedDB cache intact (blobs + syncMeta with userId)
2. Hide all projects with a `userId` set — revert to unauthenticated single-project view (only truly local projects visible)
3. Re-login: projects matching the user's `userId` reappear from cache, rejoin cloud

**Pro expires:**
1. Stripe webhook calls `set_project_expiry(user_id, NOW() + 14 days)` — sets `expires_at` on all projects
2. Dashboard shows countdown from `expires_at`
3. User can still edit (they're authenticated) but only export at free tier
4. After `expires_at`: cron soft-deletes, edge function cleans Storage + CF Stream

**Re-subscribes:**
1. Stripe webhook calls `set_project_expiry(user_id, NULL)` — clears `expires_at` on all projects
2. Full access restored immediately

---

## 6. Offline Behavior

| Scenario | Behavior |
|----------|----------|
| Offline, editing open project | All editing works. Saves to IndexedDB. Cloud sync queues up. |
| Come back online | Pending metadata syncs flush. Media uploads resume. |
| Offline, dashboard | Show locally cached projects only. "Offline" indicator. |
| Offline, open non-cached project | "Connect to the internet to download this project." |

SyncService maintains a persistent queue in IndexedDB (`syncMeta` store). On reconnect (`navigator.onLine` + fetch success), drains queue with exponential backoff retry.

---

## 7. Published Videos Integration

**Current state:** `shared_videos` table + Cloudflare Stream, separate "Published" tab in dashboard.

**Changes:**
- **Published state on `projects` table.** New columns: `cf_video_uid`, `published_at`, `share_description`. Old `shared_videos` and `deleted_videos` tables kept in place for now to avoid breaking production — dropped in a future cleanup.
- **ShareService rewired:** reads/writes published fields on `projects` row instead of `shared_videos`. Cloudflare Stream upload/delete flow unchanged internally.
- **No separate "Published" tab:** Remove from DashboardPage. Instead, project cards show a "Published" badge (check `cf_video_uid IS NOT NULL`) with publish/unpublish in context menu.
- **Delete cascade:** when a project is soft-deleted, the cleanup edge function reads `cf_video_uid` before hard-deleting and removes the video from Cloudflare Stream.

---

## 8. Implementation Phases (testable chunks)

### Chunk 1: Cloud infrastructure + metadata sync

**Goal:** Project metadata syncs to/from Supabase. Dashboard shows cloud projects. Media stays local-only.

**New files:**
- `webapp/supabase/migrations/YYYYMMDD_create_projects_table.sql` — projects table (with `upload_status`, `expires_at`, published fields), user_assets table, user_quotas table, quota function, expiry functions (shared_videos + deleted_videos kept for now)
- `webapp/src/storage/cloudStorage.ts` — metadata CRUD only (no media upload/download yet)
- `webapp/src/storage/syncService.ts` — metadata sync only (saveProject, listProjects, onLogin)
- `webapp/src/storage/syncStatusStore.ts` — Zustand store for sync UI state

**Modified files:**
- `webapp/src/storage/projectStorage.ts` — DB v6 with `syncMeta` store, `hasRecordingBlob()`
- `webapp/src/editor/stores/useProjectStore.ts` — auto-save routes through SyncService
- `webapp/src/pages/DashboardPage.tsx` — project list from SyncService, remove Published tab, add published badge on cards
- `webapp/src/editor/stores/useUserStore.ts` — add `isExpiredPro()`
- `webapp/src/editor/App.tsx` — update `last_accessed_at` on project open
- `webapp/supabase/functions/stripe-webhooks/index.ts` — call `set_project_expiry()` on subscription status changes

**Testable outcomes:**
- Create/edit project as pro user → verify `projects` row in Supabase with correct `project_data` JSONB and `upload_status = 'pending'`
- Edit settings → verify `cloud_version` increments, `project_data` updates
- Open dashboard → see merged list of local + cloud projects
- Published badge appears on project cards where `cf_video_uid IS NOT NULL`
- Log in on second browser → see project list (without media — shows "Loading..." state)
- Log out → cloud-synced projects hidden, only truly local projects visible

### Chunk 2: Media upload + download + unauthenticated flow + graceful degradation

**Goal:** Full end-to-end cloud storage. Media uploads after recording, downloads on demand. Unauthenticated restrictions. Expired pro handling.

**New files:**
- Supabase Storage bucket config (no client-side RLS — signed URLs via backend)
- `backend/src/routes/storage.ts` — signed URL generation, quota enforcement, upload confirmation
- `webapp/supabase/functions/cleanup-expired-projects/index.ts` — Storage file + CF Stream cleanup for soft-deleted projects

**Modified files:**
- `webapp/src/storage/cloudStorage.ts` — add signed URL requests, upload/download via signed URLs, thumbnail resize + upload, quota check via backend
- `webapp/src/storage/syncService.ts` — add media upload queue, background download with priority queue, `prioritizeProject()`, `onProjectCreated()` with media upload
- `webapp/src/pages/ImportPage.tsx` — trigger media upload, unauthenticated overwrite dialog
- `webapp/src/pages/DashboardPage.tsx` — unauthenticated single-project view, expired pro banner with countdown, download progress indicators
- `webapp/src/App.tsx` — unauthenticated default route (single project view instead of dashboard)
- `webapp/src/editor/App.tsx` — expiry countdown banner, download progress on project open
- `webapp/src/editor/services/ShareService.ts` — no internal changes, but SyncService.deleteProject cascades to it

**Testable outcomes:**
- Record new project as pro → `upload_status` goes `pending → uploading → ready`, media appears in `project-media` bucket
- Log in on second browser → open project → "Loading project..." with progress → editor loads
- Background download only caches blobs for last 5 accessed projects
- Unauthenticated: record project → record another → see overwrite/sign-in dialog (cloud-synced projects hidden)
- Expired pro: countdown banner, free-tier export, can still edit cached projects
- Delete project → published video also deleted from Cloudflare Stream
- Quota: upload blocked when usage exceeds `storage_limit_bytes`
- LRU eviction: 6th project download evicts oldest cached blobs
- QuotaExceededError: toast shown, oldest cloud-synced blobs evicted

---

## 9. Cost Estimate

| Metric | Estimate |
|--------|----------|
| Storage per user (5 projects x 500MB avg) | 2.5 GB → $0.05/mo |
| Download per new-device sync | 2.5 GB → $0.23 one-time |
| 1000 pro users storage | ~2.5 TB → $52/mo |
| 1000 pro users bandwidth (10% re-download) | ~$23/mo |
| **Total for 1000 users** | **~$75/month** |

Well within Pro subscription revenue ($15/mo or $48/yr per user). 25 GB default per-user quota caps worst case at $0.53/user/month.

---

## 10. Verification Plan

**Chunk 1 tests:**
1. Create project as pro user → verify row in `projects` table with `upload_status = 'pending'`
2. Edit settings → verify `project_data` updated, `cloud_version` incremented
3. Dashboard shows merged local + cloud projects
4. Published badge on project cards where `cf_video_uid` is set
5. Second browser shows cloud project list (without media)
6. Delete project → verify soft delete in DB
7. Expire subscription → verify `expires_at` set on all projects
8. Re-subscribe → verify `expires_at` cleared to NULL
9. Log out → cloud-synced projects (with userId) hidden from view
10. Log back in → cloud-synced projects reappear

**Chunk 2 tests:**
11. Record project → `upload_status` transitions `pending → ready` → verify in Storage bucket
12. Close app mid-upload → reopen → uploads resume for paths still `'pending'`
13. Second browser → open project → "Loading project..." with progress → editor works
14. Background download only keeps blobs for last 5 accessed projects
15. 6th project opened → oldest cached blobs evicted
16. Unauthenticated: new recording with existing (no userId) shows overwrite dialog
17. Unauthenticated: cloud-synced projects not visible or overwritable
18. Unauthenticated: sign-in migrates local project to cloud
19. Expired pro: countdown banner on dashboard + editor, free-tier export, can still edit
20. Free user: new project gets `expires_at` = 14 days, countdown badge on project card
21. After `expires_at` passes: cron soft-deletes projects, edge function cleans Storage + CF Stream
22. Delete project → Cloudflare Stream video also deleted (via `cf_video_uid`)
23. Quota enforcement: upload blocked at limit, warning at 80%
24. QuotaExceededError in IndexedDB → toast shown, oldest cloud-synced blobs evicted
25. Offline: edit works, sync queues, flushes on reconnect

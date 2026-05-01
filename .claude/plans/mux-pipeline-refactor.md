# Mux Pipeline Refactor: Point-in-Time Sharing with Explicit cloud_version

## Context

The current mux video pipeline auto-resolves cloud_version from the projects table and auto-triggers renders when someone visits a shared video page. None of this is in production yet, so we drop all three tables (render_jobs, mux_videos, shared_videos) and recreate them cleanly.

Key paradigm shifts:
- **cloud_version is passed explicitly** by the client, not read from the projects table
- **Sharing is point-in-time** — user must explicitly click "Update video" to re-render for a new version
- **One mux_video row per (project_id, cloud_version)** — failures don't create new rows
- **No render_job_id FK** — cloud_version is the implicit link between render_jobs and mux_videos
- **Shared upload utility** — `_shared/muxUpload.ts` used by both mux-video-create and render-hook

---

## Phase 1: Database — Drop and Recreate Tables

### 1.1 Single migration: drop all three tables and recreate

**New file**: `supabase/migrations/<ts>_recreate_render_mux_tables.sql`

Drop (CASCADE to remove dependent objects):
```sql
DROP TABLE IF EXISTS public.mux_videos CASCADE;
DROP TABLE IF EXISTS public.render_jobs CASCADE;
DROP TABLE IF EXISTS public.shared_videos CASCADE;
```

Recreate **render_jobs**:
```sql
CREATE TABLE public.render_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    cloud_version INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed', 'canceled')),
    progress REAL DEFAULT 0,
    render_storage_path TEXT,                  -- {user_id}/{project_id}/renders/v{cloud_version}.mp4
    error TEXT,
    video_duration_s REAL,
    start_duration_s REAL,
    download_duration_s REAL,
    render_duration_s REAL,
    upload_duration_s REAL,
    total_duration_s REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indexes:
--   (user_id, created_at DESC) — user's jobs list
--   (project_id, cloud_version, status) — dedup/cache lookups
--   UNIQUE (project_id) WHERE status = 'pending' — max one pending per project
--   UNIQUE (project_id, cloud_version) WHERE status = 'completed' — max one completed per version
-- RLS: SELECT for authenticated (auth.uid() = user_id)
```

Recreate **shared_videos** (unchanged schema):
```sql
CREATE TABLE public.shared_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    slug TEXT NOT NULL UNIQUE,
    policy TEXT NOT NULL DEFAULT 'public'
        CHECK (policy IN ('public', 'private')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- UNIQUE (project_id) — one share per project
-- RLS: ALL for auth.uid() = user_id
```

Recreate **mux_videos** (new schema):
```sql
CREATE TABLE public.mux_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    cloud_version INT NOT NULL,
    attempt INT NOT NULL DEFAULT 1,           -- for future retry tracking
    mux_asset_id TEXT,
    mux_playback_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed', 'canceled')),
    error TEXT,
    render_storage_path TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indexes:
--   UNIQUE (project_id, cloud_version) — one row per version, unconditional
--   UNIQUE (project_id) WHERE is_deleted = FALSE AND status = 'completed' — one active completed
--   (mux_asset_id) WHERE mux_asset_id IS NOT NULL — webhook lookup
--   (is_deleted) WHERE is_deleted = TRUE — cron cleanup
-- RLS: ALL for auth.uid() = user_id
```

No `render_job_id` column. No `quality` column on render_jobs (always 1080p for now).

### 1.2 Update SQL functions

**`render_job_get_or_create.sql`** (renamed from `render_job_resolve.sql`) — new signature: `(p_project_id, p_user_id, p_cloud_version INT)`
- Remove projects table lookup
- Cache hit: check render_jobs for completed row at (project_id, cloud_version), return its render_storage_path
- Dedup/cancel/insert use p_cloud_version

**`render_job_complete.sql`** — cascade by cloud_version, not render_job_id
- Read project_id + cloud_version from the render_job being completed
- On failed/canceled: `UPDATE mux_videos SET status='failed' WHERE project_id=... AND cloud_version=... AND status='pending'`
- On completed: no cascade (render-hook handles upload)

**`mux_video_get_or_create.sql`** (renamed from `mux_video_resolve.sql`) — new signature: `(p_project_id, p_user_id, p_cloud_version INT)`
- Remove projects table lookup
- Remove stale cancellation (each version has its own row)
- Check existing row for (project_id, cloud_version) — any status → return with is_new=false
- If none, insert with status='pending' → return is_new=true

**`mux_video_complete.sql`** — no changes needed (it already checks `status='pending'` which is now correct)

**`shared_video_create.sql`** — no changes

### 1.3 Run `build-functions.sh`

---

## Phase 2: Shared Utility

### 2.1 Create `_shared/muxUpload.ts`

**New file**: `supabase/functions/_shared/muxUpload.ts`

```typescript
export async function uploadToMux(params: {
    adminSupabase: SupabaseClient;
    muxVideoId: string;
    renderStoragePath: string;
    muxTokenId: string;
    muxTokenSecret: string;
}): Promise<{ success: boolean; muxAssetId?: string; error?: string }>
```

Logic: sign download URL → POST Mux API → store mux_asset_id + render_storage_path on mux_video (status stays 'pending' until Mux webhook). On failure: mark mux_video failed.

---

## Phase 3: Edge Functions

### 3.1 `render-start/` (replaces `render-sync/`)

**New file**: `supabase/functions/render-start/index.ts`

- Accept `{ projectId, cloudVersion }`
- Pass `p_cloud_version` to `render_job_get_or_create`
- Return `{ jobId, status, renderStoragePath }`
- Dual auth: user JWT + Pro check, or service role

### 3.2 `mux-video-create/` (replaces `mux-video-sync/`)

**New file**: `supabase/functions/mux-video-create/index.ts`

- Auth: user JWT + Pro check
- Accept `{ projectId, cloudVersion }`
- Check shared_videos exists → error if not (frontend creates separately)
- Call `mux_video_get_or_create(project_id, user_id, cloud_version)`
- If completed/in-progress/failed → return current status
- If new → call render-start (service role), if render done → `uploadToMux`, else return 'pending'

### 3.3 Update `render-hook/index.ts`

- Add MUX_TOKEN_ID, MUX_TOKEN_SECRET env vars
- Import `uploadToMux` from `_shared/muxUpload.ts`
- Add `cloud_version` to the job SELECT query
- On completion: query mux_videos for (project_id, cloud_version) with status='pending' → if found, call `uploadToMux` directly
- Remove fire-and-forget dispatch to mux-video-sync

### 3.4 Simplify `shared-video-get/index.ts`

- Read-only, no dispatching
- Remove `dispatchMuxSync` function
- Remove cloud_version staleness comparison
- Always return project name + user info
- Mux video lookup priority:
  1. Find latest completed mux_video (highest cloud_version, is_deleted=false) → return `status='completed'` + playback_id
  2. Else find latest pending mux_video → return `status='pending'`
  3. Else if any failed mux_video exists → return `status='failed'`
  4. Else → return without mux video data (frontend shows "Could not find video")

### 3.5 `mux-video-hook/index.ts` — no changes needed

Already checks `status='pending'` which is now correct.

### 3.6 Delete old functions

- Delete `supabase/functions/render-sync/`
- Delete `supabase/functions/mux-video-sync/`

---

## Phase 4: Frontend

### 4.1 `cloudProjectService.ts` — saveProject returns cloudVersion

Return the cloudVersion from the save result (already available internally).

### 4.2 `SettingsPanel.tsx` — new Share button flow

New share path lives in the side panel (keep existing CF Stream path in ExportModal untouched):

- Keep `shared_video_create` RPC (creates slug, gives URL immediately)
- Remove pre-warm `shared-video-get` dispatch
- After slug creation: sync project → get cloudVersion → call mux-video-create
- Show "Update video" when project has changed since last share

### 4.3 `ExportModal.tsx` — no changes (keep CF Stream path for now)

### 4.4 `VideoPage.tsx` — poll `shared-video-get`

- Always shows project name + user info (returned by shared-video-get regardless of mux status)
- Poll `shared-video-get` on mount and every 5 seconds while pending
- Status handling:
  - `completed` → show Mux player with playback_id, stop polling
  - `pending` → show "preparing video", keep polling
  - `failed` → show error message, stop polling

---

## Phase 5: Cleanup

- Delete old incremental migrations that modified the dropped tables (or leave them — they're no-ops after the drop)
- Add MUX env vars to render-hook deployment config
- Verify crons still work (cron_render_stale_jobs calls render_job_complete which now cascades by cloud_version)

---

## Verification

1. Apply migration → tables recreated with new schema
2. Call render-start with cloudVersion → render_job created, worker dispatched
3. Share flow: shared_video_create → mux-video-create → render → render-hook uploads to Mux → webhook completes
4. Video page: 'processing' during pipeline → 'ready' when done → 'no_video' if never shared
5. Stale render cron: failed render cascades to mux_video via (project_id, cloud_version)
6. Cache hit: same version twice → second call returns completed
7. Update flow: edit → sync → mux-video-create with new cloudVersion → new row → old version soft-deleted

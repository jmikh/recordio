# Replace Cloudflare Stream with Mux — Share on Render

## Context

The current sharing flow requires users to manually click "Share" after export, which triggers a 3-step TUS upload from the browser to Cloudflare Stream. This is slow, unreliable (browser must stay active), and couples sharing to the client.

**New approach:** User toggles "share" before server render. The render worker uploads the MP4 to Mux automatically after rendering. No client-side upload at all. OK to lose existing shared videos — clean break.

---

## Phase 1: Database Migration

**New file:** `webapp/supabase/migrations/<timestamp>_mux_share.sql`

### New `shared_videos` table

```sql
CREATE TABLE public.shared_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),

    -- Mux
    mux_asset_id TEXT NOT NULL,
    mux_playback_id TEXT NOT NULL,

    -- Metadata (editable by owner)
    title TEXT,
    description TEXT,

    -- Versioning (increments on each re-share)
    version INT NOT NULL DEFAULT 1,

    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(project_id)  -- one published video per project
);

ALTER TABLE shared_videos ENABLE ROW LEVEL SECURITY;

-- Owner can read/update/delete their own shares
CREATE POLICY "Users can manage own shares"
    ON shared_videos FOR ALL
    USING (auth.uid() = user_id);
```

### Add share flag to projects

```sql
ALTER TABLE projects ADD COLUMN share_on_render BOOLEAN NOT NULL DEFAULT FALSE;
```

### Add Mux columns to render_jobs (worker writes on completion)

```sql
ALTER TABLE render_jobs ADD COLUMN mux_asset_id TEXT;
ALTER TABLE render_jobs ADD COLUMN mux_playback_id TEXT;
```

### Drop CF Stream artifacts

```sql
ALTER TABLE projects DROP COLUMN IF EXISTS cf_video_uid;
ALTER TABLE projects DROP COLUMN IF EXISTS published_at;
ALTER TABLE projects DROP COLUMN IF EXISTS share_description;
DROP TABLE IF EXISTS deleted_cf_streams;
```

### Update DB functions (then run `sql/build-functions.sh`)
- `sql/functions/project_list.sql` — return `share_on_render`; join or subquery `shared_videos` to return `is_shared` boolean

---

## Phase 2: Render Worker — Mux Upload

**Install:** `@mux/mux-node` in `render-worker/package.json`

**New file:** `render-worker/src/uploadToMux.ts`
- Import Mux SDK, create client from `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET` env vars
- Create a direct upload via `mux.video.uploads.create({ new_asset_settings: { playback_policy: ['public'] } })`
- PUT the MP4 file to the returned URL
- Poll `mux.video.uploads.retrieve(uploadId)` until `asset_id` is available
- Retrieve asset to get `playback_ids[0].id`
- Return `{ muxAssetId, muxPlaybackId }`

**Modify:** `render-worker/src/server.ts`
- Add `shareOnRender: boolean` to `RenderBody` interface
- In `runRender`, after Supabase upload (step 3), before "Done" (step 4):
  - If `shareOnRender`, call `uploadToMux(outputFilePath)` 
  - Pass `mux_asset_id` and `mux_playback_id` to `updateJob()` call on completion
- Adjust progress allocation when sharing: render 0–0.85, Supabase upload 0.85–0.93, Mux upload 0.93–1.0

**Modify:** `render-worker/src/config.ts`
- Add optional `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` env vars

---

## Phase 3: Edge Functions

### 3a. `render-start-job` — pass share flag
- File: `webapp/supabase/functions/render-start-job/index.ts`
- Add `share_on_render` to the `.select()` on projects (line 47)
- Pass `shareOnRender: project.share_on_render` in the JSON body to the render worker (line ~152)

### 3b. `render-update-status` — persist Mux IDs → `shared_videos` table
- File: `webapp/supabase/functions/render-update-status/index.ts`
- Accept `mux_asset_id` and `mux_playback_id` in request body
- When `status === 'completed'` and Mux IDs are present:
  - Write them to the `render_jobs` row
  - Upsert into `shared_videos`: if row exists for `project_id`, delete old Mux asset first (call Mux API), then update with new IDs + increment `version` + reset `published_at`. If no row, insert.
  - This requires `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET` as edge function secrets (for deleting old asset on re-share)

### 3c. `get-published-project` — return from `shared_videos`
- File: `webapp/supabase/functions/get-published-project/index.ts`
- Query `shared_videos` joined with `projects` (for project name) instead of querying projects directly
- Return `{ id, project_id, user_id, title, description, mux_playback_id, published_at, version }`

### 3d. New: `delete-from-mux`
- New file: `webapp/supabase/functions/delete-from-mux/index.ts`
- Auth: user JWT (via `withAuth`)
- Verify user owns project (RLS on `shared_videos`)
- Call Mux API to delete asset
- Delete the `shared_videos` row
- No async queue needed — Mux deletion is fast and idempotent

---

## Phase 4: ExportModal — Share Toggle

**File:** `webapp/src/editor/components/settings/ExportModal.tsx`

**Remove:**
- Entire `handlePublish` function (lines 271–434)
- The "Share" / "Reshare" button block
- The "Copy Link" + "Published X ago" block tied to `existingShare`
- `ShareService.shareVideo()` import/usage
- `isPublishing` state

**Add:**
- `shareOnRender` toggle state, initialized from project's `share_on_render` column
- A `Toggle` component labeled "Share publicly" near the "Server Render" button
- On toggle change: `supabase.from('projects').update({ share_on_render: value }).eq('id', project.id)`
- After server render completes (in poll loop), check if `shared_videos` row exists for project:
  - If yes: show share URL + "Copy Link" button
  - Auto-copy to clipboard

---

## Phase 5: Simplify ShareService

**File:** `webapp/src/editor/services/ShareService.ts`

**Remove:**
- `tus-js-client` import
- `shareVideo()`, `requestUploadUrl()`, `uploadDirectToCF()`, `confirmUpload()` methods
- All CF Stream references

**Update:**
- `SharedVideo` interface: `mux_playback_id` instead of `cf_video_uid`, add `version`
- `getSharedVideoById()` — calls `get-published-project` which now queries `shared_videos`
- `getShareForProject()` — query `shared_videos` table for project
- `deleteSharedVideo()` — call `delete-from-mux` edge function

**Keep:** `getShareUrl()`, `getCurrentUserId()`, `updateSharedVideoMeta()`, cache logic

---

## Phase 6: Watch Page Redesign

**Install:** `@mux/mux-player-react` in webapp `package.json`

**File:** `webapp/src/pages/WatchPage.tsx`

**Replace:**
- CF Stream iframe with `<MuxPlayer playbackId={sharedVideo.mux_playback_id} />`
- Remove `getCfCustomerSubdomain()` helper
- Remove `VITE_CF_CUSTOMER_SUBDOMAIN` references

**Design changes:**
- Mux Player handles aspect ratio natively — remove the `paddingTop: 56.25%` hack
- Better loading state: shimmer skeleton instead of spinner
- Keep: editable title/description for owners, copy link button, sidebar details card, CTA card
- Keep: responsive two-column layout, header with logo/auth

---

## Phase 7: Update Types & Dashboard

**Files:**
- `webapp/src/storage/cloudProjectService.ts` — `ProjectListItem`: replace `cfVideoUid` with `isShared` boolean (from joined query)
- `webapp/src/storage/cloudStorage.ts` — update `CloudProject` type, add `shareOnRender`
- `webapp/src/components/ProjectCard.tsx` — `isShared` prop already exists, just update data source
- Dashboard page — update share indicator logic

---

## Phase 8: Cleanup

**Delete edge functions:**
- `webapp/supabase/functions/upload-to-stream/`
- `webapp/supabase/functions/confirm-upload/`
- `webapp/supabase/functions/delete-from-stream/`
- `webapp/supabase/functions/purge-deleted-cf-streams/`

**Delete cron:**
- `webapp/supabase/sql/crons/cron_purge_deleted_cf_streams.sql`
- Run `sql/build-functions.sh` to regenerate

**Remove env vars:** `VITE_CF_CUSTOMER_SUBDOMAIN`, `CF_STREAM_API_TOKEN`, `CF_STREAM_ACCOUNT_ID`

**Note:** Keep `tus-js-client` in root package.json — it's used by `cloudStorage.ts` for Supabase Storage resumable uploads (unrelated to CF Stream).

---

## Key Design Decisions

### Separate `shared_videos` table
Share state lives in its own table rather than on `projects`. This isolates sharing complexity (Mux IDs, versioning, metadata, future fields like view counts / passwords / expiry) and keeps the projects table clean.

### Re-share versioning
Each re-share (new render with share enabled) creates a new Mux asset. The old asset is deleted and the `shared_videos` row is updated in-place with new Mux IDs + incremented `version`. The share URL stays the same (keyed by `project_id`). If cumulative analytics are needed later, a `shared_video_history` table can be added without touching the main schema.

### Mux asset cleanup on re-share
The `render-update-status` edge function handles old asset deletion when upserting. This ensures old Mux assets don't leak even if the client disconnects.

---

## Verification

1. **Render + share flow:** Toggle share on → server render → verify Mux asset created → `shared_videos` row exists → watch page loads with Mux Player
2. **Re-share:** Re-render with share on → verify old Mux asset deleted, new one created, `version` incremented, same share URL works
3. **Share off:** Toggle share off → server render → verify no Mux upload, no `shared_videos` change
4. **Watch page:** Visit `/watch/{projectId}` — video plays via Mux, title/description editable by owner
5. **Unpublish:** Delete share → verify Mux asset deleted, `shared_videos` row removed, watch page shows "not found"
6. **Dashboard:** Project card shows share indicator when `shared_videos` row exists
7. **Deploy:** Render worker needs `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET` in Cloud Run config; edge functions need them too (for old asset deletion on re-share)

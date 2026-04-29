# Replace Cloudflare Stream with Mux — Share on Render

## Context

The current sharing flow requires users to manually click "Share" after export, which triggers a 3-step TUS upload from the browser to Cloudflare Stream. This is slow, unreliable (browser must stay active), and couples sharing to the client.

**New approach:** User toggles "share" before server render. The render worker uploads the MP4 to Mux automatically after rendering. No client-side upload at all. OK to lose existing shared videos — clean break.

---

## Phase 1: Database Migration

**New file:** `webapp/supabase/migrations/<timestamp>_mux_share.sql`

```sql
-- Add Mux columns to projects
ALTER TABLE projects ADD COLUMN mux_asset_id TEXT;
ALTER TABLE projects ADD COLUMN mux_playback_id TEXT;
ALTER TABLE projects ADD COLUMN share_on_render BOOLEAN NOT NULL DEFAULT FALSE;

-- Add Mux columns to render_jobs (worker writes these on completion)
ALTER TABLE render_jobs ADD COLUMN mux_asset_id TEXT;
ALTER TABLE render_jobs ADD COLUMN mux_playback_id TEXT;

-- Drop CF Stream artifacts
ALTER TABLE projects DROP COLUMN IF EXISTS cf_video_uid;
DROP TABLE IF EXISTS deleted_cf_streams;
```

Keep `published_at` and `share_description` — they're still used.

**Update DB functions** (then run `sql/build-functions.sh`):
- `sql/functions/project_list.sql` — return `mux_playback_id`, `share_on_render` instead of `cf_video_uid`

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

### 3b. `render-update-status` — persist Mux IDs
- File: `webapp/supabase/functions/render-update-status/index.ts`
- Accept `mux_asset_id` and `mux_playback_id` in request body
- When `status === 'completed'` and Mux IDs are present:
  - Write them to the `render_jobs` row
  - Also update `projects` row: set `mux_asset_id`, `mux_playback_id`, `published_at = NOW()`
  - This is the moment the video becomes "published" — no separate confirm step

### 3c. `get-published-project` — return Mux playback ID
- File: `webapp/supabase/functions/get-published-project/index.ts`
- Change `.select()` to include `mux_playback_id` instead of `cf_video_uid`
- Change filter: `.not('mux_playback_id', 'is', null)` instead of `cf_video_uid`

### 3d. New: `delete-from-mux`
- New file: `webapp/supabase/functions/delete-from-mux/index.ts`
- Auth: user JWT (via `withAuth`)
- Verify user owns project (RLS)
- Call Mux API: `DELETE /video/v1/assets/{assetId}` (or use SDK if available in Deno)
- Clear `mux_asset_id`, `mux_playback_id`, `published_at` on projects row
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
- `shareOnRender` toggle state, initialized from project row
- A `Toggle` component labeled "Share publicly" above/near the "Server Render" button
- On toggle change: `supabase.from('projects').update({ share_on_render: value }).eq('id', project.id)`
- After server render completes (in poll loop), if project has `mux_playback_id`:
  - Show share URL + "Copy Link" button
  - Auto-copy to clipboard

---

## Phase 5: Simplify ShareService

**File:** `webapp/src/editor/services/ShareService.ts`

**Remove:**
- `tus-js-client` import
- `shareVideo()`, `requestUploadUrl()`, `uploadDirectToCF()`, `confirmUpload()` methods
- All CF Stream references

**Update:**
- `SharedVideo` interface: `mux_playback_id` instead of `cf_video_uid`
- `getSharedVideoById()` — query `mux_playback_id` from `get-published-project`
- `getShareForProject()` — check for `mux_playback_id` presence
- `deleteSharedVideo()` — call `delete-from-mux` edge function instead of `delete-from-stream`

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
- `webapp/src/storage/cloudProjectService.ts` — `ProjectListItem`: replace `cfVideoUid` with `muxPlaybackId`
- `webapp/src/storage/cloudStorage.ts` — update `CloudProject` type
- `webapp/src/components/ProjectCard.tsx` — `isShared={!!item.muxPlaybackId}`
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

## Verification

1. **Render + share flow:** Toggle share on → server render → verify Mux asset created → watch page loads with Mux Player
2. **Share off:** Toggle share off → server render → verify no Mux upload, no `mux_playback_id` set
3. **Watch page:** Visit `/watch/{projectId}` — video plays via Mux, title/description editable by owner
4. **Unpublish:** Delete share → verify Mux asset deleted, `mux_playback_id` cleared, watch page shows "not found"
5. **Dashboard:** Project card shows share indicator when `mux_playback_id` present
6. **Deploy:** Render worker needs `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET` secrets in Cloud Run config

# Replace Cloudflare Stream with Mux — Share on Render

## Context

The current sharing flow requires users to manually click "Share" after export, which triggers a 3-step TUS upload from the browser to Cloudflare Stream. This is slow, unreliable (browser must stay active), and couples sharing to the client.

**New approach:** User clicks "Share" and instantly gets a link. No render or upload needed at that moment. When someone visits the link, the system auto-triggers a render if needed. The render worker stays Mux-agnostic — edge functions handle Mux after render completion. Existing videos stay playable during updates.

---

## Core UX Flow

```
Owner clicks "Share" in editor
  → Sets share_policy = 'public' on project
  → Creates shared_videos row if none exists (mux IDs null)
  → Owner gets link instantly: /watch/{projectId}

Viewer visits /watch/{projectId}
  → get-published-project edge function:
     1. Check project.share_policy != 'private'
     2. Query active shared_video (is_deleted = false)
     3. If mux_playback_id exists + cloud_version is current → serve video
     4. If mux_playback_id exists but cloud_version stale → serve old video + auto-trigger render
     5. If no mux_playback_id (never rendered) → return 'processing' + auto-trigger render
  → Watch page subscribes to shared_videos via Supabase Realtime
  → When new row appears → swap player seamlessly

Render completes → render-confirm-upload edge function:
  1. Create new Mux asset (input from Supabase Storage signed URL)
  2. Insert NEW shared_videos row with new Mux IDs + current cloud_version
  3. Mark OLD shared_videos row(s) as is_deleted = true
  4. Realtime fires → viewer sees new video
  5. Cron job later deletes Mux assets for is_deleted rows

Owner clicks "Unshare":
  → Sets share_policy = 'private' on project
  → Watch page returns 404 (policy check fails)
  → Video + Mux asset stay alive — re-sharing is instant (flip back to 'public')
```

---

## Phase 1: Database Migration

**New file:** `webapp/supabase/migrations/<timestamp>_mux_share.sql`

### Add share columns to `projects`

```sql
-- Access policy: controls who can view the shared video
ALTER TABLE projects ADD COLUMN share_policy TEXT NOT NULL DEFAULT 'private';
  -- 'private' | 'public' | 'password' | 'workspace'
ALTER TABLE projects ADD COLUMN share_password_hash TEXT;
  -- only set when share_policy = 'password'
```

### New `shared_videos` table

```sql
CREATE TABLE public.shared_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),

    -- Mux (null until render + upload completes)
    mux_asset_id TEXT,
    mux_playback_id TEXT,

    -- Which project version this video was rendered from (null until first render)
    cloud_version INT,

    -- Soft delete: marked true when replaced by new version or project deleted.
    -- Cron cleans up the Mux asset and removes the row.
    -- NOT used for unsharing — that's controlled by project.share_policy.
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,

    -- Metadata (editable by owner on watch page)
    description TEXT,

    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE shared_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shares"
    ON shared_videos FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Public can read shared videos"
    ON shared_videos FOR SELECT USING (true);

-- One active (non-deleted) video per project
CREATE UNIQUE INDEX idx_shared_videos_active
    ON shared_videos(project_id) WHERE is_deleted = FALSE;

-- For cron cleanup queries
CREATE INDEX idx_shared_videos_deleted
    ON shared_videos(is_deleted) WHERE is_deleted = TRUE;

-- Enable Realtime for viewer subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE shared_videos;
```

### Render job dedup index

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_render_jobs_pending_dedup
    ON render_jobs(project_id, cloud_version) WHERE status = 'pending';
```

`render-start-job` handles constraint violation: if insert fails (race loser), re-query for existing pending job and return it.

**Do NOT drop CF columns yet** — defer to cleanup phase.

### Update DB functions (then run `sql/build-functions.sh`)
- `project_list.sql` — add `share_policy`; LEFT JOIN `shared_videos` (`WHERE is_deleted = false`) to return `is_shared` boolean
- `project_get.sql` — add `share_policy`, `share_password_hash`

---

## Phase 2: Edge Functions

### 2a. `render-confirm-upload` (new) — Mux upload after render
- New file: `webapp/supabase/functions/render-confirm-upload/index.ts`
- Auth: `RENDER_SECRET`
- Called once when render completes
- Flow:
  1. Look up active `shared_videos` row (`is_deleted = false`) for this project
  2. If no active row → skip (project was never shared)
  3. Generate signed URL for rendered MP4 from Supabase Storage
  4. Create new Mux asset: `POST /video/v1/assets` with `{ input: [{ url: signedUrl }], playback_policy: ['public'] }`
  5. Copy `description` from old row
  6. Insert NEW `shared_videos` row with: new Mux IDs, current `cloud_version`, copied description
  7. Mark OLD row(s) as `is_deleted = true`
  8. Realtime fires → viewers see new video
- Env vars: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`

### 2b. `render-update-status` — heartbeat only
- File: `webapp/supabase/functions/render-update-status/index.ts`
- Lightweight: progress updates + cancel signal only
- No Mux logic
- On `status: completed`: call `render-confirm-upload` internally

### 2c. `get-published-project` — watch page data + auto-render trigger
- File: `webapp/supabase/functions/get-published-project/index.ts`
- No auth required (public endpoint, uses service role)
- Flow:
  1. Query project + active shared_video (`is_deleted = false`)
  2. If no project or `share_policy = 'private'` → 404
  3. If `share_policy = 'password'` → verify password against `share_password_hash`
  4. If no active `shared_videos` row → create one + auto-trigger render → return `{ status: 'processing' }`
  5. If `mux_playback_id IS NULL` → auto-trigger render → return `{ status: 'processing' }`
  6. If `sv.cloud_version < p.cloud_version` → auto-trigger render → return `{ status: 'ready', mux_playback_id, stale: true }`
  7. If current → return `{ status: 'ready', mux_playback_id, stale: false }`
  8. Always include: `project_name`, `description`, `cloud_version`, `published_at`

### 2d. `delete-shared-video` (new) — owner removes share entirely
- New file: `webapp/supabase/functions/delete-shared-video/index.ts`
- Auth: user JWT via `withAuth`
- Sets `share_policy = 'private'` on project
- Marks active `shared_videos` row as `is_deleted = true`
- Cron cleans up Mux asset later
- Use this when owner wants to fully remove the video, not just hide it

### 2e. `purge-deleted-shared-videos` (new) — cron cleanup
- New file: `webapp/supabase/functions/purge-deleted-shared-videos/index.ts`
- Cron: hourly via pg_cron → pg_net
- Queries `shared_videos WHERE is_deleted = true AND mux_asset_id IS NOT NULL`
- For each: `DELETE /video/v1/assets/{mux_asset_id}` (free, idempotent)
- On success or 404 → delete the row
- On failure → leave for next run
- New cron: `webapp/supabase/sql/crons/cron_purge_deleted_shared_videos.sql`

### 2f. `render-start-job` — two changes
- Support service role auth (so `get-published-project` can call it)
- Handle unique constraint violation on insert: catch error, re-query existing pending job, return it

---

## Phase 3: Render Worker — Minor Change

**File:** `render-worker/src/server.ts`

Render worker stays Mux-agnostic. Only change:
- `render-update-status` calls `render-confirm-upload` internally on completion
- Or: worker gets a second callback URL. Either way, worker has zero Mux knowledge.

**No Mux SDK, no Mux env vars on the worker.**

---

## Phase 4: ExportModal — Share Button

**File:** `webapp/src/editor/components/settings/ExportModal.tsx`

**Remove:**
- Entire `handlePublish` function — no more client-side export+upload
- "Share"/"Reshare" button that triggers export
- "Copy Link" + "Published X ago" tied to CF
- `isPublishing` state, `ShareService.shareVideo()` usage

**Add:**
- "Share" button: sets `share_policy = 'public'` + creates `shared_videos` row if needed → shows link + "Copy Link"
- If already shared (`share_policy != 'private'`): show "Copy Link" + "Unshare" option
- "Unshare": sets `share_policy = 'private'` (video stays alive, just not accessible)
- Share/unshare is instant — no render, no upload
- Server Render button stays separate (for downloading renders)

---

## Phase 5: Simplify ShareService

**File:** `webapp/src/editor/services/ShareService.ts`

**Remove:** `tus-js-client` import, `shareVideo()`, `requestUploadUrl()`, `uploadDirectToCF()`, `confirmUpload()`, all CF refs

**New/updated methods:**
- `createShare(projectId, userId)` — set `share_policy = 'public'` + insert `shared_videos` row → return share URL
- `unshare(projectId)` — set `share_policy = 'private'` (video stays, just hidden)
- `deleteShare(projectId)` — call `delete-shared-video` (soft delete video + set private)
- `getShareForProject(projectId)` — query active `shared_videos` for project
- `SharedVideo` interface: `mux_playback_id?`, `cloud_version?`, `is_deleted`, `description`

**Keep:** `getShareUrl()`, `getCurrentUserId()`, `updateSharedVideoMeta()`, cache

---

## Phase 6: Watch Page Redesign

**Install:** `@mux/mux-player-react` in webapp

**File:** `webapp/src/pages/WatchPage.tsx`

**States:**
1. **Loading** — fetching data from `get-published-project`
2. **Processing** — no video yet (first share, never rendered). Branded "preparing your video" state
3. **Ready** — video current. `<MuxPlayer playbackId={...} />`
4. **Not found** — no share, policy = private, or project deleted
5. **Password required** — show password input (future, design the state now)

**Realtime subscription:**
- Subscribe to `shared_videos` filtered by `project_id` and `is_deleted = false`
- On INSERT (new version ready): update `mux_playback_id` in state → player swaps to new video
- Works for `processing → ready` transition

**Design:**
- Remove CF Stream iframe, `getCfCustomerSubdomain()`, `VITE_CF_CUSTOMER_SUBDOMAIN`
- Mux Player handles aspect ratio natively
- Shimmer skeleton for processing state
- Keep: editable description for owners, copy link, sidebar, responsive layout

---

## Phase 7: Update Types & Dashboard

- `cloudProjectService.ts` — `ProjectListItem`: replace `cfVideoUid` with `isShared` boolean + `sharePolicy`
- `cloudStorage.ts` — update `CloudProject` type
- `ProjectCard.tsx` — update share indicator data source
- Dashboard — update accordingly

---

## Phase 8: Cleanup (deferred — do last after everything works)

**TODO:**
- Drop CF columns: `ALTER TABLE projects DROP COLUMN cf_video_uid, published_at, share_description`
- Drop `deleted_cf_streams` table
- Delete edge functions: `upload-to-stream/`, `confirm-upload/`, `delete-from-stream/`, `purge-deleted-cf-streams/`
- Delete cron: `sql/crons/cron_purge_deleted_cf_streams.sql`
- Remove env vars: `VITE_CF_CUSTOMER_SUBDOMAIN`, `CF_STREAM_API_TOKEN`, `CF_STREAM_ACCOUNT_ID`
- Keep `tus-js-client` — used by `cloudStorage.ts` for Supabase Storage uploads

---

## Key Design Decisions

### Share = instant link, render = on-demand
Clicking "Share" sets `share_policy = 'public'` and creates a `shared_videos` row. Link is instant. First viewer triggers the render.

### Policy on `projects`, video state on `shared_videos`
- `projects.share_policy` controls access: `'private'` (default), `'public'`, `'password'`, `'workspace'`
- `projects.share_password_hash` for password-protected shares
- `shared_videos` is purely the video artifact: Mux IDs, cloud_version, is_deleted, description
- Changing policy is instant — one update to `projects`. No need to copy policy during version replacement.

### Unshare vs delete
- **Unshare** = set `share_policy = 'private'`. Video + Mux asset stay alive. Re-sharing is instant.
- **Delete** = mark `shared_videos` row as `is_deleted = true` + set `share_policy = 'private'`. Cron cleans up Mux asset. Use when owner wants to permanently remove the video.

### `is_deleted` = only for Mux cleanup
NOT used for access control. Only set when:
1. A new video version replaces the old one (old row → deleted)
2. Owner explicitly deletes the shared video
3. Project itself is deleted (CASCADE)
Cron deletes the Mux asset and removes the row.

### Graceful version replacement
Old video stays playable while new version renders. New `shared_videos` row is inserted, old row marked `is_deleted`. Realtime subscription on the table fires → viewer's player swaps seamlessly.

### Partial unique index
`UNIQUE(project_id) WHERE is_deleted = FALSE` — one active video per project, multiple deleted rows pending cleanup.

### Render worker stays Mux-agnostic
Worker renders + uploads MP4 to Supabase Storage. Edge function layer handles Mux. No Mux SDK or credentials on Cloud Run.

---

## Verification

1. Click "Share" → `share_policy` set to `'public'`, link appears instantly, `shared_videos` row created with null Mux IDs
2. Visit link → "processing" state → render auto-triggers → Realtime fires → video plays
3. Edit project → visit link → old video plays → re-render auto-triggers → new row inserted, old marked deleted → video swaps
4. "Unshare" → `share_policy = 'private'`, watch page returns 404, video + Mux asset stay alive
5. "Re-share" → `share_policy = 'public'`, video instantly available again (no re-render)
6. "Delete share" → row marked `is_deleted`, cron cleans up Mux asset
7. Cron runs → deleted rows' Mux assets cleaned up, rows removed
8. Dashboard shows share indicator based on `share_policy != 'private'`
9. Deploy: edge functions need `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET`. Render worker needs zero changes.

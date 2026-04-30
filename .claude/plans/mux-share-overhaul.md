# Replace Cloudflare Stream with Mux — Share on Render

## Context

The current sharing flow requires users to manually click "Share" after export, which triggers a TUS upload from the browser to Cloudflare Stream. This is slow, unreliable (browser must stay active), and couples sharing to the client.

**New approach:** User clicks "Share" and instantly gets a link (slug-based). No render or upload needed at that moment. When someone visits the link, the system auto-triggers a render if needed. The render worker stays Mux-agnostic — edge functions handle Mux after render completion. Mux upload is tracked as a stateful job (like render_jobs) with webhook confirmation.

---

## Data Model

Two new tables with clean separation of concerns:

### `shared_videos` — share configuration (0 or 1 per project)
- Created when user clicks "Share" for the first time
- Contains: slug (for watch page URL), project_id, description
- Stable row — updated in place, never replaced
- Slug is the public-facing identifier; project_id is never leaked to viewers

### `mux_videos` — Mux upload jobs (many per project over time)
- One row per Mux upload attempt — tracks the full lifecycle like `render_jobs`
- **Status:** `pending | completed | failed`
- `pending`: Mux asset created via API, waiting for webhook confirmation
- `completed`: Mux webhook `video.asset.ready` received, `mux_playback_id` set
- `failed`: Mux webhook `video.asset.errored` received, or timed out (stale job cron)
- `is_deleted`: soft delete for version replacement / project deletion. Cron cleans up Mux asset.
- Only one active (non-deleted, completed) row per project at any time
- Atomic DB function `mux_video_start` handles dedup/cancel/insert (mirrors `render_job_start`)

---

## Core UX Flow

```
Owner clicks "Share" in editor
  -> Creates shared_videos row (slug, project_id) if none exists
  -> Owner gets link instantly: /watch/{slug}

Viewer visits /watch/{slug}
  -> get-published-project edge function:
     1. Resolve slug -> project_id via shared_videos
     2. Check share policy (future: password, workspace, etc.)
     3. Query latest completed mux_video (status = 'completed', is_deleted = false)
     4. If completed mux_video + cloud_version is current -> { status: 'ready', mux_playback_id }
     5. If completed mux_video but stale -> { status: 'ready', mux_playback_id } + silently call video-mux-upload
     6. If no completed mux_video -> call video-mux-upload -> { status: 'processing' }
  -> Watch page polls get-published-project every few seconds while processing
  -> Never leaks project_id, user_id, or internal IDs
  -> Unauthenticated viewers: just see latest completed video or "processing"
  -> Owner: richer status (rendering, uploading, processing, ready, failed)

video-mux-upload (the smart orchestrator, idempotent):
  1. Check shared_videos exists for project (never shared -> skip)
  2. Call mux_video_start DB function (handles dedup/cancel stale/insert atomically)
     - If mux_video already exists for this cloud_version -> skip (idempotent)
     - If no completed render for this cloud_version -> call render-start-job -> return { status: 'render_needed', jobId }
     - Otherwise -> insert pending mux_videos row
  3. Generate signed URL for rendered MP4 from Supabase Storage
  4. Create Mux asset: POST /video/v1/assets with { input: [{ url: signedUrl }], playback_policy: ['public'] }
  5. Update mux_videos row with mux_asset_id (status stays 'pending')
  6. Return { status: 'pending' } — completion comes via webhook

Mux webhook (video.asset.ready):
  -> video-mux-webhook edge function:
     1. Verify webhook signature
     2. Find mux_videos row by mux_asset_id
     3. Set status = 'completed', mux_playback_id = asset.playback_ids[0].id
     4. Mark old completed mux_videos for same project as is_deleted = true

Mux webhook (video.asset.errored):
  -> video-mux-webhook edge function:
     1. Find mux_videos row by mux_asset_id
     2. Set status = 'failed', error = error details

Render completes:
  -> render-update-status marks job completed, responds to worker immediately
  -> Fire-and-forget calls video-mux-upload
  -> video-mux-upload creates Mux asset, inserts pending mux_videos row
  -> Mux processes video async, sends webhook when ready

Owner clicks "Unshare":
  -> Deletes shared_videos row (or sets policy to private — TBD)
  -> Watch page returns 404 (slug not found / policy check fails)
  -> mux_videos + Mux assets stay alive — re-sharing is instant
```

---

## Phase 1: Database Migration

**New file:** `supabase/migrations/<timestamp>_mux_share.sql`

### `shared_videos` table

```sql
CREATE TABLE public.shared_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    slug TEXT NOT NULL UNIQUE,
    -- Share policy lives here for now (simple: public for everyone)
    -- Future: 'public' | 'password' | 'workspace' | 'private'
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE shared_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shares"
    ON shared_videos FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Public can read shared videos"
    ON shared_videos FOR SELECT USING (true);

-- One shared_video per project (max)
CREATE UNIQUE INDEX idx_shared_videos_project
    ON shared_videos(project_id);
```

### `mux_videos` table

```sql
CREATE TABLE public.mux_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),

    -- Mux identifiers
    mux_asset_id TEXT,                          -- set when Mux asset created (before processing)
    mux_playback_id TEXT,                       -- set by webhook when asset is ready

    cloud_version INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',      -- pending | completed | failed
    error TEXT,                                  -- error details if failed
    render_storage_path TEXT,                    -- which render MP4 was uploaded to Mux

    -- Soft delete: marked true when replaced by new version or project deleted.
    -- Cron cleans up Mux asset and removes the row.
    -- NOT used for unsharing.
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mux_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own mux videos"
    ON mux_videos FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Public can read active completed mux videos"
    ON mux_videos FOR SELECT USING (status = 'completed' AND is_deleted = FALSE);

-- One active (non-deleted) mux video per project
CREATE UNIQUE INDEX idx_mux_videos_active
    ON mux_videos(project_id) WHERE is_deleted = FALSE AND status = 'completed';

-- One pending upload per project
CREATE UNIQUE INDEX idx_mux_videos_one_pending_per_project
    ON mux_videos(project_id) WHERE status = 'pending';

-- Dedup: one mux video per project + cloud_version (prevent duplicate uploads)
CREATE UNIQUE INDEX idx_mux_videos_version_dedup
    ON mux_videos(project_id, cloud_version) WHERE status IN ('pending', 'completed');

-- Lookup by mux_asset_id for webhook handling
CREATE INDEX idx_mux_videos_asset_id
    ON mux_videos(mux_asset_id) WHERE mux_asset_id IS NOT NULL;

-- For cron cleanup
CREATE INDEX idx_mux_videos_deleted
    ON mux_videos(is_deleted) WHERE is_deleted = TRUE;
```

### New DB function: `mux_video_start` (mirrors `render_job_start`)

**File:** `supabase/sql/functions/mux_video_start.sql`

```sql
-- mux_video_start(p_project_id, p_user_id)
--
-- Atomically starts a Mux upload job:
--   1. Check shared_videos exists (never shared -> skip)
--   2. Check if completed mux_video exists for current cloud_version (cache hit)
--   3. Check if pending mux_video exists (dedup)
--   4. Check if completed render exists for current cloud_version (no render -> signal)
--   5. Cancel any stale pending mux uploads
--   6. Insert new pending mux_videos row
--
-- Mirrors render_job_start pattern.

CREATE OR REPLACE FUNCTION public.mux_video_start(
    p_project_id UUID,
    p_user_id UUID
)
RETURNS TABLE(
    mux_video_id UUID,
    status TEXT,
    is_new BOOLEAN,
    needs_render BOOLEAN,
    render_storage_path TEXT,
    cloud_version INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cloud_version INT;
    v_shared_exists BOOLEAN;
    v_existing_id UUID;
    v_existing_status TEXT;
    v_render_path TEXT;
    v_new_id UUID;
BEGIN
    -- 1. Check shared_videos exists
    SELECT EXISTS(
        SELECT 1 FROM public.shared_videos sv WHERE sv.project_id = p_project_id
    ) INTO v_shared_exists;

    IF NOT v_shared_exists THEN
        RETURN QUERY SELECT NULL::UUID, 'not_shared'::TEXT, FALSE, FALSE, NULL::TEXT, NULL::INT;
        RETURN;
    END IF;

    -- 2. Read project cloud_version
    SELECT p.cloud_version INTO v_cloud_version
    FROM public.projects p WHERE p.id = p_project_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found: %', p_project_id;
    END IF;

    -- 3. Cache hit: completed mux_video for current cloud_version
    SELECT mv.id INTO v_existing_id
    FROM public.mux_videos mv
    WHERE mv.project_id = p_project_id
      AND mv.cloud_version = v_cloud_version
      AND mv.status = 'completed'
      AND mv.is_deleted = FALSE;

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_id, 'completed'::TEXT, FALSE, FALSE, NULL::TEXT, v_cloud_version;
        RETURN;
    END IF;

    -- 4. Dedup: pending mux_video for current cloud_version
    SELECT mv.id INTO v_existing_id
    FROM public.mux_videos mv
    WHERE mv.project_id = p_project_id
      AND mv.cloud_version = v_cloud_version
      AND mv.status = 'pending';

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, FALSE, FALSE, NULL::TEXT, v_cloud_version;
        RETURN;
    END IF;

    -- 5. Check if completed render exists for this cloud_version
    SELECT rj.render_storage_path INTO v_render_path
    FROM public.render_jobs rj
    WHERE rj.project_id = p_project_id
      AND rj.cloud_version = v_cloud_version
      AND rj.status = 'completed'
    ORDER BY rj.created_at DESC
    LIMIT 1;

    IF v_render_path IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, 'needs_render'::TEXT, FALSE, TRUE, NULL::TEXT, v_cloud_version;
        RETURN;
    END IF;

    -- 6. Cancel stale pending mux uploads for this project
    UPDATE public.mux_videos mv
    SET status = 'canceled', updated_at = NOW()
    WHERE mv.project_id = p_project_id
      AND mv.status = 'pending';

    -- 7. Insert new pending mux_videos row
    INSERT INTO public.mux_videos (project_id, user_id, cloud_version, render_storage_path)
    VALUES (p_project_id, p_user_id, v_cloud_version, v_render_path)
    RETURNING mux_videos.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, 'pending'::TEXT, TRUE, FALSE, v_render_path, v_cloud_version;
END;
$$;
```

### Update `render_job_start` — versioned storage path

```sql
-- Change line 69 in render_job_start.sql:
-- FROM: v_render_storage_path := p_user_id || '/' || p_project_id || '/render.mp4';
-- TO:
v_render_storage_path := p_user_id || '/' || p_project_id || '/render_v' || v_cloud_version || '.mp4';
```

Each render gets its own file. Prevents corruption if Mux is mid-download when a new render uploads.

### New cron: `cron_mux_stale_jobs` (mirrors `cron_render_stale_jobs`)

**File:** `supabase/sql/crons/cron_mux_stale_jobs.sql`

Marks pending mux_videos as `failed` if no webhook received within 10 minutes.

```sql
SELECT cron.schedule(
    'mux-stale-jobs',
    '* * * * *',
    $$
    UPDATE public.mux_videos
    SET status = 'failed',
        error = 'Mux webhook timeout',
        updated_at = now()
    WHERE status = 'pending'
      AND updated_at < now() - interval '10 minutes';
    $$
);
```

**Do NOT drop CF columns yet** — defer to cleanup phase.

### Update DB functions (run `sql/build-functions.sh`)
- `render_job_start.sql` — versioned storage path
- `mux_video_start.sql` — NEW (above)
- `project_list.sql` — LEFT JOIN `shared_videos` to return `is_shared` boolean
- `project_get.sql` — include share info

---

## Phase 2: Edge Functions

### 2a. `video-mux-upload` (new) — the smart orchestrator

**File:** `supabase/functions/video-mux-upload/index.ts`
**Auth:** `RENDER_SECRET` (called internally by render-update-status and get-published-project)
**Idempotent:** safe to call multiple times — `mux_video_start` handles dedup

**Flow:**
1. Call `mux_video_start` DB function
   - `not_shared` -> return (project was never shared)
   - `completed` -> return (already uploaded for this version)
   - `pending` -> return (upload already in progress)
   - `needs_render` -> call `render-start-job` (service role) -> return `{ status: 'render_needed', jobId }`
   - `is_new = true` -> proceed to Mux upload
2. Generate signed URL for rendered MP4 from Supabase Storage (`render_storage_path`)
3. Create Mux asset: `POST /video/v1/assets` with `{ input: [{ url: signedUrl }], playback_policy: ['public'] }`
4. Update mux_videos row with `mux_asset_id` (status stays `pending`)
5. Return `{ status: 'pending', mux_video_id }`
6. Mux processes async — webhook will set `completed` or `failed`

**Env vars:** `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`

### 2b. `video-mux-webhook` (new) — Mux webhook receiver

**File:** `supabase/functions/video-mux-webhook/index.ts`
**Auth:** Mux webhook signature verification
**Events handled:**

**`video.asset.ready`:**
1. Extract `asset_id` from webhook payload
2. Find `mux_videos` row by `mux_asset_id` where `status = 'pending'`
3. Set `status = 'completed'`, `mux_playback_id = data.playback_ids[0].id`
4. Mark old completed mux_videos for same project as `is_deleted = true`

**`video.asset.errored`:**
1. Find `mux_videos` row by `mux_asset_id`
2. Set `status = 'failed'`, `error = data.errors.messages`

**Env vars:** `MUX_WEBHOOK_SECRET` (for signature verification)

### 2c. `render-update-status` — heartbeat + trigger Mux on completion

**File:** `supabase/functions/render-update-status/index.ts`

- Progress updates + cancel signal (unchanged)
- On `status: completed`:
  1. Update render_jobs row (existing logic)
  2. Update project's render_storage_path + render_cloud_version (existing logic)
  3. Respond to worker immediately (`{ ok: true, cancel: false }`)
  4. Fire-and-forget call to `video-mux-upload` with project_id — worker does NOT wait for this

### 2d. `get-published-project` — watch page resolver

**File:** `supabase/functions/get-published-project/index.ts`
**Auth:** None required (public endpoint, uses service role)
**Input:** `{ slug }` (NOT project_id — watch page only knows the slug)

**Flow:**
1. Resolve slug -> shared_videos row (get project_id, description)
2. If not found -> 404
3. Query project for name, cloud_version
4. Query latest active mux_video (`status = 'completed'`, `is_deleted = false`)
5. If completed mux_video + cloud_version matches project -> `{ status: 'ready', mux_playback_id }`
6. If completed mux_video but stale -> `{ status: 'ready', mux_playback_id }` + fire-and-forget `video-mux-upload`
7. If pending mux_video exists -> `{ status: 'processing' }`
8. If no mux_video at all -> call `video-mux-upload` -> `{ status: 'processing' }`
9. Return only public-safe fields: project name, description, mux_playback_id, status
10. Never leak project_id, user_id, internal IDs

### 2e. `video-mux-delete` (new) — owner fully removes shared video

**File:** `supabase/functions/video-mux-delete/index.ts`
**Auth:** user JWT via `withAuth`

- Deletes `shared_videos` row for project (removes slug, kills watch page)
- Marks all `mux_videos` rows as `is_deleted = true`
- Cron cleans up Mux assets later

### 2f. `video-mux-purge` (new) — cron cleanup

**File:** `supabase/functions/video-mux-purge/index.ts`
**Cron:** hourly via pg_cron -> pg_net

- Query `mux_videos WHERE is_deleted = true AND mux_asset_id IS NOT NULL`
- For each: `DELETE /video/v1/assets/{mux_asset_id}` (free, idempotent)
- On success or 404 -> delete the row
- On failure -> leave for next run
- Also clean up old versioned render MP4s from Supabase Storage

**New cron:** `supabase/sql/crons/cron_video_mux_purge.sql`

### 2g. `render-start-job` — support service role auth

**File:** `supabase/functions/render-start-job/index.ts`

- Add service role auth path: if called with service role key (from video-mux-upload or get-published-project), skip Pro subscription check
- User JWT auth still works as before (from ExportModal)
- Already idempotent via render_job_start DB function

---

## Phase 3: Render Worker — No Changes

**Render worker stays completely Mux-agnostic.** No code changes needed.

The Mux trigger happens in the edge function layer:
- Worker reports completion to `render-update-status`
- `render-update-status` responds immediately, then fire-and-forget calls `video-mux-upload`
- Worker has zero knowledge of Mux, shared_videos, or mux_videos

---

## Phase 4: ExportModal — Share Button

**File:** `webapp/src/editor/components/settings/ExportModal.tsx`

**Remove:**
- `handlePublish` function (client-side export + CF upload)
- "Share"/"Reshare" button that triggers export
- "Copy Link" + "Published X ago" tied to CF
- `isPublishing` state, `ShareService.shareVideo()` usage

**Add:**
- "Share" button: creates `shared_videos` row (generates slug) -> shows link + "Copy Link" instantly
- If already shared: show "Copy Link" + "Unshare" option
- "Unshare": deletes `shared_videos` row (or sets policy to private — TBD based on future policy needs)
- Share/unshare is instant — no render, no upload
- Server Render button stays separate (for downloading renders)

---

## Phase 5: Simplify ShareService

**File:** `webapp/src/editor/services/ShareService.ts`

**Remove:** `tus-js-client` import, `shareVideo()`, `requestUploadUrl()`, `uploadDirectToCF()`, `confirmUpload()`, all CF refs

**New/updated methods:**
- `createShare(projectId, userId)` — insert `shared_videos` row with generated slug -> return share URL (`/watch/{slug}`)
- `unshare(projectId)` — delete `shared_videos` row (or set policy)
- `getShareForProject(projectId)` — query `shared_videos` for project
- `getShareUrl(slug)` — build watch URL from slug
- `SharedVideo` interface: `slug`, `description`, `project_id`

---

## Phase 6: Watch Page Redesign

**Install:** `@mux/mux-player-react` in webapp

**File:** `webapp/src/pages/WatchPage.tsx`

**URL:** `/watch/:slug` (not project_id)

**States:**
1. **Loading** — fetching data from `get-published-project` (by slug)
2. **Processing** — no video yet (first share, or render/upload in progress). Show branded "preparing your video" loader. Poll `get-published-project` every few seconds until ready.
3. **Ready** — video available. `<MuxPlayer playbackId={...} />`
4. **Not found** — slug doesn't exist or project deleted
5. **Failed** — Mux upload failed (owner-only visibility, option to retry)

**Polling (not Realtime):**
- While `status = 'processing'`: poll `get-published-project` every ~5 seconds
- When response changes to `status = 'ready'` with `mux_playback_id`: show player
- No live swap mid-playback for unauthenticated viewers — just show whatever's available on page load

**Owner vs viewer experience:**
- **Unauthenticated viewer:** sees latest completed video or "processing" loader. No version info, no status details.
- **Owner (authenticated):** richer status — "rendering video...", "uploading to Mux...", "ready", "failed (retry)". Can see which cloud_version is live vs current.

**Design:**
- Remove CF Stream iframe, `getCfCustomerSubdomain()`, `VITE_CF_CUSTOMER_SUBDOMAIN`
- Mux Player handles aspect ratio natively
- Keep: editable description for owners, copy link, sidebar, responsive layout

---

## Phase 7: Update Types & Dashboard

- `cloudProjectService.ts` — `ProjectListItem`: replace `cfVideoUid` with `isShared` boolean
- `cloudStorage.ts` — update `CloudProject` type
- `ProjectCard.tsx` — update share indicator data source
- `project_list.sql` — LEFT JOIN shared_videos to derive `is_shared`

---

## Phase 8: Cleanup (deferred — do last after everything works)

**TODO:**
- Drop CF columns: `ALTER TABLE projects DROP COLUMN cf_video_uid, published_at, share_description`
- Drop `deleted_cf_streams` table
- Delete edge functions: `upload-to-stream/`, `confirm-upload/`, `delete-from-stream/`, `purge-deleted-cf-streams/`
- Delete cron: `sql/crons/cron_purge_deleted_cf_streams.sql`
- Remove env vars: `VITE_CF_CUSTOMER_SUBDOMAIN`, `CF_STREAM_API_TOKEN`, `CF_STREAM_ACCOUNT_ID`
- Clean up old `render.mp4` files (non-versioned) from Supabase Storage
- Keep `tus-js-client` — used by `cloudStorage.ts` for Supabase Storage uploads

---

## Key Design Decisions

### Two tables, clean separation
- `shared_videos` = share configuration (slug, policy, description). Stable, updated in place. One per project max.
- `mux_videos` = Mux upload jobs (asset IDs, cloud_version, status). Stateful lifecycle like render_jobs. One active completed per project.

### Mux upload as a tracked job (like render_jobs)
`mux_videos` follows the same pattern as `render_jobs`:
- Atomic DB function (`mux_video_start`) handles cache hit / dedup / cancel stale / insert
- States: `pending` (asset created, awaiting Mux processing) -> `completed` (webhook received) or `failed` (error/timeout)
- Stale job cron marks timed-out pending uploads as `failed` (10 min timeout)
- Partial unique indexes enforce one pending and one active completed per project

### Mux webhooks for confirmation
Mux asset creation returns immediately but processing is async. We use webhooks:
- `video.asset.ready` -> mark completed, set playback_id, mark old version deleted
- `video.asset.errored` -> mark failed with error details
- Webhook signature verification for security

### `video-mux-upload` as the smart orchestrator
Single idempotent function. Two entry points:
1. `render-update-status` calls it on render completion (fire-and-forget)
2. `get-published-project` calls it when watch page needs a video

It handles: cache hit (skip), dedup (skip), needs render (trigger), ready to upload (create Mux asset).

### Watch page: polling, not Realtime swapping
- No live video swap mid-playback
- Unauthenticated: show latest completed video or "processing" with polling
- Owner: richer status details
- Stale video stays visible — silent re-render in background, next page load shows new version

### Slug-based watch URLs
`/watch/{slug}` — never exposes project_id. `get-published-project` resolves slug, returns only public-safe fields.

### Share = instant link, render = on-demand
Clicking "Share" creates a `shared_videos` row with a slug. Link is instant. First viewer triggers render + Mux upload via `video-mux-upload`.

### Versioned render storage paths
`{userId}/{projectId}/render_v{cloudVersion}.mp4` — each render gets its own file. Prevents corruption if Mux is downloading while a new render uploads to the same path.

### Only upload to Mux if shared
Cost savings: projects that were never shared (no `shared_videos` row) never upload to Mux, even after render. `mux_video_start` checks for shared_videos existence first.

### Render worker stays Mux-agnostic
Worker renders + uploads MP4 to Supabase Storage. Edge function layer handles Mux. No Mux SDK or credentials on Cloud Run.

---

## Verification

1. Click "Share" -> `shared_videos` row created with slug, link appears instantly, no render triggered
2. Visit `/watch/{slug}` -> "processing" -> render auto-triggers -> render completes -> Mux upload starts -> webhook fires -> poll picks up `ready` -> video plays
3. Edit project -> visit link -> old video plays -> re-render triggers silently -> new mux_video pending -> webhook completes -> next page load shows new version
4. "Unshare" -> watch page returns 404, mux_videos + Mux assets stay alive
5. "Re-share" -> watch page works again instantly (no re-render if version unchanged)
6. "Delete share" -> shared_videos row removed, mux_videos marked deleted, cron cleans up
7. Cron (mux-stale-jobs) -> pending mux_videos with no webhook after 10min marked failed
8. Cron (video-mux-purge) -> deleted rows' Mux assets cleaned up, rows removed
9. Mux webhook error -> mux_video marked failed, owner sees error + retry option
10. Idempotency: calling video-mux-upload twice for same cloud_version -> second call is no-op (dedup in mux_video_start)
11. Deploy: edge functions need `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`. Render worker needs zero changes.

---

## Key Files to Modify

| File | Change |
|------|--------|
| `supabase/sql/functions/render_job_start.sql` | Versioned storage path |
| `supabase/sql/functions/mux_video_start.sql` | NEW: atomic mux upload job start (mirrors render_job_start) |
| `supabase/sql/functions/project_list.sql` | LEFT JOIN shared_videos for is_shared |
| `supabase/sql/functions/project_get.sql` | Include share info |
| `supabase/sql/crons/cron_mux_stale_jobs.sql` | NEW: timeout pending mux uploads (mirrors cron_render_stale_jobs) |
| `supabase/sql/crons/cron_video_mux_purge.sql` | NEW: hourly Mux asset cleanup |
| `supabase/functions/video-mux-upload/index.ts` | NEW: orchestrator |
| `supabase/functions/video-mux-webhook/index.ts` | NEW: Mux webhook receiver |
| `supabase/functions/video-mux-delete/index.ts` | NEW: owner delete |
| `supabase/functions/video-mux-purge/index.ts` | NEW: cron cleanup |
| `supabase/functions/render-update-status/index.ts` | Fire-and-forget video-mux-upload on completion |
| `supabase/functions/render-start-job/index.ts` | Service role auth path |
| `supabase/functions/get-published-project/index.ts` | Rewrite: slug resolver + auto-trigger |
| `webapp/src/editor/components/settings/ExportModal.tsx` | Replace share UI |
| `webapp/src/editor/services/ShareService.ts` | Remove CF, add shared_videos |
| `webapp/src/pages/WatchPage.tsx` | Rewrite with MuxPlayer + polling |

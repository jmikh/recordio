-- shared_videos: share configuration (0 or 1 per project)
-- Contains slug for public video page URL. No public read policy.

CREATE TABLE IF NOT EXISTS public.shared_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    slug TEXT NOT NULL UNIQUE,
    policy TEXT NOT NULL DEFAULT 'public',       -- 'public' | 'private' (future: 'password', 'workspace')
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE shared_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shares"
    ON shared_videos FOR ALL USING (auth.uid() = user_id);

-- One shared_video per project (max)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_videos_project
    ON shared_videos(project_id);


-- mux_videos: Mux upload jobs (many per project over time)
-- Tracks full lifecycle like render_jobs: pending -> completed | failed

CREATE TABLE IF NOT EXISTS public.mux_videos (
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

-- One active (non-deleted, completed) mux video per project
CREATE UNIQUE INDEX IF NOT EXISTS idx_mux_videos_active
    ON mux_videos(project_id) WHERE is_deleted = FALSE AND status = 'completed';

-- One pending upload per project
CREATE UNIQUE INDEX IF NOT EXISTS idx_mux_videos_one_pending_per_project
    ON mux_videos(project_id) WHERE status = 'pending';

-- Dedup: one mux video per project + cloud_version (prevent duplicate uploads)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mux_videos_version_dedup
    ON mux_videos(project_id, cloud_version) WHERE status IN ('pending', 'completed');

-- Lookup by mux_asset_id for webhook handling
CREATE INDEX IF NOT EXISTS idx_mux_videos_asset_id
    ON mux_videos(mux_asset_id) WHERE mux_asset_id IS NOT NULL;

-- For cron cleanup
CREATE INDEX IF NOT EXISTS idx_mux_videos_deleted
    ON mux_videos(is_deleted) WHERE is_deleted = TRUE;

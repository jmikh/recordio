-- Recreate render pipeline tables from scratch.
-- None of these tables are in production yet, so we drop and rebuild cleanly.

-- ============================================================
-- 1. Drop existing tables (CASCADE removes dependent objects)
-- ============================================================
DROP TABLE IF EXISTS public.mux_videos CASCADE;
DROP TABLE IF EXISTS public.render_jobs CASCADE;
DROP TABLE IF EXISTS public.shared_videos CASCADE;

-- ============================================================
-- 2. Recreate render_jobs
-- ============================================================
CREATE TABLE public.render_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    cloud_version INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed', 'canceled')),
    progress REAL DEFAULT 0,
    render_storage_path TEXT,
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

-- User's jobs list
CREATE INDEX idx_render_jobs_user_created
    ON public.render_jobs (user_id, created_at DESC);

-- Dedup/cache lookups
CREATE INDEX idx_render_jobs_project_version_status
    ON public.render_jobs (project_id, cloud_version, status);

-- Max one completed render per version
CREATE UNIQUE INDEX idx_render_jobs_one_completed_per_version
    ON public.render_jobs (project_id, cloud_version)
    WHERE status = 'completed';

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own render jobs"
    ON public.render_jobs FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- 3. Recreate shared_videos
-- ============================================================
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

-- One share per project
CREATE UNIQUE INDEX idx_shared_videos_one_per_project
    ON public.shared_videos (project_id);

ALTER TABLE public.shared_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shared videos"
    ON public.shared_videos FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 4. Recreate mux_videos
-- ============================================================
CREATE TABLE public.mux_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    cloud_version INT NOT NULL,
    attempt INT NOT NULL DEFAULT 1,
    mux_asset_id TEXT,
    mux_playback_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed', 'canceled')),
    error TEXT,
    render_storage_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (project_id, cloud_version) — unconditional
CREATE UNIQUE INDEX idx_mux_videos_project_version
    ON public.mux_videos (project_id, cloud_version);

-- Webhook lookup by mux_asset_id
CREATE INDEX idx_mux_videos_asset_id
    ON public.mux_videos (mux_asset_id)
    WHERE mux_asset_id IS NOT NULL;

ALTER TABLE public.mux_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own mux videos"
    ON public.mux_videos FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

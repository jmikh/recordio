-- ============================================================================
-- Projects table + user_quotas + user_assets + supporting functions
-- ============================================================================

-- 1. Projects table
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Untitled',
    project_data JSONB NOT NULL,

    -- Media storage paths in Supabase Storage bucket
    -- NULL = media doesn't exist, 'pending' = exists locally but not uploaded yet
    screen_storage_path TEXT,
    camera_storage_path TEXT,
    mic_storage_path TEXT,
    thumbnail_storage_path TEXT,

    -- Byte sizes of uploaded media (for quota tracking)
    screen_size_bytes BIGINT DEFAULT 0,
    camera_size_bytes BIGINT DEFAULT 0,
    mic_size_bytes BIGINT DEFAULT 0,

    -- Upload tracking: 'pending' | 'ready'
    upload_status TEXT NOT NULL DEFAULT 'pending',

    -- Published video (replaces old shared_videos table)
    cf_video_uid TEXT,
    published_at TIMESTAMPTZ,
    share_description TEXT DEFAULT '',

    -- Sync
    cloud_version INT NOT NULL DEFAULT 1,
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_projects_user_updated
    ON public.projects(user_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_user_accessed
    ON public.projects(user_id, last_accessed_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_expires
    ON public.projects(expires_at)
    WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects"
    ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own projects"
    ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own projects"
    ON public.projects FOR UPDATE USING (auth.uid() = user_id);

-- 2. User assets table (global backgrounds & music library)
CREATE TABLE IF NOT EXISTS public.user_assets (
    id TEXT NOT NULL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL,  -- 'background' | 'music'
    storage_path TEXT NOT NULL,
    name TEXT,
    size_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_assets_user
    ON public.user_assets(user_id, asset_type);

ALTER TABLE public.user_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own assets"
    ON public.user_assets USING (auth.uid() = user_id);

-- 3. User quotas table
CREATE TABLE IF NOT EXISTS public.user_quotas (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_limit_bytes BIGINT NOT NULL DEFAULT 26843545600,  -- 25 GB
    max_projects INT NOT NULL DEFAULT 50
);

ALTER TABLE public.user_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quotas"
    ON public.user_quotas FOR SELECT USING (auth.uid() = user_id);

-- 4. Update handle_new_user to also create user_quotas row
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Create trialing subscription (7-day free trial)
    INSERT INTO public.subscriptions (user_id, status, current_period_end, cancel_at_period_end, updated_at)
    VALUES (new.id, 'trialing', now() + interval '7 days', true, now());

    -- Create default storage quota
    INSERT INTO public.user_quotas (user_id)
    VALUES (new.id);

    RETURN new;
END;
$$;

-- 5. Storage quota function
CREATE OR REPLACE FUNCTION public.get_user_storage_bytes(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(SUM(screen_size_bytes + camera_size_bytes + mic_size_bytes), 0)
    FROM public.projects
    WHERE user_id = p_user_id
      AND deleted_at IS NULL
      AND upload_status != 'deleting';
$$;

-- 6. Project expiry function (called from Stripe webhook)
CREATE OR REPLACE FUNCTION public.set_project_expiry(p_user_id UUID, p_expires_at TIMESTAMPTZ)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE public.projects
    SET expires_at = p_expires_at
    WHERE user_id = p_user_id AND deleted_at IS NULL;
$$;

-- 7. Cron function: soft-delete expired projects (runs daily)
CREATE OR REPLACE FUNCTION public.cleanup_expired_projects()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.projects
    SET deleted_at = NOW()
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW()
      AND deleted_at IS NULL;
END;
$$;

-- 8. Schedule the expired projects cleanup cron (daily at midnight UTC)
SELECT cron.unschedule('cleanup-expired-projects')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-projects');

SELECT cron.schedule(
    'cleanup-expired-projects',
    '0 0 * * *',
    $$SELECT public.cleanup_expired_projects()$$
);

-- 9. Grant permissions
GRANT ALL ON TABLE public.projects TO anon;
GRANT ALL ON TABLE public.projects TO authenticated;
GRANT ALL ON TABLE public.projects TO service_role;

GRANT ALL ON TABLE public.user_assets TO anon;
GRANT ALL ON TABLE public.user_assets TO authenticated;
GRANT ALL ON TABLE public.user_assets TO service_role;

GRANT ALL ON TABLE public.user_quotas TO anon;
GRANT ALL ON TABLE public.user_quotas TO authenticated;
GRANT ALL ON TABLE public.user_quotas TO service_role;

GRANT ALL ON FUNCTION public.get_user_storage_bytes(UUID) TO anon;
GRANT ALL ON FUNCTION public.get_user_storage_bytes(UUID) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_storage_bytes(UUID) TO service_role;

GRANT ALL ON FUNCTION public.set_project_expiry(UUID, TIMESTAMPTZ) TO anon;
GRANT ALL ON FUNCTION public.set_project_expiry(UUID, TIMESTAMPTZ) TO authenticated;
GRANT ALL ON FUNCTION public.set_project_expiry(UUID, TIMESTAMPTZ) TO service_role;

GRANT ALL ON FUNCTION public.cleanup_expired_projects() TO anon;
GRANT ALL ON FUNCTION public.cleanup_expired_projects() TO authenticated;
GRANT ALL ON FUNCTION public.cleanup_expired_projects() TO service_role;

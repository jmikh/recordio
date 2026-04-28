-- Render jobs table for tracking server-side render requests.
-- Workers update status/progress; clients subscribe via Realtime.
--
-- Status: pending | completed | failed | canceled
-- Progress alone tracks in-flight work (no phase column).

CREATE TABLE IF NOT EXISTS public.render_jobs (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    quality TEXT NOT NULL,
    cloud_version INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | completed | failed | canceled
    progress REAL DEFAULT 0,                 -- 0.0 to 1.0
    output_storage_path TEXT,                -- pre-computed by edge function
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_render_jobs_user
    ON public.render_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_render_jobs_project
    ON public.render_jobs(project_id, created_at DESC);

-- Dedup/cache lookups: find jobs by project + cloud_version + status
CREATE INDEX IF NOT EXISTS idx_render_jobs_dedup
    ON public.render_jobs(project_id, cloud_version, status);

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own render jobs"
    ON public.render_jobs FOR SELECT USING (auth.uid() = user_id);

GRANT ALL ON TABLE public.render_jobs TO service_role;
GRANT SELECT ON TABLE public.render_jobs TO authenticated;

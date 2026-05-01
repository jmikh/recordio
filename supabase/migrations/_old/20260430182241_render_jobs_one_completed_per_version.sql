-- Only one completed render per (project, cloud_version).
CREATE UNIQUE INDEX IF NOT EXISTS idx_render_jobs_one_completed_per_version
    ON public.render_jobs(project_id, cloud_version)
    WHERE status = 'completed';

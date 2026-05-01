-- Enforce at most one pending render job per project.
-- The render_job_start() function cancels stale pending jobs before inserting,
-- so this index is a safety net against race conditions, not the primary mechanism.

CREATE UNIQUE INDEX IF NOT EXISTS idx_render_jobs_one_pending_per_project
    ON public.render_jobs(project_id)
    WHERE status = 'pending';

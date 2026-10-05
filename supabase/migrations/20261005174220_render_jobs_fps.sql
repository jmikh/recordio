-- Render frame rate (30/60 fps): jobs are now cached/deduped per
-- (project_id, cloud_version, quality, fps), so the requested frame rate
-- must be part of the row. Existing rows were all rendered at 30 fps.
-- The CHECK is inline so it's skipped together with the column on re-run.
ALTER TABLE public.render_jobs
    ADD COLUMN IF NOT EXISTS fps SMALLINT NOT NULL DEFAULT 30
        CONSTRAINT render_jobs_fps_check CHECK (fps IN (30, 60));

-- One completed render per (project, version, quality, fps): add fps to the
-- index so a 60 fps render can complete alongside a 30 fps one at the same
-- quality. This only RELAXES the constraint, so existing rows cannot conflict.
DROP INDEX IF EXISTS public.idx_render_jobs_one_completed_per_version;

CREATE UNIQUE INDEX IF NOT EXISTS idx_render_jobs_one_completed_per_version
    ON public.render_jobs USING btree (project_id, cloud_version, quality, fps)
    WHERE (status = 'completed'::text);

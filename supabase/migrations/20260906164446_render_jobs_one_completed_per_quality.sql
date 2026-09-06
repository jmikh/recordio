-- Multi-resolution renders: a completed render now exists per
-- (project_id, cloud_version, QUALITY), not just per (project_id,
-- cloud_version). The old partial unique index omitted quality, so
-- completing a second quality for the same version tripped
-- "duplicate key value violates unique constraint
-- idx_render_jobs_one_completed_per_version". Add quality to the index
-- to match the get-or-create dedup key. This only RELAXES the
-- constraint, so existing rows cannot conflict.
DROP INDEX IF EXISTS public.idx_render_jobs_one_completed_per_version;

CREATE UNIQUE INDEX idx_render_jobs_one_completed_per_version
    ON public.render_jobs USING btree (project_id, cloud_version, quality)
    WHERE (status = 'completed'::text);

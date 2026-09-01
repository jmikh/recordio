-- Render quality selection (1080p/2K/4K): jobs are cached/deduped per
-- (project_id, cloud_version, quality), so the requested quality must be
-- part of the row. Existing rows were all rendered at 1080p.
ALTER TABLE public.render_jobs
    ADD COLUMN IF NOT EXISTS quality TEXT NOT NULL DEFAULT '1080p';

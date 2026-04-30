-- Drop unused quality column and rename output_storage_path to render_storage_path
-- to match the projects table naming convention.

ALTER TABLE public.render_jobs DROP COLUMN IF EXISTS quality;
ALTER TABLE public.render_jobs RENAME COLUMN output_storage_path TO render_storage_path;

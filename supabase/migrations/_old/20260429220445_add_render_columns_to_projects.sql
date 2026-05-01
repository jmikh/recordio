-- Add render result columns to projects table.
-- Set on render completion so the app can quickly check
-- if a current render exists without querying render_jobs.

ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS render_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS render_cloud_version INT;

-- Add duration tracking columns to render_jobs.
-- download/render/upload durations are reported by the worker.
-- start and total durations are computed by the edge function.

ALTER TABLE public.render_jobs
    ADD COLUMN IF NOT EXISTS video_duration_s REAL,
    ADD COLUMN IF NOT EXISTS start_duration_s REAL,
    ADD COLUMN IF NOT EXISTS download_duration_s REAL,
    ADD COLUMN IF NOT EXISTS render_duration_s REAL,
    ADD COLUMN IF NOT EXISTS upload_duration_s REAL,
    ADD COLUMN IF NOT EXISTS total_duration_s REAL;

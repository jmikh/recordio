-- Update unique constraints to reflect new statuses: rendering, uploading, completed

-- One in-progress mux video per project (was: pending)
DROP INDEX IF EXISTS idx_mux_videos_one_pending_per_project;
CREATE UNIQUE INDEX idx_mux_videos_one_active_per_project
    ON public.mux_videos(project_id)
    WHERE status IN ('rendering', 'uploading');

-- Dedup: one mux video per project + cloud_version in active states (was: pending, completed)
DROP INDEX IF EXISTS idx_mux_videos_version_dedup;
CREATE UNIQUE INDEX idx_mux_videos_version_dedup
    ON public.mux_videos(project_id, cloud_version)
    WHERE status IN ('rendering', 'uploading', 'completed');

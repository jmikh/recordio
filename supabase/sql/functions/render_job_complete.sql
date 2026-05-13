-- render_job_complete(p_job_id, p_status, p_error)
--
-- Sets a render job to a terminal state (completed, failed, canceled)
-- and cascades failures to mux_videos by (project_id, cloud_version).
--
-- On completed: NO cascade — render-job-hook handles Mux upload directly
-- On failed/canceled: mark pending mux_videos for same (project_id, cloud_version) as failed
--
-- Called by: render-job-hook, stale job cron
-- Tables:   render_jobs, mux_videos

DROP FUNCTION IF EXISTS public.render_job_complete(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.render_job_complete(
    p_job_id UUID,
    p_status TEXT,        -- 'completed' | 'failed' | 'canceled'
    p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_id UUID;
    v_cloud_version INT;
BEGIN
    -- 1. Update render job and capture project_id + cloud_version
    UPDATE public.render_jobs
    SET status = p_status,
        error = p_error,
        updated_at = NOW()
    WHERE id = p_job_id
      AND status = 'pending'
    RETURNING project_id, cloud_version INTO v_project_id, v_cloud_version;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- 2. On failure/cancel: cascade to pending mux_videos by (project_id, cloud_version)
    IF p_status IN ('failed', 'canceled') THEN
        UPDATE public.mux_videos
        SET status = 'failed',
            error = COALESCE(p_error, 'Render ' || p_status),
            updated_at = NOW()
        WHERE project_id = v_project_id
          AND cloud_version = v_cloud_version
          AND status = 'pending';
    END IF;
END;
$$;

-- Service-role only — called by render-job-hook edge function and stale job cron
REVOKE ALL ON FUNCTION public.render_job_complete(UUID, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.render_job_complete(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.render_job_complete(UUID, TEXT, TEXT) FROM authenticated;

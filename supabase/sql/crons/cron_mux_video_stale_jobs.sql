-- cron_mux_video_stale_jobs
--
-- Every-minute cron that marks pending mux_videos as failed based on their
-- corresponding render_job status:
--
--   1. Render failed/canceled + mux pending for 5s:
--      render_job_complete should have cascaded the failure. If the mux_video
--      is still pending after 5 seconds, the cascade didn't fire — clean up.
--
--   2. Render completed + mux pending for 5min:
--      The Mux upload should have started (via render-hook or mux-video-create).
--      If 5 minutes passed, the upload or webhook silently failed.
--
-- Schedule: every minute
-- Pattern:  A (pure SQL, no edge function needed)

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('mux-video-stale-jobs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mux-video-stale-jobs');

SELECT cron.schedule(
    'mux-video-stale-jobs',
    '* * * * *',
    $$
    UPDATE public.mux_videos mv
    SET status = 'failed',
        error = CASE
            WHEN rj.status IN ('failed', 'canceled') THEN 'Render ' || rj.status
            ELSE 'Mux upload/webhook timeout'
        END,
        updated_at = now()
    FROM public.render_jobs rj
    WHERE mv.status = 'pending'
      AND rj.project_id = mv.project_id
      AND rj.cloud_version = mv.cloud_version
      AND (
        (rj.status IN ('failed', 'canceled') AND mv.updated_at < now() - interval '5 seconds')
        OR
        (rj.status = 'completed' AND mv.updated_at < now() - interval '5 minutes')
      );
    $$
);

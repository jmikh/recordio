-- cron_mux_video_stale_jobs
--
-- Every-minute cron that marks pending mux_videos as failed if no Mux webhook
-- received within 10 minutes (after mux_asset_id has been set, meaning upload started).
-- Pending mux_videos without mux_asset_id are waiting for render — handled by
-- the render stale jobs cron via cascade through render_job_complete.
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
    UPDATE public.mux_videos
    SET status = 'failed',
        error = 'Mux webhook timeout',
        updated_at = now()
    WHERE status = 'pending'
      AND mux_asset_id IS NOT NULL
      AND updated_at < now() - interval '15 minutes';
    $$
);

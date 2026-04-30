-- cron_mux_video_stale_jobs
--
-- Every-minute cron that marks pending mux_videos as failed if no webhook
-- received within 10 minutes.
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
      AND updated_at < now() - interval '10 minutes';
    $$
);

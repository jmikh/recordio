-- cron_render_stale_jobs
--
-- Every-minute cron that marks pending render jobs as failed if no heartbeat
-- in 1 minute (4+ missed 15-second heartbeats from the worker).
--
-- Schedule: every minute
-- Pattern:  A (pure SQL, no edge function needed)

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('render-stale-jobs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'render-stale-jobs');

SELECT cron.schedule(
    'render-stale-jobs',
    '* * * * *',
    $$
    UPDATE public.render_jobs
    SET status = 'failed',
        error = 'Worker unresponsive',
        updated_at = now()
    WHERE status = 'pending'
      AND updated_at < now() - interval '1 minute';
    $$
);

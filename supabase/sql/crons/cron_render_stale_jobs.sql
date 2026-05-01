-- cron_render_stale_jobs
--
-- Every-minute cron that marks pending render jobs as failed if no heartbeat
-- in 1 minute (4+ missed 15-second heartbeats from the worker).
-- Uses render_job_complete to cascade failure to linked mux_videos.
--
-- Schedule: every minute
-- Pattern:  A (pure SQL, no edge function needed)

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('render-jobs-stale-cleanup')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'render-jobs-stale-cleanup');

SELECT cron.schedule(
    'render-jobs-stale-cleanup',
    '* * * * *',
    $$
    SELECT public.render_job_complete(rj.id, 'failed', 'Worker unresponsive')
    FROM public.render_jobs rj
    WHERE rj.status = 'pending'
      AND rj.updated_at < now() - interval '1 minute';
    $$
);

-- cron_render_stale_jobs
--
-- Every-minute cron that marks pending render jobs as failed if no heartbeat
-- in 1 minute (4+ missed 15-second heartbeats from the worker).
-- Inlines the complete-and-cascade logic (was render_job_complete() until
-- the 2026-07-25 sweep — the server's render-job-webhook runs the same CTE
-- inline): terminal the pending job, cascade the failure to any pending
-- mux_videos at the same (project_id, cloud_version).
--
-- The cascade is gated to the Mux render quality ('2K' = 1440p, mirrors
-- MUX_RENDER_QUALITY in server/src/services/muxUpload.ts): a mux_video
-- tracks its own 2K render, so a stale render at another quality (e.g. a
-- 1080p download export for the same version) must not fail it.
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
    WITH stale AS (
        UPDATE public.render_jobs rj
        SET status = 'failed',
            error = 'Worker unresponsive',
            updated_at = now()
        WHERE rj.status = 'pending'
          AND rj.updated_at < now() - interval '1 minute'
        RETURNING rj.project_id, rj.cloud_version, rj.quality
    )
    UPDATE public.mux_videos mv
    SET status = 'failed',
        error = 'Worker unresponsive',
        updated_at = now()
    FROM stale
    WHERE mv.project_id = stale.project_id
      AND mv.cloud_version = stale.cloud_version
      AND stale.quality = '2K'
      AND mv.status = 'pending';
    $$
);

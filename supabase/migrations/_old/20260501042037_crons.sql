-- Auto-generated from sql/crons/*.sql
-- Run sql/build-functions.sh to regenerate
-- 2026-05-01 04:20:36 UTC

-- ============================================================
-- Source: cron_cleanup_expired_projects.sql
-- ============================================================
-- cron_cleanup_expired_projects()
--
-- Daily cron job that soft-deletes projects past their expires_at.
-- A separate edge function handles actual Storage file + CF Stream cleanup.
--
-- Schedule: daily at midnight UTC
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.cleanup_expired_projects()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.projects
    SET deleted_at = NOW()
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW()
      AND deleted_at IS NULL;
END;
$$;

-- ============================================================
-- Source: cron_cleanup_pending_assets.sql
-- ============================================================
-- cron_cleanup_pending_assets
--
-- Daily cron that deletes user_assets rows stuck in 'pending' status
-- for over 1 hour. These are orphans from clients that crashed between
-- getting a signed upload URL and confirming the upload.
--
-- The corresponding storage blobs (if any were uploaded) are left for
-- storage lifecycle rules to clean up.
--
-- Schedule: daily at midnight UTC
-- Pattern:  A (pure SQL, no edge function needed)

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('cleanup-pending-assets')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-pending-assets');

SELECT cron.schedule(
    'cleanup-pending-assets',
    '0 0 * * *',
    $$
    DELETE FROM public.user_assets
    WHERE status = 'pending'
      AND created_at < now() - interval '1 hour';
    $$
);

-- ============================================================
-- Source: cron_mux_video_purge.sql
-- ============================================================
-- cron_mux_video_purge
--
-- Hourly cron that calls the mux-video-purge edge function via pg_net.
-- The edge function deletes Mux assets for soft-deleted mux_videos rows,
-- then removes the rows.
--
-- Schedule: hourly at minute 15
-- Pattern:  B (cron → edge function via pg_net)
-- Edge fn:  functions/mux-video-purge/index.ts

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('mux-video-purge')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mux-video-purge');

SELECT cron.schedule(
    'mux-video-purge',
    '15 * * * *',
    $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/mux-video-purge',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
    );
    $$
);

-- ============================================================
-- Source: cron_mux_video_stale_jobs.sql
-- ============================================================
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

-- ============================================================
-- Source: cron_purge_deleted_cf_streams.sql
-- ============================================================
-- cron_purge_deleted_cf_streams
--
-- Daily cron that calls the purge-deleted-cf-streams edge function via pg_net.
-- The edge function processes the deleted_cf_streams queue by calling
-- Cloudflare Stream DELETE API for each entry.
--
-- Schedule: daily at 4 AM UTC
-- Pattern:  B (cron → edge function via pg_net)
-- Edge fn:  functions/purge-deleted-cf-streams/index.ts

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('purge-deleted-cf-streams')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-deleted-cf-streams');

SELECT cron.schedule(
    'purge-deleted-cf-streams',
    '0 4 * * *',
    $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/purge-deleted-cf-streams',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
    );
    $$
);

-- ============================================================
-- Source: cron_purge_deleted_projects.sql
-- ============================================================
-- cron_purge_deleted_projects
--
-- Daily cron that calls the purge-deleted-projects edge function via pg_net.
-- The edge function permanently deletes projects soft-deleted for 3+ days,
-- cleaning up Supabase Storage files and queueing CF Stream videos for deletion.
--
-- Schedule: daily at 3 AM UTC
-- Pattern:  B (cron → edge function via pg_net)
-- Edge fn:  functions/purge-deleted-projects/index.ts

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('purge-deleted-projects')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-deleted-projects');

SELECT cron.schedule(
    'purge-deleted-projects',
    '0 3 * * *',
    $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/purge-deleted-projects',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
    );
    $$
);

-- ============================================================
-- Source: cron_render_purge.sql
-- ============================================================
-- cron_render_purge
--
-- Hourly cron that calls the render-purge edge function via pg_net.
-- The edge function finds render_jobs older than the highest completed version
-- per project, deletes their storage files, then deletes the rows.
--
-- Schedule: hourly at minute 25
-- Pattern:  B (cron → edge function via pg_net)
-- Edge fn:  functions/render-purge/index.ts

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('render-purge')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'render-purge');

SELECT cron.schedule(
    'render-purge',
    '25 * * * *',
    $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/render-purge',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
    );
    $$
);

-- ============================================================
-- Source: cron_render_stale_jobs.sql
-- ============================================================
-- cron_render_stale_jobs
--
-- Every-minute cron that marks pending render jobs as failed if no heartbeat
-- in 1 minute (4+ missed 15-second heartbeats from the worker).
-- Uses render_job_complete to cascade failure to linked mux_videos.
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
    SELECT public.render_job_complete(rj.id, 'failed', 'Worker unresponsive')
    FROM public.render_jobs rj
    WHERE rj.status = 'pending'
      AND rj.updated_at < now() - interval '1 minute';
    $$
);


-- Auto-generated from sql/crons/*.sql
-- Run sql/build-functions.sh to regenerate
-- 2026-05-05 03:14:06 UTC

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
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/mux-video-purge',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SECRET_KEY')
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

SELECT cron.unschedule('projects-purge-deleted')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'projects-purge-deleted');

SELECT cron.schedule(
    'projects-purge-deleted',
    '0 3 * * *',
    $$
    SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/purge-deleted-projects',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SECRET_KEY')
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

SELECT cron.unschedule('render-jobs-purge')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'render-jobs-purge');

SELECT cron.schedule(
    'render-jobs-purge',
    '25 * * * *',
    $$
    SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/render-purge',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SECRET_KEY')
        ),
        body := '{}'::jsonb
    );
    $$
);


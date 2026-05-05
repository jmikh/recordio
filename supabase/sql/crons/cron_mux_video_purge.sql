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

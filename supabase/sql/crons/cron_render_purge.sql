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

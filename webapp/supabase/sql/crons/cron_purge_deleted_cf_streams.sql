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

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

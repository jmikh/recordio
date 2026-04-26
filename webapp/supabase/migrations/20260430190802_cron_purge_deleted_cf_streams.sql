-- Add cron: purge-deleted-cf-streams (daily at 4 AM UTC)

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

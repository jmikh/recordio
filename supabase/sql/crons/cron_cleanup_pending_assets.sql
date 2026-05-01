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

SELECT cron.unschedule('assets-stale-cleanup')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'assets-stale-cleanup');

SELECT cron.schedule(
    'assets-stale-cleanup',
    '0 0 * * *',
    $$
    DELETE FROM public.user_assets
    WHERE status = 'pending'
      AND created_at < now() - interval '1 hour';
    $$
);

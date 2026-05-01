-- cron_projects_delete_expired
--
-- Daily cron job that soft-deletes projects past their expires_at.
-- A separate edge function handles actual Storage file cleanup.
--
-- Schedule: daily at midnight UTC
-- Pattern:  A (pure SQL, no edge function needed)

CREATE EXTENSION IF NOT EXISTS pg_cron;

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

SELECT cron.unschedule('projects-delete-expired')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'projects-delete-expired');

SELECT cron.schedule(
    'projects-delete-expired',
    '0 0 * * *',
    $$SELECT public.cleanup_expired_projects()$$
);

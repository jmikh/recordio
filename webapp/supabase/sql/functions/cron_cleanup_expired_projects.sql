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

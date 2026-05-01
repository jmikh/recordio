-- cron_expire_trials()
--
-- Finds all trialing subscriptions past their period end and marks them
-- as 'expired'.
--
-- Trigger: pg_cron (daily)
-- Tables:  subscriptions

CREATE OR REPLACE FUNCTION public.cron_expire_trials()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE status = 'trialing'
      AND current_period_end < now();
END;
$$;

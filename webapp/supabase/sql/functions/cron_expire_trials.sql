-- cron_expire_trials()
--
-- Finds all trialing subscriptions past their period end, marks them
-- as 'expired', and updates the user's Mixpanel profile accordingly.
--
-- Trigger: pg_cron (daily)
-- Tables:  subscriptions
-- External: Mixpanel Engage API (via pg_net)

CREATE OR REPLACE FUNCTION public.cron_expire_trials()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $_$
DECLARE
    r record;
    mp_token text := '773bc18d036f7f77ec70ec94e7eec508';
BEGIN
    -- Find all trialing subscriptions past their period end
    FOR r IN
        SELECT s.user_id, s.current_period_end
        FROM public.subscriptions s
        WHERE s.status = 'trialing'
          AND s.current_period_end < now()
    LOOP
        -- Update DB
        UPDATE public.subscriptions
        SET status = 'expired', updated_at = now()
        WHERE user_id = r.user_id;

        -- Update Mixpanel profile
        PERFORM net.http_post(
            url := 'https://api.mixpanel.com/engage#profile-set',
            body := jsonb_build_array(jsonb_build_object(
                '$token', mp_token,
                '$distinct_id', r.user_id,
                '$set', jsonb_build_object(
                    'current_plan_type', 'basic',
                    'last_active_plan_type', 'pro_trial',
                    'last_active_plan_end_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                )
            )),
            headers := '{"Content-Type": "application/json", "Accept": "text/plain"}'::jsonb
        );

        RAISE LOG '[TrialExpiry] Expired trial for user: %', r.user_id;
    END LOOP;
END;
$_$;

-- =============================================================================
-- Cron Job: Expire free trials + notify Mixpanel
-- Run in Supabase Dashboard → SQL Editor
--
-- Uses pg_cron to check every hour for expired trials, updates the DB,
-- and fires Mixpanel profile updates + plan_type_changed events via pg_net.
-- =============================================================================

-- 1. Enable extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Create the expiry function
create or replace function public.expire_trials()
returns void as $$
declare
    r record;
    mp_token text := '773bc18d036f7f77ec70ec94e7eec508';
begin
    -- Find all trialing subscriptions past their period end
    for r in
        select s.user_id, s.current_period_end
        from public.subscriptions s
        where s.status = 'trialing'
          and s.current_period_end < now()
    loop
        -- Update DB
        update public.subscriptions
        set status = 'expired', updated_at = now()
        where user_id = r.user_id;

        -- Update Mixpanel profile
        perform net.http_post(
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

        raise log '[TrialExpiry] Expired trial for user: %', r.user_id;
    end loop;
end;
$$ language plpgsql security definer;

-- 4. Schedule the cron job to run daily at midnight UTC
select cron.schedule(
    'expire-free-trials',
    '0 0 * * *',
    $$select public.expire_trials()$$
);

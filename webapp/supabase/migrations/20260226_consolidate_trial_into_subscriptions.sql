-- =============================================================================
-- Migration: Consolidate free trial into subscriptions table
-- Run in Supabase Dashboard → SQL Editor
--
-- This migration:
--   1. Migrates existing trial users from user_metadata → subscriptions
--   2. Updates the auth trigger to create a trialing subscription for new signups
--   3. Drops the free_trial_until column from user_metadata
-- =============================================================================

-- 1. Migrate existing users with active free trials into the subscriptions table.
--    Only inserts for users who don't already have a subscriptions row.
insert into public.subscriptions (user_id, status, current_period_end, cancel_at_period_end, updated_at)
select
    um.id,
    'trialing',
    um.free_trial_until,
    true,
    now()
from public.user_metadata um
where um.free_trial_until is not null
  and um.free_trial_until > now()
  and not exists (
    select 1 from public.subscriptions s where s.user_id = um.id
  );

-- 2. Mark expired trials for users who had a free trial but it's now past.
--    Again, only for users without an existing subscriptions row.
insert into public.subscriptions (user_id, status, current_period_end, cancel_at_period_end, updated_at)
select
    um.id,
    'expired',
    um.free_trial_until,
    true,
    now()
from public.user_metadata um
where um.free_trial_until is not null
  and um.free_trial_until <= now()
  and not exists (
    select 1 from public.subscriptions s where s.user_id = um.id
  );

-- 3. Update the auth trigger to only create a trialing subscription row
--    and set Mixpanel profile via pg_net.
create or replace function public.handle_new_user()
returns trigger as $$
declare
    mp_token text := '773bc18d036f7f77ec70ec94e7eec508';
    trial_end timestamptz := now() + interval '7 days';
begin
    -- Create trialing subscription (7-day free trial)
    insert into public.subscriptions (user_id, status, current_period_end, cancel_at_period_end, updated_at)
    values (new.id, 'trialing', trial_end, true, now());

    -- Set Mixpanel profile (non-blocking HTTP via pg_net)
    perform net.http_post(
        url := 'https://api.mixpanel.com/engage#profile-set',
        body := jsonb_build_array(jsonb_build_object(
            '$token', mp_token,
            '$distinct_id', new.id,
            '$set', jsonb_build_object(
                '$email', new.email,
                'current_plan_type', 'pro_trial',
                'subscription_status', 'trialing',
                'cancel_at_period_end', true,
                'current_period_end', to_char(trial_end, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'signup_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            )
        )),
        headers := '{"Content-Type": "application/json", "Accept": "text/plain"}'::jsonb
    );

    return new;
end;
$$ language plpgsql security definer;

-- 4. Drop the user_metadata table entirely (no longer needed — trial data
--    now lives in subscriptions, free credits system was retired)
drop table if exists public.user_metadata cascade;

-- 5. Drop the project_unlocks table if it still exists (legacy credit system)
drop table if exists public.project_unlocks cascade;

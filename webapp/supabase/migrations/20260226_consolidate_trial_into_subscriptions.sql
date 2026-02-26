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

-- 3. Update the auth trigger to only create a trialing subscription row.
--    (user_metadata table is being retired entirely)
create or replace function public.handle_new_user()
returns trigger as $$
begin
    -- Create trialing subscription (7-day free trial)
    insert into public.subscriptions (user_id, status, current_period_end, cancel_at_period_end, updated_at)
    values (new.id, 'trialing', now() + interval '7 days', true, now());

    return new;
end;
$$ language plpgsql security definer;

-- 4. Drop the user_metadata table entirely (no longer needed — trial data
--    now lives in subscriptions, free credits system was retired)
drop table if exists public.user_metadata cascade;

-- 5. Drop the project_unlocks table if it still exists (legacy credit system)
drop table if exists public.project_unlocks cascade;

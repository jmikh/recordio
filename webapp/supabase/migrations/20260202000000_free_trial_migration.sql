-- =============================================================================
-- Migration: Replace free credit system with 7-day free trial
-- Run in Supabase Dashboard → SQL Editor
-- =============================================================================

-- 1. Add free_trial_until column (nullable initially for safe migration)
alter table public.user_metadata
    add column free_trial_until timestamptz;

-- 2. Backfill existing users who have unused credits → give them 7-day trial from now
update public.user_metadata
    set free_trial_until = now() + interval '7 days'
    where free_credits_remaining > 0;

-- 3. Drop the old credit column
alter table public.user_metadata
    drop column free_credits_remaining;

-- 4. Set default for new users (7-day trial from signup)
alter table public.user_metadata
    alter column free_trial_until set default now() + interval '7 days';

-- 5. Drop the project_unlocks table (no longer needed)
drop table if exists public.project_unlocks;

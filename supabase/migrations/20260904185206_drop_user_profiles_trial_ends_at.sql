-- Billing revamp Step 8 — drop the now-dead user_profiles.trial_ends_at.
--
-- The trial moved onto workspaces in revamp Step 2 (20260901131117): every
-- workspace's trial_ends_at was backfilled from this column, and nothing
-- has read it since — entitlements read workspaces.trial_ends_at, and
-- /user-profile-get stopped returning it. This removes the leftover column.
-- No index/view/live-function depends on it.

ALTER TABLE public.user_profiles
    DROP COLUMN IF EXISTS trial_ends_at;

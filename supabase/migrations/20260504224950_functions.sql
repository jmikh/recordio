-- Auto-generated from sql/functions/*.sql
-- Run sql/build-functions.sh to regenerate
-- 2026-05-04 22:49:50 UTC

-- ============================================================
-- Source: user_profile_create.sql
-- ============================================================
-- user_profile_create()
--
-- Bootstraps a new user's account by creating a profile with a 7-day free trial.
-- Called by: on_user_signup_profile trigger (auth.users INSERT)
-- Tables:   user_profiles

CREATE OR REPLACE FUNCTION public.user_profile_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.user_profiles (user_id, name, trial_ends_at, updated_at)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
        now() + interval '7 days',
        now()
    );

    RETURN new;
END;
$$;


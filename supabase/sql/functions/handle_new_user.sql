-- handle_new_user()
--
-- Bootstraps a new user's account by creating a profile with a 7-day free trial.
-- Attached as an AFTER INSERT trigger on auth.users.
--
-- Trigger: auth.users INSERT trigger
-- Tables:  user_profiles

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Create user profile with 7-day free trial
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

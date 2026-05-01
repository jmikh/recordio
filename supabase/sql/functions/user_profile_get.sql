-- user_profile_get()
--
-- Returns the authenticated user's profile info (name, trial status).
-- Returns NULL if no profile exists.
--
-- Called by: webapp AuthManager.fetchProfile
-- Tables:   user_profiles

CREATE OR REPLACE FUNCTION public.user_profile_get()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT jsonb_build_object(
        'name', p.name,
        'trial_ends_at', p.trial_ends_at
    )
    FROM public.user_profiles p
    WHERE p.user_id = auth.uid();
$$;

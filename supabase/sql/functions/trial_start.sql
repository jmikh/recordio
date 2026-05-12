-- trial_start()
--
-- Starts a 7-day free Pro trial for the calling user.
-- Guards: trial_ends_at must be NULL (never started a trial before).
-- Side-effects:
--   1. Sets trial_ends_at = now() + 7 days
--   2. Clears expires_at on all non-deleted projects owned by the caller
--   3. Sends welcome email via edge function (pg_net)
--
-- Called by: client RPC
-- Tables:   user_profiles, projects

CREATE OR REPLACE FUNCTION public.trial_start()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id       UUID := auth.uid();
    v_trial_ends_at TIMESTAMPTZ;
    v_email         TEXT;
BEGIN
    SELECT trial_ends_at INTO v_trial_ends_at
    FROM public.user_profiles
    WHERE user_id = v_user_id;

    IF v_trial_ends_at IS NOT NULL THEN
        RAISE EXCEPTION 'Trial already started';
    END IF;

    UPDATE public.user_profiles
    SET trial_ends_at = now() + interval '7 days',
        updated_at    = now()
    WHERE user_id = v_user_id;

    -- Clear expires_at on all non-deleted projects owned by the caller
    UPDATE public.projects
    SET expires_at = NULL
    WHERE owner_id = v_user_id AND deleted_at IS NULL;

    SELECT email INTO v_email
    FROM auth.users
    WHERE id = v_user_id;

    IF v_email IS NOT NULL THEN
        PERFORM net.http_post(
            url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL')
                       || '/functions/v1/send-welcome-email',
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SECRET_KEY')
            ),
            body    := jsonb_build_object(
                'record', jsonb_build_object('id', v_user_id, 'email', v_email)
            )
        );
    END IF;
END;
$$;

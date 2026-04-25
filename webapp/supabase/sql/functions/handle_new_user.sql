-- handle_new_user()
--
-- Bootstraps a new user's account by creating a 7-day free trial
-- subscription and a default storage quota.
-- Attached as an AFTER INSERT trigger on auth.users.
--
-- Trigger: auth.users INSERT trigger
-- Tables:  subscriptions, user_quotas

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Create trialing subscription (7-day free trial)
    INSERT INTO public.subscriptions (user_id, status, current_period_end, cancel_at_period_end, updated_at)
    VALUES (new.id, 'trialing', now() + interval '7 days', true, now());

    -- Create default storage quota
    INSERT INTO public.user_quotas (user_id)
    VALUES (new.id);

    RETURN new;
END;
$$;

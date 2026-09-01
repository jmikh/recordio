-- on_user_signup_bootstrap
--
-- Fires after a new user signs up (INSERT on auth.users).
-- Creates the account's one workspace + profile via user_signup_bootstrap().
-- Replaces on_user_signup_create_user_profile (revamp Step 2 — dropped in
-- graveyard.sql).
--
DROP TRIGGER IF EXISTS on_user_signup_bootstrap ON auth.users;

CREATE TRIGGER on_user_signup_bootstrap
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.user_signup_bootstrap();

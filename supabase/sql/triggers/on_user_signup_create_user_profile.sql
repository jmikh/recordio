-- on_user_signup_create_user_profile
--
-- Fires after a new user signs up (INSERT on auth.users).
-- Creates the user_profiles row via user_profile_create().
--
DROP TRIGGER IF EXISTS on_user_signup_create_user_profile ON auth.users;

CREATE TRIGGER on_user_signup_create_user_profile
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.user_profile_create();

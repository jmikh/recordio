-- Auto-generated from sql/triggers/*.sql
-- Run sql/build-functions.sh to regenerate
-- 2026-05-04 22:49:50 UTC

-- ============================================================
-- Source: on_user_signup_create_user_profile.sql
-- ============================================================
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

-- ============================================================
-- Source: on_user_signup_send_welcome_email.sql
-- ============================================================
-- on_user_signup_send_welcome_email
--
-- Fires after a new user signs up (INSERT on auth.users).
-- Calls the send-welcome-email edge function via HTTP.
--
DROP TRIGGER IF EXISTS on_user_signup_send_welcome_email ON auth.users;

CREATE TRIGGER on_user_signup_send_welcome_email
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION supabase_functions.http_request(
        '<SUPABASE_URL>/functions/v1/send-welcome-email',
        'POST',
        '{"Content-type":"application/json"}',
        '{}',
        '5000'
    );


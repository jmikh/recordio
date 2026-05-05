-- Auto-generated from sql/triggers/*.sql
-- Run sql/build-functions.sh to regenerate
-- 2026-05-05 03:14:06 UTC

-- ============================================================
-- Source: on_user_signup_send_welcome_email.sql
-- ============================================================
-- on_user_signup_send_welcome_email
--
-- Fires after a new user signs up (INSERT on auth.users).
-- Calls the send-welcome-email edge function via pg_net.
-- Reads SUPABASE_URL and SUPABASE_SECRET_KEY from Vault at runtime.
--
DROP TRIGGER IF EXISTS on_user_signup_send_welcome_email ON auth.users;
DROP FUNCTION IF EXISTS public.trigger_send_welcome_email();

CREATE OR REPLACE FUNCTION public.trigger_send_welcome_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL')
               || '/functions/v1/send-welcome-email',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SECRET_KEY')
        ),
        body := jsonb_build_object(
            'record', row_to_json(NEW),
            'type', TG_OP,
            'table', TG_TABLE_NAME,
            'schema', TG_TABLE_SCHEMA
        )
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_user_signup_send_welcome_email
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_send_welcome_email();


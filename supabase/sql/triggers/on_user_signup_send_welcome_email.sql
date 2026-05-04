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

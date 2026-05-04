-- Drop legacy auth.users triggers (replaced by on_user_signup_* triggers)

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS "send-welcome-email" ON auth.users;
DROP TRIGGER IF EXISTS "on-user-created-mixpanel" ON auth.users;

-- Drop old function (renamed to user_profile_create)
DROP FUNCTION IF EXISTS public.handle_new_user();

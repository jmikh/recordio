-- Items removed from the codebase. DROP statements here ensure they get
-- cleaned up in production. Safe to prune entries after a few deploy cycles.
--
-- Format:
--   DROP FUNCTION IF EXISTS public.my_old_function;
--   SELECT cron.unschedule('old-cron-name');
--   DROP TRIGGER IF EXISTS old_trigger ON some_table;

-- Old duplicate of asset_confirm_upload
DROP FUNCTION IF EXISTS public.confirm_asset_upload(text);

-- Old expire_trials with hardcoded Mixpanel token, replaced by cron_expire_trials
DROP FUNCTION IF EXISTS public.expire_trials();

-- No longer used
DROP FUNCTION IF EXISTS public.cron_expire_trials();

-- No local source file, not referenced
DROP FUNCTION IF EXISTS public.render_job_start();

-- Quota check removed from project-create
DROP FUNCTION IF EXISTS public.get_user_storage_bytes(uuid);

-- Old no-arg overloads replaced by workspace-scoped versions
DROP FUNCTION IF EXISTS public.project_list();
DROP FUNCTION IF EXISTS public.folder_list();

-- Old no-arg overload; replaced by subscription_get(p_workspace_id UUID DEFAULT NULL)
DROP FUNCTION IF EXISTS public.subscription_get();

-- Welcome email moved from signup trigger to trial_start RPC
DROP TRIGGER IF EXISTS on_user_signup_send_welcome_email ON auth.users;
DROP FUNCTION IF EXISTS public.trigger_send_welcome_email();

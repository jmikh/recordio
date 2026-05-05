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

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
DROP FUNCTION IF EXISTS public.folder_create(text, text);

-- Old project_update overload that included p_name; name updates moved to project_update_name
DROP FUNCTION IF EXISTS public.project_update(uuid, text, jsonb, integer, integer);

-- Old no-arg overload; replaced by subscription_get(p_workspace_id UUID DEFAULT NULL)
DROP FUNCTION IF EXISTS public.subscription_get();

-- Welcome email moved from signup trigger to trial_start RPC
DROP TRIGGER IF EXISTS on_user_signup_send_welcome_email ON auth.users;
DROP FUNCTION IF EXISTS public.trigger_send_welcome_email();

-- Removed: token alone was insufficient auth; decline can be handled client-side
DROP FUNCTION IF EXISTS public.workspace_invite_decline(UUID);

-- Wave C decommissions (2026-07-18). Guarded unschedules — graveyard runs
-- on every deploy and cron.unschedule errors on a missing job.
-- Pending-asset reaper removed: asset uploads are being redesigned to go
-- through the Fastify server (and the cron leaked uploaded blobs anyway)
SELECT cron.unschedule('assets-stale-cleanup')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'assets-stale-cleanup');

-- Auto-expiry of free-tier projects turned off (user decision)
SELECT cron.unschedule('projects-delete-expired')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'projects-delete-expired');
DROP FUNCTION IF EXISTS public.cleanup_expired_projects();

-- Broken (targeted a render-purge edge function that never existed);
-- replaced by the render_jobs.purge-superseded server job
SELECT cron.unschedule('render-jobs-purge')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'render-jobs-purge');

-- Wave D #16 decommissions (2026-07-22): the mux_videos soft-delete
-- machinery is gone (migration 20260721221112) and the superseded-purge
-- query went inline into the server job mux_videos.purge-superseded.
-- Dropping the RPC breaks the still-live mux-video-purge EDGE function
-- immediately — accepted (its replacement server job is live and
-- verified since Wave C), so its hourly cron is unscheduled in the same
-- breath rather than left 500ing until final decommission.
SELECT cron.unschedule('mux-video-purge')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mux-video-purge');
DROP FUNCTION IF EXISTS public.mux_video_purge_candidates();

-- Step 5 decommission (2026-07-24, soak waived by user) — the final
-- sweep, migration complete:
-- subscription_workspace_get: orphaned by Wave A #3 (subscription-change
-- ported its logic inline; the fn's "Called by: WorkspaceSettingsPage"
-- header was stale)
DROP FUNCTION IF EXISTS public.subscription_workspace_get(UUID);
-- set_project_expiry: orphaned by Wave D #17 decision (the server
-- stripe webhook never touches projects); its last caller was the edge
-- stripe-webhooks fn, dead since the Stripe endpoint swap
DROP FUNCTION IF EXISTS public.set_project_expiry(UUID, TIMESTAMPTZ);
-- render_purge_candidates: orphaned since birth — its only intended
-- caller was the render-purge edge fn that never existed (part13
-- missed it; user approved the drop 2026-07-24)
DROP FUNCTION IF EXISTS public.render_purge_candidates();
-- Last Pattern-B cron: its edge fn purge-deleted-projects is deleted;
-- the server job projects.purge-deleted replaced it in Wave C
SELECT cron.unschedule('projects-purge-deleted')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'projects-purge-deleted');

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

-- asset_confirm_upload: orphaned by the single-request /asset-upload
-- route (2026-07-24) — the server uploads the bytes itself and inserts
-- user_assets rows directly as 'ready', so there is no pending→ready
-- flip left to confirm (the presign flow it belonged to is deleted)
DROP FUNCTION IF EXISTS public.asset_confirm_upload(TEXT);

-- Folders and starred removed from the product (2026-07-24). The
-- folders table and projects.folder_id/is_starred columns are dropped
-- in migration 20260724122346_drop_folders_and_starred — run sql/deploy.sh
-- (replaces project_list/project_get, which stop selecting those
-- columns) before pushing that migration.
DROP FUNCTION IF EXISTS public.folder_create(TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.folder_delete(UUID);
DROP FUNCTION IF EXISTS public.folder_list(UUID);
DROP FUNCTION IF EXISTS public.folder_update(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.project_move_to_folder(UUID, UUID);
DROP FUNCTION IF EXISTS public.project_star(UUID, BOOLEAN);

-- ── Part 2 end-of-migration sweep (2026-07-25) ──────────────────────
-- Every client-called RPC is ported inline into the Fastify server
-- (plans/fastify-part2-rpc-proxy-migration.md); webapp/src has zero
-- .rpc( calls. APPLY ORDER: deploy the Part 2 server+webapp to prod
-- FIRST, then run sql/deploy.sh --remote — until then the frozen fns
-- keep serving any not-yet-updated bundle.
-- Kept (server/trigger territory): mux_video_complete,
-- mux_video_get_or_create, render_job_complete,
-- render_job_get_or_create, user_profile_create.

-- The 26 migrated client RPCs (Batches 1-4)
DROP FUNCTION IF EXISTS public.asset_delete(p_asset_id text);
DROP FUNCTION IF EXISTS public.asset_list(p_asset_type text);
DROP FUNCTION IF EXISTS public.project_confirm_upload(p_project_id uuid);
DROP FUNCTION IF EXISTS public.project_delete(p_project_id uuid);
DROP FUNCTION IF EXISTS public.project_get(p_project_id uuid);
DROP FUNCTION IF EXISTS public.project_list(p_workspace_id uuid);
DROP FUNCTION IF EXISTS public.project_rename(p_project_id uuid, p_name text);
DROP FUNCTION IF EXISTS public.project_restore(p_project_id uuid);
DROP FUNCTION IF EXISTS public.project_share(p_project_id uuid, p_share_policy text);
DROP FUNCTION IF EXISTS public.project_update(p_project_id uuid, p_project_data jsonb, p_duration_ms integer, p_expected_version integer);
DROP FUNCTION IF EXISTS public.project_update_name(p_project_id uuid, p_name text);
DROP FUNCTION IF EXISTS public.render_job_get_status(p_job_id uuid);
DROP FUNCTION IF EXISTS public.subscription_get(p_workspace_id uuid);
DROP FUNCTION IF EXISTS public.user_profile_get();
DROP FUNCTION IF EXISTS public.workspace_create(p_name text);
DROP FUNCTION IF EXISTS public.workspace_get(p_workspace_id uuid);
DROP FUNCTION IF EXISTS public.workspace_get_default();
DROP FUNCTION IF EXISTS public.workspace_invite(p_workspace_id uuid, p_email text, p_role text);
DROP FUNCTION IF EXISTS public.workspace_invite_accept(p_token uuid);
DROP FUNCTION IF EXISTS public.workspace_invite_rescind(p_invitation_id uuid);
DROP FUNCTION IF EXISTS public.workspace_list();
DROP FUNCTION IF EXISTS public.workspace_member_remove(p_workspace_id uuid, p_user_id uuid);
DROP FUNCTION IF EXISTS public.workspace_member_update_role(p_workspace_id uuid, p_user_id uuid, p_role text);
DROP FUNCTION IF EXISTS public.workspace_rename(p_workspace_id uuid, p_name text);
DROP FUNCTION IF EXISTS public.workspace_seats_set(p_workspace_id uuid, p_seats integer);
DROP FUNCTION IF EXISTS public.workspace_set_default(p_workspace_id uuid);

-- trial_start KILLED (user decision 2026-07-25): no caller existed;
-- trials can no longer start. /send-welcome-email (its pg_net target)
-- is deliberately kept for future re-wiring.
DROP FUNCTION IF EXISTS public.trial_start();

-- Zero-caller orphans (verified 2026-07-25 across webapp/extension/
-- server/render-worker/sql): workspace_delete never got a UI;
-- project_create is the pre-v2 creation path; the editor-management
-- and move-to-workspace RPCs never got callers.
DROP FUNCTION IF EXISTS public.workspace_delete(p_workspace_id uuid);
DROP FUNCTION IF EXISTS public.project_create(p_name text, p_workspace_id uuid);
DROP FUNCTION IF EXISTS public.project_editor_add(p_project_id uuid, p_user_id uuid);
DROP FUNCTION IF EXISTS public.project_editor_remove(p_project_id uuid, p_user_id uuid);
DROP FUNCTION IF EXISTS public.project_move_to_workspace(p_project_id uuid, p_workspace_id uuid);

-- assert_* helpers: their only callers were the fns above (the server
-- ports the checks as services/projectAccess.ts)
DROP FUNCTION IF EXISTS public.assert_project_editor(p_project_id uuid);
DROP FUNCTION IF EXISTS public.assert_workspace_admin(p_workspace_id uuid);
DROP FUNCTION IF EXISTS public.assert_workspace_creator(p_workspace_id uuid);
DROP FUNCTION IF EXISTS public.assert_workspace_viewer(p_workspace_id uuid);

-- Stray render_job_start overload found during the sweep: the old
-- entry above drops the no-arg form, and render_job_get_or_create.sql
-- drops a 2-arg form — the 6-arg original survived both. Zero callers.
DROP FUNCTION IF EXISTS public.render_job_start(uuid, uuid, text, integer, text, real);

-- ── Server-RPC inlining (2026-07-25, post-Part-2) ───────────────────
-- The last four business-logic fns move inline into the server as
-- single atomic statements: render_job_get_or_create → CTE in
-- services/renderJobs.ts; mux_video_get_or_create → upsert in
-- routes/muxVideoCreate.ts; render_job_complete → CTE in
-- routes/renderJobWebhook.ts (the stale-jobs cron inlines the same
-- cascade); mux_video_complete → UPDATE…RETURNING in
-- routes/muxVideoWebhook.ts. Deploy the server BEFORE running this
-- remotely. Only the user_profile_create signup trigger fn remains.
DROP FUNCTION IF EXISTS public.render_job_get_or_create(p_project_id uuid, p_user_id uuid, p_cloud_version integer);
DROP FUNCTION IF EXISTS public.render_job_complete(p_job_id uuid, p_status text, p_error text);
DROP FUNCTION IF EXISTS public.mux_video_get_or_create(p_project_id uuid, p_user_id uuid, p_cloud_version integer);
DROP FUNCTION IF EXISTS public.mux_video_complete(p_mux_asset_id text, p_playback_id text);

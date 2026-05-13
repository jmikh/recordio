-- Remove all permissive RLS policies from public tables.
-- Tables remain RLS-enabled (blocking all direct client access).
-- All data access goes through SECURITY DEFINER RPCs or service-role edge functions.

-- folders
DROP POLICY IF EXISTS "folders_select" ON public.folders;

-- mux_videos
DROP POLICY IF EXISTS "Users can manage own mux videos" ON public.mux_videos;

-- project_editors
DROP POLICY IF EXISTS "project_editors_select" ON public.project_editors;

-- projects
DROP POLICY IF EXISTS "projects_select" ON public.projects;
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_update" ON public.projects;
DROP POLICY IF EXISTS "projects_delete" ON public.projects;

-- render_jobs
DROP POLICY IF EXISTS "Users can view own render jobs" ON public.render_jobs;

-- subscriptions
DROP POLICY IF EXISTS "subscriptions_select" ON public.subscriptions;

-- user_assets
DROP POLICY IF EXISTS "Users can manage own assets" ON public.user_assets;

-- user_profiles
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;

-- workspace_invitations
DROP POLICY IF EXISTS "workspace_invitations_select" ON public.workspace_invitations;

-- workspace_members
DROP POLICY IF EXISTS "workspace_members_select" ON public.workspace_members;

-- workspaces
DROP POLICY IF EXISTS "workspace_select" ON public.workspaces;
DROP POLICY IF EXISTS "workspace_insert" ON public.workspaces;
DROP POLICY IF EXISTS "workspace_update" ON public.workspaces;
DROP POLICY IF EXISTS "workspace_delete" ON public.workspaces;

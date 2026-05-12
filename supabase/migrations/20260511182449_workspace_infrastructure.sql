-- ============================================================
-- Workspace Infrastructure
--
-- Creates workspace tables (workspaces, workspace_members,
-- workspace_invitations, project_editors), modifies projects/
-- folders/user_profiles, backfills personal workspaces for all
-- existing users, and replaces user_id-based RLS with workspace-
-- based policies.
-- ============================================================


-- ========================
-- 1. NEW TABLES
-- ========================

CREATE TABLE IF NOT EXISTS public.workspaces (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL CHECK (char_length(name) <= 60),
  owner_id    UUID        NOT NULL REFERENCES auth.users(id),
  is_personal BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id),
  role         TEXT        NOT NULL CHECK (role IN ('viewer', 'creator', 'admin')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  role         TEXT        NOT NULL CHECK (role IN ('viewer', 'creator', 'admin')),
  invited_by   UUID        NOT NULL REFERENCES auth.users(id),
  token        UUID        NOT NULL DEFAULT gen_random_uuid(),
  status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.project_editors (
  project_id UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

ALTER TABLE public.project_editors ENABLE ROW LEVEL SECURITY;


-- ========================
-- 2. MODIFY PROJECTS
-- ========================

-- Rename user_id → created_by (immutable creator, history only)
ALTER TABLE public.projects RENAME COLUMN user_id TO created_by;

-- Drop the old FK constraint (will re-add with new name)
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_user_id_fkey;
ALTER TABLE public.projects ADD CONSTRAINT projects_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add owner_id and workspace_id (nullable initially — backfilled below)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_id    UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id);

-- share_policy: make nullable, expand check to include 'workspace'
ALTER TABLE public.projects ALTER COLUMN share_policy DROP NOT NULL;
ALTER TABLE public.projects ALTER COLUMN share_policy DROP DEFAULT;
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_share_policy_check,
  ADD CONSTRAINT projects_share_policy_check
    CHECK (share_policy IN ('workspace', 'public', 'private'));

-- Drafts (no slug) have no share_policy
UPDATE public.projects SET share_policy = NULL WHERE slug IS NULL;


-- ========================
-- 3. MODIFY USER_PROFILES
-- ========================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS default_workspace_id UUID
    REFERENCES public.workspaces(id) ON DELETE SET NULL;


-- ========================
-- 4. MODIFY FOLDERS
-- ========================

-- Add workspace_id (nullable first — backfilled before NOT NULL)
ALTER TABLE public.folders
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id);


-- ========================
-- 5. BACKFILL
-- ========================

-- Create a personal workspace for every existing auth user
INSERT INTO public.workspaces (name, owner_id, is_personal)
SELECT 'My Workspace', u.id, TRUE
FROM auth.users u
ON CONFLICT DO NOTHING;

-- Add each owner as an admin member of their personal workspace
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_id, 'admin'
FROM public.workspaces w
WHERE w.is_personal = TRUE
ON CONFLICT DO NOTHING;

-- Backfill projects: owner_id = created_by, workspace_id = personal workspace
UPDATE public.projects SET owner_id = created_by WHERE owner_id IS NULL;

UPDATE public.projects p
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.owner_id = p.created_by
  AND w.is_personal = TRUE
  AND p.workspace_id IS NULL;

-- Backfill user_profiles.default_workspace_id to each user's personal workspace
UPDATE public.user_profiles up
SET default_workspace_id = w.id
FROM public.workspaces w
WHERE w.owner_id = up.user_id
  AND w.is_personal = TRUE
  AND up.default_workspace_id IS NULL;

-- Backfill folders.workspace_id from owner's personal workspace
UPDATE public.folders f
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.owner_id = f.user_id
  AND w.is_personal = TRUE
  AND f.workspace_id IS NULL;


-- ========================
-- 6. NOT NULL CONSTRAINTS
-- ========================

ALTER TABLE public.projects ALTER COLUMN owner_id    SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.folders  ALTER COLUMN workspace_id SET NOT NULL;


-- ========================
-- 7. FOLDERS: deduplicate names, drop user_id, add unique constraint
-- ========================

-- Rename duplicate folder names within the same user's folders
-- so the unique (workspace_id, name) constraint can be applied.
DO $$
DECLARE
  rec RECORD;
  idx INT;
BEGIN
  FOR rec IN
    SELECT user_id, name, array_agg(id ORDER BY created_at ASC) AS ids
    FROM public.folders
    GROUP BY user_id, name
    HAVING count(*) > 1
  LOOP
    FOR idx IN 2..array_length(rec.ids, 1) LOOP
      UPDATE public.folders
      SET name = rec.name || ' (' || idx || ')'
      WHERE id = rec.ids[idx];
    END LOOP;
  END LOOP;
END;
$$;

-- Drop old user_id-based folder policies before dropping the column
DROP POLICY IF EXISTS "Users can view own folders"   ON public.folders;
DROP POLICY IF EXISTS "Users can insert own folders" ON public.folders;
DROP POLICY IF EXISTS "Users can update own folders" ON public.folders;
DROP POLICY IF EXISTS "Users can delete own folders" ON public.folders;

ALTER TABLE public.folders DROP COLUMN IF EXISTS user_id;

ALTER TABLE public.folders
  ADD CONSTRAINT folders_unique_name_per_workspace
  UNIQUE (workspace_id, name);


-- ========================
-- 8. INDEXES
-- ========================

-- Folders: drop old user_id index, add workspace index
DROP INDEX IF EXISTS idx_folders_user;
CREATE INDEX IF NOT EXISTS idx_folders_workspace ON public.folders (workspace_id, created_at ASC);

-- Projects: drop old user_id indexes, add created_by / owner / workspace indexes
DROP INDEX IF EXISTS idx_projects_user_id;
DROP INDEX IF EXISTS idx_projects_user_starred;
CREATE INDEX IF NOT EXISTS idx_projects_created_by   ON public.projects (created_by);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id     ON public.projects (owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON public.projects (workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace_starred
  ON public.projects (workspace_id, is_starred)
  WHERE is_starred = true;


-- ========================
-- 9. RLS POLICIES
-- ========================

-- workspaces
CREATE POLICY "workspace_select"
  ON public.workspaces FOR SELECT
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = id AND user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_insert"
  ON public.workspaces FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "workspace_update"
  ON public.workspaces FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "workspace_delete"
  ON public.workspaces FOR DELETE
  USING (owner_id = auth.uid());

-- workspace_members: SELECT only; INSERT/UPDATE/DELETE via SECURITY DEFINER RPCs
CREATE POLICY "workspace_members_select"
  ON public.workspace_members FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members wm2
      WHERE wm2.user_id = auth.uid()
    )
  );

-- workspace_invitations: SELECT only; rest via RPC
CREATE POLICY "workspace_invitations_select"
  ON public.workspace_invitations FOR SELECT
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = workspace_invitations.workspace_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- project_editors: SELECT only; rest via RPC
CREATE POLICY "project_editors_select"
  ON public.project_editors FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = project_editors.project_id
        AND wm.user_id = auth.uid()
    )
  );

-- projects: drop old user_id-based policies, add workspace-based ones
DROP POLICY IF EXISTS "Users can insert own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can view own projects"   ON public.projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;

CREATE POLICY "projects_select"
  ON public.projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = projects.workspace_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "projects_insert"
  ON public.projects FOR INSERT
  WITH CHECK (owner_id = auth.uid() AND created_by = auth.uid());

CREATE POLICY "projects_update"
  ON public.projects FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "projects_delete"
  ON public.projects FOR DELETE
  USING (owner_id = auth.uid());

-- folders: workspace-based SELECT policy (old user_id policies already dropped above)
CREATE POLICY "folders_select"
  ON public.folders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = folders.workspace_id AND user_id = auth.uid()
    )
  );


-- ========================
-- 10. TABLE GRANTS
-- ========================

GRANT ALL ON TABLE public.workspaces            TO anon;
GRANT ALL ON TABLE public.workspaces            TO authenticated;
GRANT ALL ON TABLE public.workspaces            TO service_role;

GRANT ALL ON TABLE public.workspace_members     TO anon;
GRANT ALL ON TABLE public.workspace_members     TO authenticated;
GRANT ALL ON TABLE public.workspace_members     TO service_role;

GRANT ALL ON TABLE public.workspace_invitations TO anon;
GRANT ALL ON TABLE public.workspace_invitations TO authenticated;
GRANT ALL ON TABLE public.workspace_invitations TO service_role;

GRANT ALL ON TABLE public.project_editors       TO anon;
GRANT ALL ON TABLE public.project_editors       TO authenticated;
GRANT ALL ON TABLE public.project_editors       TO service_role;

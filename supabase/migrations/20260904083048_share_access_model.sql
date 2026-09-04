-- Share access model (plans/share-modal-slug-routing):
-- every project always has a slug; share_policy 'private' is the draft
-- state; workspace_access is the level workspace members get when the
-- policy is 'workspace' or 'public' (ignored when private);
-- project_editors rows carry a per-user role (view|edit).
-- is_shared is now derived as share_policy IN ('public','workspace').

-- 1. Slug: DB-side default so every insert path gets one regardless of
--    server deploy order (same 12-hex recipe as project-share).
ALTER TABLE public.projects
  ALTER COLUMN slug SET DEFAULT left(replace(gen_random_uuid()::text, '-', ''), 12);

-- 2. Backfill NULL slugs. Collision-safe: retry on unique_violation
--    against projects_slug_key.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.projects WHERE slug IS NULL LOOP
    LOOP
      BEGIN
        UPDATE public.projects
        SET slug = left(replace(gen_random_uuid()::text, '-', ''), 12)
        WHERE id = r.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- collision: loop and retry with a fresh slug
      END;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE public.projects ALTER COLUMN slug SET NOT NULL;

-- 3. Drafts become explicitly private; new rows default private.
UPDATE public.projects SET share_policy = 'private' WHERE share_policy IS NULL;
ALTER TABLE public.projects ALTER COLUMN share_policy SET DEFAULT 'private';
ALTER TABLE public.projects ALTER COLUMN share_policy SET NOT NULL;

-- 4. Workspace access level (applies when share_policy IN ('workspace','public')).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_access text NOT NULL DEFAULT 'view'
    CONSTRAINT projects_workspace_access_check CHECK (workspace_access IN ('view', 'edit'));

-- 5. Per-user grant role; existing rows were edit grants.
ALTER TABLE public.project_editors
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'edit'
    CONSTRAINT project_editors_role_check CHECK (role IN ('view', 'edit'));

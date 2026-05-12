-- assert_project_editor(p_project_id)
--
-- Raises an exception if the caller is not an editor of the project.
-- Passes if caller is the project owner (owner_id) OR has an explicit
-- row in project_editors. Also checks that the workspace is not deleted.
-- Internal helper — not callable by clients.
--
-- Called by: other SECURITY DEFINER RPCs
-- Tables:   projects, project_editors, workspaces

CREATE OR REPLACE FUNCTION public.assert_project_editor(p_project_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.projects p
        LEFT JOIN public.workspaces w ON w.id = p.workspace_id
        WHERE p.id = p_project_id
          AND p.deleted_at IS NULL
          AND (p.workspace_id IS NULL OR w.deleted_at IS NULL)
          AND (
              p.owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.project_editors pe
                  WHERE pe.project_id = p.id
                    AND pe.user_id = auth.uid()
              )
          )
    ) THEN
        RAISE EXCEPTION 'Not an editor of this project';
    END IF;
END;
$$;

-- Don't let clients call it directly — it's an internal helper
REVOKE ALL ON FUNCTION public.assert_project_editor(UUID) FROM public;
REVOKE ALL ON FUNCTION public.assert_project_editor(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.assert_project_editor(UUID) FROM authenticated;

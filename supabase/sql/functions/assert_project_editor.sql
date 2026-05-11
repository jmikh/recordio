-- assert_project_editor(p_project_id)
--
-- Raises an exception if the caller is not an editor of the project.
-- Also checks that if the project belongs to a workspace, that workspace
-- is not deleted.
-- Checks the project_editors table (which includes the project creator).
-- Internal helper — not callable by clients.
--
-- Called by: other SECURITY DEFINER RPCs
-- Tables:   project_editors, projects, workspaces

CREATE OR REPLACE FUNCTION public.assert_project_editor(p_project_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.project_editors pe
        JOIN public.projects p ON p.id = pe.project_id
        LEFT JOIN public.workspaces w ON w.id = p.workspace_id
        WHERE pe.project_id = p_project_id
          AND pe.user_id = auth.uid()
          AND p.deleted_at IS NULL
          AND (p.workspace_id IS NULL OR w.deleted_at IS NULL)
    ) THEN
        RAISE EXCEPTION 'Not an editor of this project';
    END IF;
END;
$$;

-- Don't let clients call it directly — it's an internal helper
REVOKE ALL ON FUNCTION public.assert_project_editor(UUID) FROM public;
REVOKE ALL ON FUNCTION public.assert_project_editor(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.assert_project_editor(UUID) FROM authenticated;

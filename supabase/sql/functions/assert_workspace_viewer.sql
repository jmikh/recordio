-- assert_workspace_viewer(p_workspace_id)
--
-- Raises an exception if the caller is not a member of the workspace (any role),
-- or if the workspace has been deleted.
-- This is the lowest-level workspace permission check.
-- Internal helper — not callable by clients.
--
-- Called by: other SECURITY DEFINER RPCs
-- Tables:   workspace_members, workspaces

CREATE OR REPLACE FUNCTION public.assert_workspace_viewer(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.workspace_members wm
        JOIN public.workspaces w ON w.id = wm.workspace_id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = auth.uid()
          AND w.deleted_at IS NULL
    ) THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'Not a member of this workspace';
    END IF;
END;
$$;

-- Don't let clients call it directly — it's an internal helper
REVOKE ALL ON FUNCTION public.assert_workspace_viewer(UUID) FROM public;
REVOKE ALL ON FUNCTION public.assert_workspace_viewer(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.assert_workspace_viewer(UUID) FROM authenticated;

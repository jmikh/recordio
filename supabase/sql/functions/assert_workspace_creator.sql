-- assert_workspace_creator(p_workspace_id)
--
-- Raises an exception if the caller is not at least a creator in the workspace,
-- or if the workspace has been deleted.
-- Passes for: creator, admin. Fails for: viewer.
-- Internal helper — not callable by clients.
--
-- Called by: other SECURITY DEFINER RPCs
-- Tables:   workspace_members, workspaces

CREATE OR REPLACE FUNCTION public.assert_workspace_creator(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.workspace_members wm
        JOIN public.workspaces w ON w.id = wm.workspace_id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role IN ('creator', 'admin')
          AND w.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Requires creator or admin role in this workspace';
    END IF;
END;
$$;

-- Don't let clients call it directly — it's an internal helper
REVOKE ALL ON FUNCTION public.assert_workspace_creator(UUID) FROM public;
REVOKE ALL ON FUNCTION public.assert_workspace_creator(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.assert_workspace_creator(UUID) FROM authenticated;

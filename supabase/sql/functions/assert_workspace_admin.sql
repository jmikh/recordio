-- assert_workspace_admin(p_workspace_id)
--
-- Raises an exception if the caller is not an admin in the workspace,
-- or if the workspace has been deleted.
-- Passes for: admin only.
-- Internal helper — not callable by clients.
--
-- Called by: other SECURITY DEFINER RPCs
-- Tables:   workspace_members, workspaces

CREATE OR REPLACE FUNCTION public.assert_workspace_admin(p_workspace_id UUID)
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
          AND wm.role = 'admin'
          AND w.deleted_at IS NULL
    ) THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'Requires admin role in this workspace';
    END IF;
END;
$$;

-- Don't let clients call it directly — it's an internal helper
REVOKE ALL ON FUNCTION public.assert_workspace_admin(UUID) FROM public;
REVOKE ALL ON FUNCTION public.assert_workspace_admin(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.assert_workspace_admin(UUID) FROM authenticated;

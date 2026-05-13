-- workspace_set_default(p_workspace_id)
--
-- Sets the caller's default workspace to p_workspace_id.
-- Raises if the caller is not a member of that workspace.
--
-- Called by: webapp when the user switches workspace
-- Tables:   user_profiles, workspace_members

CREATE OR REPLACE FUNCTION public.workspace_set_default(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _uid UUID := auth.uid();
BEGIN
    IF _uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Verify caller is a member of the workspace
    IF NOT EXISTS (
        SELECT 1 FROM public.workspace_members wm
        JOIN public.workspaces w ON w.id = wm.workspace_id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = _uid
          AND w.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Not a member of this workspace';
    END IF;

    UPDATE public.user_profiles
    SET default_workspace_id = p_workspace_id,
        updated_at = now()
    WHERE user_id = _uid;
END;
$$;

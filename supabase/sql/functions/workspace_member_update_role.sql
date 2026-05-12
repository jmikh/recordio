-- workspace_member_update_role(p_workspace_id, p_user_id, p_role)
--
-- Changes a workspace member's role.
-- Caller must be a workspace admin.
-- Cannot change the role of the workspace owner.
--
-- Called by: workspace members admin UI
-- Tables:   workspace_members, workspaces

CREATE OR REPLACE FUNCTION public.workspace_member_update_role(
    p_workspace_id UUID,
    p_user_id      UUID,
    p_role         TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _owner_id UUID;
BEGIN
    PERFORM public.assert_workspace_admin(p_workspace_id);

    SELECT owner_id INTO _owner_id
    FROM public.workspaces
    WHERE id = p_workspace_id AND deleted_at IS NULL;

    IF _owner_id = p_user_id THEN
        RAISE EXCEPTION 'Cannot change the role of the workspace owner';
    END IF;

    IF p_role NOT IN ('viewer', 'creator', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role;
    END IF;

    UPDATE public.workspace_members
    SET role = p_role, updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member not found in workspace';
    END IF;
END;
$$;

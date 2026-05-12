-- workspace_member_remove(p_workspace_id, p_user_id)
--
-- Removes a member from a workspace.
-- Caller must be a workspace admin.
-- Cannot remove the workspace owner.
-- Any projects owned by the member in this workspace are automatically
-- transferred to the caller (admin initiating the removal).
-- Removes the member's project_editors rows in this workspace.
-- Returns count of projects transferred.
--
-- Called by: workspace members admin UI
-- Tables:   workspace_members, project_editors, projects, workspaces

CREATE OR REPLACE FUNCTION public.workspace_member_remove(
    p_workspace_id UUID,
    p_user_id      UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _caller_id         UUID := auth.uid();
    _owner_id          UUID;
    _transferred_count INT;
BEGIN
    PERFORM public.assert_workspace_admin(p_workspace_id);

    SELECT owner_id INTO _owner_id
    FROM public.workspaces
    WHERE id = p_workspace_id AND deleted_at IS NULL;

    IF _owner_id = p_user_id THEN
        RAISE EXCEPTION 'Cannot remove the workspace owner';
    END IF;

    -- Transfer any projects owned by the member to the caller
    UPDATE public.projects
    SET owner_id = _caller_id
    WHERE workspace_id = p_workspace_id
      AND owner_id = p_user_id
      AND deleted_at IS NULL;

    GET DIAGNOSTICS _transferred_count = ROW_COUNT;

    -- Remove the member's project_editors rows within this workspace
    DELETE FROM public.project_editors pe
    USING public.projects p
    WHERE pe.project_id = p.id
      AND p.workspace_id = p_workspace_id
      AND pe.user_id = p_user_id;

    -- Remove the member
    DELETE FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member not found in workspace';
    END IF;

    RETURN jsonb_build_object('transferred_count', _transferred_count);
END;
$$;

-- project_move_to_workspace(p_project_id, p_workspace_id)
--
-- Moves a project (draft or published) to a different workspace.
-- Caller must be the project owner AND at least a creator in the target workspace.
-- All project_editors rows are cleared — collaboration must be re-established
-- in the new workspace.
--
-- Called by: webapp move project UI
-- Tables:   projects, workspace_members, project_editors

CREATE OR REPLACE FUNCTION public.project_move_to_workspace(
    p_project_id   UUID,
    p_workspace_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _caller_id UUID := auth.uid();
    _owner_id  UUID;
BEGIN
    SELECT owner_id INTO _owner_id
    FROM public.projects
    WHERE id = p_project_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE SQLSTATE 'PT404' USING MESSAGE = 'Project not found';
    END IF;

    IF _owner_id <> _caller_id THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'Only the project owner can move a project';
    END IF;

    -- Caller must be at least creator in the target workspace
    PERFORM public.assert_workspace_creator(p_workspace_id);

    -- Clear all editors — they may not be members in the new workspace
    DELETE FROM public.project_editors WHERE project_id = p_project_id;

    UPDATE public.projects
    SET workspace_id = p_workspace_id,
        updated_at   = now()
    WHERE id = p_project_id;
END;
$$;

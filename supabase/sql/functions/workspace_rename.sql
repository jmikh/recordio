-- workspace_rename(p_workspace_id, p_name)
--
-- Renames a workspace. Caller must be an admin.
-- Returns the updated workspace as JSONB.
--
-- Called by: webapp workspace settings
-- Tables:   workspaces

CREATE OR REPLACE FUNCTION public.workspace_rename(p_workspace_id UUID, p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _result JSONB;
BEGIN
    PERFORM public.assert_workspace_admin(p_workspace_id);

    UPDATE public.workspaces
    SET name = p_name, updated_at = now()
    WHERE id = p_workspace_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workspace not found';
    END IF;

    SELECT jsonb_build_object(
        'id',          w.id,
        'name',        w.name,
        'owner_id',    w.owner_id,
        'created_at',  w.created_at,
        'updated_at',  w.updated_at
    ) INTO _result
    FROM public.workspaces w
    WHERE w.id = p_workspace_id;

    RETURN _result;
END;
$$;

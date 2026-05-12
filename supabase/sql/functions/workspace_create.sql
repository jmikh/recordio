-- workspace_create(p_name)
--
-- Creates a new workspace (is_personal = TRUE) and adds the caller
-- as an admin member. Workspaces start personal; upgrading to a team
-- workspace (is_personal = FALSE) is handled separately.
-- Returns the new workspace as JSONB.
--
-- Called by: webapp new workspace flow
-- Tables:   workspaces, workspace_members

CREATE OR REPLACE FUNCTION public.workspace_create(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _uid    UUID := auth.uid();
    _wid    UUID;
    _result JSONB;
BEGIN
    INSERT INTO public.workspaces (name, owner_id, is_personal)
    VALUES (p_name, _uid, TRUE)
    RETURNING id INTO _wid;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (_wid, _uid, 'admin');

    SELECT jsonb_build_object(
        'id',          w.id,
        'name',        w.name,
        'owner_id',    w.owner_id,
        'is_personal', w.is_personal,
        'role',        'admin',
        'created_at',  w.created_at,
        'updated_at',  w.updated_at
    ) INTO _result
    FROM public.workspaces w
    WHERE w.id = _wid;

    RETURN _result;
END;
$$;

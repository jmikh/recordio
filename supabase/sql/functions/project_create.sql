-- project_create(p_name, p_workspace_id)
--
-- Creates a new project. If p_workspace_id is omitted, defaults to
-- the caller's default workspace (via workspace_get_default).
-- Caller must be at least a creator in the target workspace.
-- Sets created_by = owner_id = caller.
-- Returns the new project as JSONB.
--
-- Called by: webapp new recording flow
-- Tables:   projects, workspaces

CREATE OR REPLACE FUNCTION public.project_create(
    p_name         TEXT DEFAULT 'Untitled',
    p_workspace_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _uid          UUID := auth.uid();
    _workspace_id UUID;
    _pid          UUID;
    _result       JSONB;
BEGIN
    -- Resolve workspace: use provided id or fall back to default
    IF p_workspace_id IS NOT NULL THEN
        _workspace_id := p_workspace_id;
    ELSE
        SELECT (public.workspace_get_default()->>'id')::UUID INTO _workspace_id;
    END IF;

    PERFORM public.assert_workspace_creator(_workspace_id);

    INSERT INTO public.projects (
        workspace_id, created_by, owner_id, name, upload_status
    )
    VALUES (
        _workspace_id, _uid, _uid, p_name, 'pending'
    )
    RETURNING id INTO _pid;

    SELECT jsonb_build_object(
        'id',            p.id,
        'name',          p.name,
        'workspace_id',  p.workspace_id,
        'created_by',    p.created_by,
        'owner_id',      p.owner_id,
        'upload_status', p.upload_status,
        'created_at',    p.created_at,
        'updated_at',    p.updated_at
    ) INTO _result
    FROM public.projects p
    WHERE p.id = _pid;

    RETURN _result;
END;
$$;

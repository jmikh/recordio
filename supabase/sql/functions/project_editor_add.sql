-- project_editor_add(p_project_id, p_user_id)
--
-- Adds an explicit project editor.
-- Caller must be the project owner.
-- Target user must be a creator or admin in the project's workspace.
-- The project owner cannot be added (already has implicit access).
--
-- Called by: webapp project collaborators UI
-- Tables:   project_editors, projects, workspace_members

CREATE OR REPLACE FUNCTION public.project_editor_add(
    p_project_id UUID,
    p_user_id    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _caller_id   UUID := auth.uid();
    _project     RECORD;
    _target_role TEXT;
BEGIN
    SELECT p.owner_id, p.workspace_id INTO _project
    FROM public.projects p
    WHERE p.id = p_project_id AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found';
    END IF;

    IF _project.owner_id <> _caller_id THEN
        RAISE EXCEPTION 'Only the project owner can add editors';
    END IF;

    IF _project.owner_id = p_user_id THEN
        RAISE EXCEPTION 'Project owner already has implicit editor access';
    END IF;

    -- Target must be at least creator in the workspace
    SELECT role INTO _target_role
    FROM public.workspace_members
    WHERE workspace_id = _project.workspace_id AND user_id = p_user_id;

    IF _target_role IS NULL OR _target_role = 'viewer' THEN
        RAISE EXCEPTION 'Target user must be a creator or admin in the workspace';
    END IF;

    INSERT INTO public.project_editors (project_id, user_id)
    VALUES (p_project_id, p_user_id)
    ON CONFLICT DO NOTHING;
END;
$$;

-- project_editor_remove(p_project_id, p_user_id)
--
-- Removes an explicit project editor.
-- Caller must be the project owner.
--
-- Called by: webapp project collaborators UI
-- Tables:   project_editors, projects

CREATE OR REPLACE FUNCTION public.project_editor_remove(
    p_project_id UUID,
    p_user_id    UUID
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
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'Only the project owner can remove editors';
    END IF;

    DELETE FROM public.project_editors
    WHERE project_id = p_project_id AND user_id = p_user_id;
END;
$$;

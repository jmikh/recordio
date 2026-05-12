-- project_update_name(p_project_id, p_name)
--
-- Updates only the project name column. Called directly from the editor
-- header without debouncing (name is not part of project_data).
-- Caller must be a project editor (owner or explicit editor).
--
-- Called by: webapp CloudStorage.updateProjectName
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_update_name(
    p_project_id UUID,
    p_name       TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM public.assert_project_editor(p_project_id);

    UPDATE public.projects
    SET name = p_name, updated_at = NOW()
    WHERE id = p_project_id
      AND deleted_at IS NULL;
END;
$$;

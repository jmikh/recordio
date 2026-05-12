-- project_move_to_folder(p_project_id, p_folder_id)
--
-- Moves a project into a folder (or removes from folder if p_folder_id is NULL).
-- Caller must be the project owner.
-- Validates the folder belongs to the same workspace as the project.
-- Returns true if the update succeeded.
--
-- Called by: webapp CloudStorage.moveProjectToFolder
-- Tables:   projects, folders

CREATE OR REPLACE FUNCTION public.project_move_to_folder(p_project_id UUID, p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _project RECORD;
BEGIN
    SELECT owner_id, workspace_id INTO _project
    FROM public.projects
    WHERE id = p_project_id AND deleted_at IS NULL;

    IF NOT FOUND OR _project.owner_id <> auth.uid() THEN
        RETURN FALSE;
    END IF;

    IF p_folder_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.folders
            WHERE id = p_folder_id AND workspace_id = _project.workspace_id
        ) THEN
            RETURN FALSE;
        END IF;
    END IF;

    UPDATE public.projects
    SET folder_id = p_folder_id, updated_at = NOW()
    WHERE id = p_project_id;

    RETURN FOUND;
END;
$$;

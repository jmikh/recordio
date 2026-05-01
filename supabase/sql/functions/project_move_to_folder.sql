-- project_move_to_folder(p_project_id, p_folder_id)
--
-- Moves a project into a folder (or removes from folder if p_folder_id is NULL).
-- Validates that both the project and folder belong to the current user.
-- Returns true if the update succeeded.
--
-- Called by: webapp CloudStorage.moveProjectToFolder
-- Tables:   projects, folders

CREATE OR REPLACE FUNCTION public.project_move_to_folder(p_project_id UUID, p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- If assigning to a folder, verify the folder belongs to this user
    IF p_folder_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.folders
            WHERE id = p_folder_id AND user_id = auth.uid()
        ) THEN
            RETURN FALSE;
        END IF;
    END IF;

    UPDATE public.projects
    SET folder_id = p_folder_id,
        updated_at = NOW()
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND deleted_at IS NULL;

    RETURN FOUND;
END;
$$;

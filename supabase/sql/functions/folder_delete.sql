-- folder_delete(p_folder_id)
--
-- Deletes a folder. Projects in this folder have folder_id set to NULL
-- automatically via ON DELETE SET NULL.
-- Caller must be at least a creator in the folder's workspace.
-- Returns true if the folder was found and deleted.
--
-- Called by: webapp CloudStorage.deleteFolder
-- Tables:   folders

CREATE OR REPLACE FUNCTION public.folder_delete(p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _workspace_id UUID;
BEGIN
    SELECT workspace_id INTO _workspace_id
    FROM public.folders
    WHERE id = p_folder_id;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    PERFORM public.assert_workspace_creator(_workspace_id);

    DELETE FROM public.folders WHERE id = p_folder_id;

    RETURN FOUND;
END;
$$;

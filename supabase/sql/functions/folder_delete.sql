-- folder_delete(p_folder_id)
--
-- Deletes a folder. Projects in this folder have folder_id set to NULL
-- automatically via ON DELETE SET NULL.
-- Returns true if the folder was found and deleted.
--
-- Called by: webapp CloudStorage.deleteFolder
-- Tables:   folders

CREATE OR REPLACE FUNCTION public.folder_delete(p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.folders
    WHERE id = p_folder_id
      AND user_id = auth.uid();

    RETURN FOUND;
END;
$$;

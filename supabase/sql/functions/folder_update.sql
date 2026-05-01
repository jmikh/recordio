-- folder_update(p_folder_id, p_name, p_description)
--
-- Updates a folder's name and description.
-- Returns the updated folder as JSONB, or NULL if not found.
--
-- Called by: webapp CloudStorage.updateFolder
-- Tables:   folders

CREATE OR REPLACE FUNCTION public.folder_update(p_folder_id UUID, p_name TEXT, p_description TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_folder JSONB;
BEGIN
    UPDATE public.folders
    SET name = p_name,
        description = p_description,
        updated_at = NOW()
    WHERE id = p_folder_id
      AND user_id = auth.uid()
    RETURNING jsonb_build_object(
        'id', id,
        'name', name,
        'description', description,
        'created_at', created_at,
        'updated_at', updated_at
    ) INTO v_folder;

    RETURN v_folder;
END;
$$;

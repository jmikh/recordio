-- folder_update(p_folder_id, p_name, p_description)
--
-- Updates a folder's name and description.
-- Caller must be at least a creator in the folder's workspace.
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
    _workspace_id UUID;
    _result       JSONB;
BEGIN
    SELECT workspace_id INTO _workspace_id
    FROM public.folders
    WHERE id = p_folder_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    PERFORM public.assert_workspace_creator(_workspace_id);

    UPDATE public.folders
    SET name        = p_name,
        description = p_description,
        updated_at  = NOW()
    WHERE id = p_folder_id
    RETURNING jsonb_build_object(
        'id',           id,
        'workspace_id', workspace_id,
        'name',         name,
        'description',  description,
        'created_at',   created_at,
        'updated_at',   updated_at
    ) INTO _result;

    RETURN _result;
END;
$$;

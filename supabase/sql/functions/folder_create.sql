-- folder_create(p_name, p_description)
--
-- Creates a new folder for the current user.
-- Returns the new folder as JSONB.
--
-- Called by: webapp CloudStorage.createFolder
-- Tables:   folders

CREATE OR REPLACE FUNCTION public.folder_create(p_name TEXT, p_description TEXT DEFAULT '')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_folder JSONB;
BEGIN
    INSERT INTO public.folders (user_id, name, description)
    VALUES (auth.uid(), p_name, p_description)
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

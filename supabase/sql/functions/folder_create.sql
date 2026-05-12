-- folder_create(p_name, p_workspace_id, p_description)
--
-- Creates a new folder in the given workspace.
-- Caller must be at least a creator in the workspace.
-- Returns the new folder as JSONB.
--
-- Called by: webapp CloudStorage.createFolder
-- Tables:   folders, workspaces

CREATE OR REPLACE FUNCTION public.folder_create(
    p_name         TEXT,
    p_workspace_id UUID,
    p_description  TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _folder JSONB;
BEGIN
    PERFORM public.assert_workspace_creator(p_workspace_id);

    INSERT INTO public.folders (workspace_id, name, description)
    VALUES (p_workspace_id, p_name, p_description)
    RETURNING jsonb_build_object(
        'id',           id,
        'workspace_id', workspace_id,
        'name',         name,
        'description',  description,
        'created_at',   created_at,
        'updated_at',   updated_at
    ) INTO _folder;

    RETURN _folder;
END;
$$;

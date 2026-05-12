-- folder_list(p_workspace_id)
--
-- Returns all folders for the given workspace, ordered by creation date.
-- Caller must be a member (any role) of the workspace.
-- Includes a count of non-deleted, ready projects in each folder.
--
-- Called by: webapp CloudStorage.listFolders
-- Tables:   folders, projects

CREATE OR REPLACE FUNCTION public.folder_list(p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM public.assert_workspace_viewer(p_workspace_id);

    RETURN (
        SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'created_at') ASC), '[]'::jsonb)
        FROM (
            SELECT jsonb_build_object(
                'id',            f.id,
                'workspace_id',  f.workspace_id,
                'name',          f.name,
                'description',   f.description,
                'created_at',    f.created_at,
                'updated_at',    f.updated_at,
                'project_count', (
                    SELECT COUNT(*)
                    FROM public.projects p
                    WHERE p.folder_id = f.id
                      AND p.deleted_at IS NULL
                      AND p.upload_status = 'ready'
                )
            ) AS row_data
            FROM public.folders f
            WHERE f.workspace_id = p_workspace_id
        ) sub
    );
END;
$$;

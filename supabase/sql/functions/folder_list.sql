-- folder_list()
--
-- Returns all folders for the current user, ordered by creation date.
-- Includes a count of non-deleted projects in each folder.
--
-- Called by: webapp CloudStorage.listFolders
-- Tables:   folders, projects

CREATE OR REPLACE FUNCTION public.folder_list()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'created_at') ASC), '[]'::jsonb)
    FROM (
        SELECT jsonb_build_object(
            'id', f.id,
            'name', f.name,
            'description', f.description,
            'created_at', f.created_at,
            'updated_at', f.updated_at,
            'project_count', (
                SELECT COUNT(*)
                FROM public.projects p
                WHERE p.folder_id = f.id
                  AND p.deleted_at IS NULL
                  AND p.upload_status = 'ready'
            )
        ) AS row_data
        FROM public.folders f
        WHERE f.user_id = auth.uid()
    ) sub;
$$;

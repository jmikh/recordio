-- project_list()
--
-- Returns lightweight project summaries for the dashboard.
-- Returns all non-permanently-deleted projects with upload_status = 'ready'.
-- Includes both active and soft-deleted (trash) projects — client filters by deleted_at.
-- Ordered by updated_at descending.
--
-- Called by: webapp CloudStorage.listProjectsSummary
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_list()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'updated_at') DESC), '[]'::jsonb)
    FROM (
        SELECT jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'thumbnail_storage_path', p.thumbnail_storage_path,
            'last_accessed_at', p.last_accessed_at,
            'updated_at', p.updated_at,
            'created_at', p.created_at,
            'expires_at', p.expires_at,
            'deleted_at', p.deleted_at,
            'cloud_version', p.cloud_version,
            'duration_ms', p.duration_ms,
            'is_shared', p.slug IS NOT NULL,
            'slug', p.slug,
            'folder_id', p.folder_id,
            'is_starred', p.is_starred
        ) AS row_data
        FROM public.projects p
        WHERE p.user_id = auth.uid()
          AND p.permanently_deleted = false
          AND p.upload_status = 'ready'
    ) sub;
$$;

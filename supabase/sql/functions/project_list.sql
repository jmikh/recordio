-- project_list(p_workspace_id)
--
-- Returns lightweight project summaries for all non-permanently-deleted,
-- ready projects in the given workspace visible to the caller.
-- Caller must be a workspace member (any role).
-- Includes both active and soft-deleted projects — client filters by deleted_at.
-- Ordered by updated_at descending.
--
-- Called by: webapp CloudStorage.listProjectsSummary
-- Tables:   projects, workspace_members

CREATE OR REPLACE FUNCTION public.project_list(p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM public.assert_workspace_viewer(p_workspace_id);

    RETURN (
        SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'updated_at') DESC), '[]'::jsonb)
        FROM (
            SELECT jsonb_build_object(
                'id',                     p.id,
                'name',                   p.name,
                'created_by',             p.created_by,
                'owner_id',               p.owner_id,
                'workspace_id',           p.workspace_id,
                'thumbnail_storage_path', p.thumbnail_storage_path,
                'last_accessed_at',       p.last_accessed_at,
                'updated_at',             p.updated_at,
                'created_at',             p.created_at,
                'expires_at',             p.expires_at,
                'deleted_at',             p.deleted_at,
                'cloud_version',          p.cloud_version,
                'duration_ms',            p.duration_ms,
                'slug',                   p.slug,
                'share_policy',           p.share_policy,
                'is_shared',              p.slug IS NOT NULL,
                'folder_id',              p.folder_id,
                'is_starred',             p.is_starred
            ) AS row_data
            FROM public.projects p
            WHERE p.workspace_id = p_workspace_id
              AND p.permanently_deleted = false
              AND p.upload_status = 'ready'
        ) sub
    );
END;
$$;

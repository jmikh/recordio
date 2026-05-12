-- project_get(p_project_id)
--
-- Returns full project metadata for the authenticated user.
-- Caller must be a project editor (owner or explicit editor).
-- Includes workspace info, editors list, created_by, and owner_id.
-- Bumps last_accessed_at on read.
-- Returns NULL if the project doesn't exist, is deleted, or caller has no access.
--
-- Called by: webapp CloudStorage.loadProjectMetadata, editor/App.tsx on open
-- Tables:   projects, project_editors, workspaces, user_profiles

CREATE OR REPLACE FUNCTION public.project_get(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    PERFORM public.assert_project_editor(p_project_id);

    UPDATE public.projects
    SET last_accessed_at = NOW()
    WHERE id = p_project_id AND deleted_at IS NULL;

    SELECT jsonb_build_object(
        'id',                     p.id,
        'name',                   p.name,
        'created_by',             p.created_by,
        'owner_id',               p.owner_id,
        'workspace_id',           p.workspace_id,
        'project_data',           p.project_data,
        'cloud_version',          p.cloud_version,
        'upload_status',          p.upload_status,
        'last_accessed_at',       p.last_accessed_at,
        'updated_at',             p.updated_at,
        'created_at',             p.created_at,
        'expires_at',             p.expires_at,
        'thumbnail_storage_path', p.thumbnail_storage_path,
        'slug',                   p.slug,
        'share_policy',           p.share_policy,
        'is_shared',              p.slug IS NOT NULL,
        'folder_id',              p.folder_id,
        'is_starred',             p.is_starred,
        'editors',                (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'user_id', pe.user_id,
                'email',   u.email,
                'name',    up.name
            )), '[]'::jsonb)
            FROM public.project_editors pe
            JOIN auth.users u ON u.id = pe.user_id
            LEFT JOIN public.user_profiles up ON up.user_id = pe.user_id
            WHERE pe.project_id = p.id
        )
    ) INTO result
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL;

    RETURN result;
END;
$$;

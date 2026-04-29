-- project_get(p_project_id)
--
-- Returns full project metadata for the authenticated user.
-- Also bumps last_accessed_at so there's no need for a separate touch call.
-- Returns NULL if the project doesn't exist or is deleted.
--
-- Called by: webapp CloudStorage.loadProjectMetadata, editor/App.tsx on open
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_get(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    UPDATE public.projects
    SET last_accessed_at = NOW()
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND deleted_at IS NULL;

    SELECT jsonb_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'name', p.name,
        'project_data', p.project_data,
        'cloud_version', p.cloud_version,
        'upload_status', p.upload_status,
        'cf_video_uid', p.cf_video_uid,
        'published_at', p.published_at,
        'share_description', p.share_description,
        'last_accessed_at', p.last_accessed_at,
        'updated_at', p.updated_at,
        'created_at', p.created_at,
        'expires_at', p.expires_at,
        'thumbnail_storage_path', p.thumbnail_storage_path
    ) INTO result
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.user_id = auth.uid()
      AND p.deleted_at IS NULL;

    RETURN result;
END;
$$;

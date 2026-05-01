-- project_list()
--
-- Returns lightweight project summaries for the dashboard.
-- Only returns non-deleted projects with upload_status = 'ready'.
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
            'cf_video_uid', p.cf_video_uid,
            'cloud_version', p.cloud_version,
            'duration_ms', p.duration_ms,
            'is_shared', sv.id IS NOT NULL
        ) AS row_data
        FROM public.projects p
        LEFT JOIN public.shared_videos sv
            ON sv.project_id = p.id AND sv.policy = 'public'
        WHERE p.user_id = auth.uid()
          AND p.deleted_at IS NULL
          AND p.upload_status = 'ready'
    ) sub;
$$;

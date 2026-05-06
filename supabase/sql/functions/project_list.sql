-- project_list()
--
-- Returns lightweight project summaries for the dashboard.
-- Returns all non-permanently-deleted projects with upload_status = 'ready'.
-- Includes both active and soft-deleted (trash) projects — client filters by deleted_at.
-- Ordered by updated_at descending.
--
-- For free users (no active subscription and no active trial), enforces a 5-project limit
-- by soft-deleting the oldest active projects beyond the cap before returning results.
--
-- Called by: webapp CloudStorage.listProjectsSummary
-- Tables:   projects, subscriptions, user_profiles

CREATE OR REPLACE FUNCTION public.project_list()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _uid UUID := auth.uid();
    _has_pro BOOLEAN := false;
    _free_limit INT := 5;
    _active_count INT;
BEGIN
    -- Check Stripe subscription
    SELECT true INTO _has_pro
    FROM public.subscriptions
    WHERE user_id = _uid
      AND status IN ('active', 'trialing', 'past_due')
    LIMIT 1;

    -- Check free trial if no subscription
    IF NOT _has_pro THEN
        SELECT (trial_ends_at IS NOT NULL AND trial_ends_at > NOW()) INTO _has_pro
        FROM public.user_profiles
        WHERE user_id = _uid;
    END IF;

    _has_pro := COALESCE(_has_pro, false);

    -- Enforce free-tier project cap: soft-delete oldest active projects beyond limit
    IF NOT _has_pro THEN
        SELECT COUNT(*) INTO _active_count
        FROM public.projects
        WHERE user_id = _uid
          AND permanently_deleted = false
          AND upload_status = 'ready'
          AND deleted_at IS NULL;

        IF _active_count > _free_limit THEN
            UPDATE public.projects
            SET deleted_at = NOW()
            WHERE id IN (
                SELECT id
                FROM public.projects
                WHERE user_id = _uid
                  AND permanently_deleted = false
                  AND upload_status = 'ready'
                  AND deleted_at IS NULL
                ORDER BY created_at ASC
                LIMIT _active_count - _free_limit
            );
        END IF;
    END IF;

    -- Return all projects (active + trashed)
    RETURN (
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
            WHERE p.user_id = _uid
              AND p.permanently_deleted = false
              AND p.upload_status = 'ready'
        ) sub
    );
END;
$$;

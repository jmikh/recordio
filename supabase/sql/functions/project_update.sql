-- project_update(p_project_id, p_project_data, p_duration_ms, p_expected_version)
--
-- Updates project data with optimistic concurrency control.
-- Caller must be a project editor (owner or explicit editor).
-- If p_expected_version is provided, the update only succeeds when
-- cloud_version matches (returns NULL on conflict).
-- Returns the new cloud_version on success, NULL on conflict.
--
-- Called by: webapp CloudStorage.saveProjectMetadata
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_update(
    p_project_id      UUID,
    p_project_data    JSONB,
    p_duration_ms     INT DEFAULT NULL,
    p_expected_version INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_version  INT;
    current_hash TEXT;
BEGIN
    PERFORM public.assert_project_editor(p_project_id);

    -- Skip version bump if project_data is unchanged
    SELECT md5(project_data::text) INTO current_hash
    FROM public.projects
    WHERE id = p_project_id;

    IF current_hash IS NOT NULL AND current_hash = md5(p_project_data::text) THEN
        UPDATE public.projects
        SET duration_ms = p_duration_ms,
            updated_at  = NOW()
        WHERE id = p_project_id
        RETURNING cloud_version INTO new_version;
        RETURN new_version;
    END IF;

    IF p_expected_version IS NOT NULL THEN
        UPDATE public.projects
        SET project_data  = p_project_data,
            cloud_version = p_expected_version + 1,
            duration_ms   = p_duration_ms,
            updated_at    = NOW()
        WHERE id = p_project_id
          AND cloud_version = p_expected_version
        RETURNING cloud_version INTO new_version;
    ELSE
        UPDATE public.projects
        SET project_data = p_project_data,
            duration_ms  = p_duration_ms,
            updated_at   = NOW()
        WHERE id = p_project_id
          AND deleted_at IS NULL
        RETURNING cloud_version INTO new_version;
    END IF;

    RETURN new_version;
END;
$$;

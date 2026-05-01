-- project_update(p_project_id, p_project_data, p_duration_ms, p_expected_version)
--
-- Updates project metadata with optimistic concurrency control.
-- If p_expected_version is provided, the update only succeeds when
-- cloud_version matches (returns NULL on conflict).
-- Returns the new cloud_version on success, NULL on conflict.
--
-- Called by: webapp CloudStorage.saveProjectMetadata
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_update(
    p_project_id UUID,
    p_project_data JSONB,
    p_duration_ms INT DEFAULT NULL,
    p_expected_version INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_version INT;
    current_hash TEXT;
BEGIN
    -- Skip version bump if project_data is unchanged
    SELECT md5(project_data::text) INTO current_hash
    FROM public.projects
    WHERE id = p_project_id;

    IF current_hash IS NOT NULL AND current_hash = md5(p_project_data::text) THEN
        -- Data unchanged — update duration/timestamp but don't bump cloud_version
        UPDATE public.projects
        SET duration_ms = p_duration_ms,
            updated_at = NOW()
        WHERE id = p_project_id
          AND user_id = auth.uid()
        RETURNING cloud_version INTO new_version;
        RETURN new_version;
    END IF;

    IF p_expected_version IS NOT NULL THEN
        -- Optimistic concurrency update
        UPDATE public.projects
        SET project_data = p_project_data,
            cloud_version = p_expected_version + 1,
            duration_ms = p_duration_ms,
            updated_at = NOW()
        WHERE id = p_project_id
          AND user_id = auth.uid()
          AND cloud_version = p_expected_version
        RETURNING cloud_version INTO new_version;
    ELSE
        -- Simple update (no version check)
        UPDATE public.projects
        SET project_data = p_project_data,
            duration_ms = p_duration_ms,
            updated_at = NOW()
        WHERE id = p_project_id
          AND user_id = auth.uid()
          AND deleted_at IS NULL
        RETURNING cloud_version INTO new_version;
    END IF;

    RETURN new_version;
END;
$$;

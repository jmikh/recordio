-- render_job_get_or_create(p_project_id, p_user_id, p_cloud_version)
--
-- Atomically resolves a render job for a specific cloud_version:
--   1. Cache hit: completed render for this (project_id, cloud_version) → return path
--   2. Dedup: pending job for this (project_id, cloud_version) → return it
--   3. Retry: failed/canceled job exists → reset to pending (reuse row)
--   4. New: no row exists → insert as pending
--
-- cloud_version is passed explicitly by the caller — no projects table lookup.
--
-- Returns: { job_id, status, is_new, render_storage_path }
--   job_id              UUID   — the render job row id
--   status              TEXT   — 'completed' | 'pending'
--   is_new              BOOL   — true when the caller should dispatch the render worker
--   render_storage_path TEXT   — storage path for the rendered mp4 (null for dedup pending)
--
-- Called by: edge function render-job-create
-- Tables:   render_jobs

DROP FUNCTION IF EXISTS public.render_job_start(UUID, UUID);
DROP FUNCTION IF EXISTS public.render_job_resolve(UUID, UUID);
DROP FUNCTION IF EXISTS public.render_job_get_or_create(UUID, UUID, INT);

CREATE OR REPLACE FUNCTION public.render_job_get_or_create(
    p_project_id UUID,
    p_user_id UUID,
    p_cloud_version INT
)
RETURNS TABLE(job_id UUID, status TEXT, is_new BOOLEAN, render_storage_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_existing_status TEXT;
    v_existing_path TEXT;
    v_render_storage_path TEXT;
    v_new_id UUID;
BEGIN
    -- 1. Check for any existing row at this (project_id, cloud_version)
    SELECT rj.id, rj.status, rj.render_storage_path
    INTO v_existing_id, v_existing_status, v_existing_path
    FROM public.render_jobs rj
    WHERE rj.project_id = p_project_id
      AND rj.cloud_version = p_cloud_version;

    IF v_existing_id IS NOT NULL THEN
        -- Cache hit: already completed
        IF v_existing_status = 'completed' THEN
            RETURN QUERY SELECT v_existing_id, 'completed'::TEXT, FALSE, v_existing_path;
            RETURN;
        END IF;

        -- Dedup: already pending
        IF v_existing_status = 'pending' THEN
            RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, FALSE, v_existing_path;
            RETURN;
        END IF;

        -- Retry: failed/canceled → reset to pending (keep error for history, bump attempt)
        v_render_storage_path := p_user_id || '/' || p_project_id || '/renders/v' || p_cloud_version || '.mp4';

        UPDATE public.render_jobs
        SET status = 'pending',
            progress = NULL,
            attempt_count = attempt_count + 1,
            render_storage_path = v_render_storage_path,
            start_duration_s = NULL,
            download_duration_s = NULL,
            render_duration_s = NULL,
            upload_duration_s = NULL,
            total_duration_s = NULL,
            updated_at = NOW()
        WHERE id = v_existing_id;

        RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, TRUE, v_render_storage_path;
        RETURN;
    END IF;

    -- 4. No row exists → insert new job
    v_render_storage_path := p_user_id || '/' || p_project_id || '/renders/v' || p_cloud_version || '.mp4';

    INSERT INTO public.render_jobs (project_id, user_id, cloud_version, render_storage_path)
    VALUES (p_project_id, p_user_id, p_cloud_version, v_render_storage_path)
    RETURNING render_jobs.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, 'pending'::TEXT, TRUE, v_render_storage_path;
END;
$$;

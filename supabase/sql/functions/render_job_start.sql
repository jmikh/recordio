-- render_job_start(p_project_id, p_user_id)
--
-- Atomically starts a render job:
--   1. Read project's cloud_version and render_cloud_version.
--   2. Cache hit: if they match, return 'completed' (no job needed).
--   3. Dedup: if a pending job exists for the current cloud_version, return it.
--   4. Cancel any stale pending jobs for this project.
--   5. Insert a new pending job.
--
-- The unique partial index idx_render_jobs_one_pending_per_project acts as
-- a safety net — this function handles the cancel-before-insert so the
-- constraint is never hit in practice.
--
-- Called by: edge function render-start-job (not exposed to clients)
-- Tables:   projects, render_jobs

DROP FUNCTION IF EXISTS public.render_job_start(UUID, UUID);

CREATE OR REPLACE FUNCTION public.render_job_start(
    p_project_id UUID,
    p_user_id UUID
)
RETURNS TABLE(job_id UUID, status TEXT, is_new BOOLEAN, render_storage_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cloud_version INT;
    v_render_cloud_version INT;
    v_render_storage_path TEXT;
    v_existing_id UUID;
    v_new_id UUID;
BEGIN
    -- 1. Read project versions
    SELECT p.cloud_version, p.render_cloud_version
    INTO v_cloud_version, v_render_cloud_version
    FROM public.projects p
    WHERE p.id = p_project_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found: %', p_project_id;
    END IF;

    -- 2. Cache hit: render is already up to date
    IF v_cloud_version = v_render_cloud_version THEN
        RETURN QUERY SELECT NULL::UUID, 'completed'::TEXT, FALSE, NULL::TEXT;
        RETURN;
    END IF;

    -- 3. Dedup: return existing pending job if same cloud_version
    SELECT rj.id INTO v_existing_id
    FROM public.render_jobs rj
    WHERE rj.project_id = p_project_id
      AND rj.cloud_version = v_cloud_version
      AND rj.status = 'pending';

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, FALSE, NULL::TEXT;
        RETURN;
    END IF;

    -- 4. Cancel any stale pending jobs for this project
    UPDATE public.render_jobs rj
    SET status = 'canceled', updated_at = NOW()
    WHERE rj.project_id = p_project_id
      AND rj.status = 'pending';

    -- 5. Insert new job (path is the single source of truth for render output location)
    v_render_storage_path := p_user_id || '/' || p_project_id || '/render_v' || v_cloud_version || '.mp4';

    INSERT INTO public.render_jobs (project_id, user_id, cloud_version, render_storage_path)
    VALUES (p_project_id, p_user_id, v_cloud_version, v_render_storage_path)
    RETURNING render_jobs.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, 'pending'::TEXT, TRUE, v_render_storage_path;
END;
$$;

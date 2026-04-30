-- mux_video_start(p_project_id)
--
-- Atomically starts a Mux upload job:
--   1. Check shared_videos exists (never shared -> skip)
--   2. Read project cloud_version + user_id
--   3. Cache hit: completed mux_video for current cloud_version
--   4. Dedup: pending mux_video for current cloud_version
--   5. Check if completed render exists (no render -> signal needs_render)
--   6. Cancel any stale pending mux uploads
--   7. Insert new pending mux_videos row
--
-- Does NOT create a pending row if no render exists — row only created
-- when there's an MP4 to send to Mux.
--
-- user_id is derived from the project — no need to pass it in.
--
-- Mirrors render_job_start pattern.
-- Called by: edge function mux-video-upload
-- Tables:   shared_videos, projects, mux_videos, render_jobs

DROP FUNCTION IF EXISTS public.mux_video_start(UUID, UUID);
DROP FUNCTION IF EXISTS public.mux_video_start(UUID);

CREATE OR REPLACE FUNCTION public.mux_video_start(
    p_project_id UUID
)
RETURNS TABLE(
    mux_video_id UUID,
    status TEXT,
    is_new BOOLEAN,
    needs_render BOOLEAN,
    render_storage_path TEXT,
    cloud_version INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_cloud_version INT;
    v_shared_exists BOOLEAN;
    v_existing_id UUID;
    v_render_path TEXT;
    v_new_id UUID;
BEGIN
    -- 1. Check shared_videos exists
    SELECT EXISTS(
        SELECT 1 FROM public.shared_videos sv WHERE sv.project_id = p_project_id
    ) INTO v_shared_exists;

    IF NOT v_shared_exists THEN
        RETURN QUERY SELECT NULL::UUID, 'not_shared'::TEXT, FALSE, FALSE, NULL::TEXT, NULL::INT;
        RETURN;
    END IF;

    -- 2. Read project cloud_version and user_id
    SELECT p.cloud_version, p.user_id INTO v_cloud_version, v_user_id
    FROM public.projects p WHERE p.id = p_project_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found: %', p_project_id;
    END IF;

    -- 3. Cache hit: completed mux_video for current cloud_version
    SELECT mv.id INTO v_existing_id
    FROM public.mux_videos mv
    WHERE mv.project_id = p_project_id
      AND mv.cloud_version = v_cloud_version
      AND mv.status = 'completed'
      AND mv.is_deleted = FALSE;

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_id, 'completed'::TEXT, FALSE, FALSE, NULL::TEXT, v_cloud_version;
        RETURN;
    END IF;

    -- 4. Dedup: pending mux_video for current cloud_version
    SELECT mv.id INTO v_existing_id
    FROM public.mux_videos mv
    WHERE mv.project_id = p_project_id
      AND mv.cloud_version = v_cloud_version
      AND mv.status = 'pending';

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, FALSE, FALSE, NULL::TEXT, v_cloud_version;
        RETURN;
    END IF;

    -- 5. Check if completed render exists for this cloud_version
    SELECT rj.render_storage_path INTO v_render_path
    FROM public.render_jobs rj
    WHERE rj.project_id = p_project_id
      AND rj.cloud_version = v_cloud_version
      AND rj.status = 'completed'
    ORDER BY rj.created_at DESC
    LIMIT 1;

    IF v_render_path IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, 'needs_render'::TEXT, FALSE, TRUE, NULL::TEXT, v_cloud_version;
        RETURN;
    END IF;

    -- 6. Cancel stale pending mux uploads for this project
    UPDATE public.mux_videos mv
    SET status = 'canceled', updated_at = NOW()
    WHERE mv.project_id = p_project_id
      AND mv.status = 'pending';

    -- 7. Insert new pending mux_videos row
    INSERT INTO public.mux_videos (project_id, user_id, cloud_version, render_storage_path)
    VALUES (p_project_id, v_user_id, v_cloud_version, v_render_path)
    RETURNING mux_videos.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, 'pending'::TEXT, TRUE, FALSE, v_render_path, v_cloud_version;
END;
$$;

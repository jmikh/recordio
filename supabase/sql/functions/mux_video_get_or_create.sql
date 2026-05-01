-- mux_video_get_or_create(p_project_id, p_user_id, p_cloud_version)
--
-- Atomically resolves a mux_video row for a specific cloud_version:
--   1. Cache hit: completed mux_video → return playback data
--   2. Dedup: pending mux_video → return it
--   3. Retry: failed/canceled → reset to pending (reuse row)
--   4. New: no row exists → insert as pending
--
-- cloud_version is passed explicitly by the caller — no projects table lookup.
--
-- Returns: { mux_video_id, status, is_new, cloud_version }
--   mux_video_id  UUID   — the mux_video row id
--   status        TEXT   — 'completed' | 'pending'
--   is_new        BOOL   — true when the caller should kick off the render/upload pipeline
--   cloud_version INT    — echo of p_cloud_version
--
-- Called by: edge function mux-video-create
-- Tables:   mux_videos

DROP FUNCTION IF EXISTS public.mux_video_start(UUID, UUID);
DROP FUNCTION IF EXISTS public.mux_video_start(UUID);
DROP FUNCTION IF EXISTS public.mux_video_resolve(UUID);
DROP FUNCTION IF EXISTS public.mux_video_get_or_create(UUID, UUID, INT);

CREATE OR REPLACE FUNCTION public.mux_video_get_or_create(
    p_project_id UUID,
    p_user_id UUID,
    p_cloud_version INT
)
RETURNS TABLE(
    mux_video_id UUID,
    status TEXT,
    is_new BOOLEAN,
    cloud_version INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_existing_status TEXT;
    v_new_id UUID;
BEGIN
    -- 1. Check for any existing row at this (project_id, cloud_version)
    SELECT mv.id, mv.status INTO v_existing_id, v_existing_status
    FROM public.mux_videos mv
    WHERE mv.project_id = p_project_id
      AND mv.cloud_version = p_cloud_version;

    IF v_existing_id IS NOT NULL THEN
        -- Cache hit: already completed
        IF v_existing_status = 'completed' THEN
            RETURN QUERY SELECT v_existing_id, 'completed'::TEXT, FALSE, p_cloud_version;
            RETURN;
        END IF;

        -- Dedup: already pending
        IF v_existing_status = 'pending' THEN
            RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, FALSE, p_cloud_version;
            RETURN;
        END IF;

        -- Retry: failed/canceled → reset to pending
        UPDATE public.mux_videos
        SET status = 'pending',
            error = NULL,
            mux_asset_id = NULL,
            mux_playback_id = NULL,
            render_storage_path = NULL,
            is_deleted = FALSE,
            updated_at = NOW()
        WHERE id = v_existing_id;

        RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, TRUE, p_cloud_version;
        RETURN;
    END IF;

    -- 2. No row exists → insert new as 'pending'
    INSERT INTO public.mux_videos (project_id, user_id, cloud_version, status)
    VALUES (p_project_id, p_user_id, p_cloud_version, 'pending')
    RETURNING mux_videos.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, 'pending'::TEXT, TRUE, p_cloud_version;
END;
$$;

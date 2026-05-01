-- mux_video_complete(p_mux_asset_id, p_playback_id)
--
-- Marks a pending mux_video as completed when Mux webhook fires.
--   1. Find pending mux_video by mux_asset_id
--   2. Set status = 'completed', mux_playback_id
--
-- Old version cleanup is handled by the mux-video-purge cron.
--
-- Returns: { mux_video_id, project_id, found }
--
-- Called by: edge function mux-video-hook on video.asset.ready
-- Tables:   mux_videos

DROP FUNCTION IF EXISTS public.mux_video_complete(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.mux_video_complete(
    p_mux_asset_id TEXT,
    p_playback_id TEXT
)
RETURNS TABLE(mux_video_id UUID, project_id UUID, found BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
    v_project_id UUID;
BEGIN
    -- 1. Find mux_video by asset ID
    SELECT mv.id, mv.project_id INTO v_id, v_project_id
    FROM public.mux_videos mv
    WHERE mv.mux_asset_id = p_mux_asset_id;

    IF v_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, FALSE;
        RETURN;
    END IF;

    -- 2. Mark completed with playback ID
    UPDATE public.mux_videos
    SET status = 'completed',
        mux_playback_id = p_playback_id,
        updated_at = NOW()
    WHERE id = v_id;

    RETURN QUERY SELECT v_id, v_project_id, TRUE;
END;
$$;

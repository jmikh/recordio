-- mux_video_purge_candidates()
--
-- Returns mux_videos rows that are older than the highest completed version
-- per project. Only returns non-pending rows (completed, failed, canceled)
-- that are safe to delete.
--
-- Returns: { id, mux_asset_id, render_storage_path }
--
-- Called by: edge function mux-video-purge
-- Tables:   mux_videos

DROP FUNCTION IF EXISTS public.mux_video_mark_old_deleted();
DROP FUNCTION IF EXISTS public.mux_video_purge_candidates();

CREATE OR REPLACE FUNCTION public.mux_video_purge_candidates()
RETURNS TABLE(id UUID, mux_asset_id TEXT, render_storage_path TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
    WITH latest AS (
        SELECT mv.project_id, MAX(mv.cloud_version) AS max_version
        FROM public.mux_videos mv
        WHERE mv.status = 'completed'
        GROUP BY mv.project_id
    )
    SELECT mv.id, mv.mux_asset_id, mv.render_storage_path
    FROM public.mux_videos mv
    JOIN latest l ON mv.project_id = l.project_id
    WHERE mv.cloud_version < l.max_version
      AND mv.status != 'pending'
    LIMIT 50;
$$;

-- Service-role only — called by mux-video-purge edge function
REVOKE ALL ON FUNCTION public.mux_video_purge_candidates() FROM public;
REVOKE ALL ON FUNCTION public.mux_video_purge_candidates() FROM anon;
REVOKE ALL ON FUNCTION public.mux_video_purge_candidates() FROM authenticated;

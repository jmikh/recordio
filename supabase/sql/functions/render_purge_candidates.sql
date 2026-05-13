-- render_purge_candidates()
--
-- Returns render_jobs rows that are older than the highest completed version
-- per project. Only returns non-pending rows (completed, failed, canceled)
-- that are safe to delete.
--
-- Returns: { id, render_storage_path }
--
-- Called by: edge function render-purge
-- Tables:   render_jobs

DROP FUNCTION IF EXISTS public.render_purge_candidates();

CREATE OR REPLACE FUNCTION public.render_purge_candidates()
RETURNS TABLE(id UUID, render_storage_path TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
    WITH latest AS (
        SELECT rj.project_id, MAX(rj.cloud_version) AS max_version
        FROM public.render_jobs rj
        WHERE rj.status = 'completed'
        GROUP BY rj.project_id
    )
    SELECT rj.id, rj.render_storage_path
    FROM public.render_jobs rj
    JOIN latest l ON rj.project_id = l.project_id
    WHERE rj.cloud_version < l.max_version
      AND rj.status != 'pending'
    LIMIT 50;
$$;

-- Service-role only — called by render-purge edge function
REVOKE ALL ON FUNCTION public.render_purge_candidates() FROM public;
REVOKE ALL ON FUNCTION public.render_purge_candidates() FROM anon;
REVOKE ALL ON FUNCTION public.render_purge_candidates() FROM authenticated;

-- render_job_get_status(p_job_id)
--
-- Returns render job status fields for the given job ID.
-- Caller must be a project editor (owner or explicit editor) for the job's project.
-- Returns NULL if the job doesn't exist or caller has no access.
--
-- Called by: webapp useCloudRender.ts polling
-- Tables:   render_jobs

CREATE OR REPLACE FUNCTION public.render_job_get_status(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_id UUID;
    result JSONB;
BEGIN
    SELECT rj.project_id INTO v_project_id
    FROM public.render_jobs rj
    WHERE rj.id = p_job_id;

    IF v_project_id IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM public.assert_project_editor(v_project_id);

    SELECT jsonb_build_object(
        'status',               rj.status,
        'progress',             rj.progress,
        'error',                rj.error,
        'render_storage_path',  rj.render_storage_path
    ) INTO result
    FROM public.render_jobs rj
    WHERE rj.id = p_job_id;

    RETURN result;
END;
$$;

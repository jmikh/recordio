-- project_confirm_upload(p_project_id)
--
-- Flips a project's upload_status from 'pending' to 'ready' after the client
-- has successfully uploaded all media blobs.
-- Caller must be the project owner.
-- Returns true if the row was updated, false if not found / already ready.
--
-- Called by: webapp CloudProjectService after all media uploads complete
-- Tables:   projects

DROP FUNCTION IF EXISTS public.project_confirm_upload(UUID, BIGINT, BIGINT, BIGINT);

CREATE OR REPLACE FUNCTION public.project_confirm_upload(
    p_project_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rows_updated INT;
BEGIN
    UPDATE public.projects
    SET upload_status = 'ready'
    WHERE id = p_project_id
      AND owner_id = auth.uid()
      AND upload_status = 'pending';

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated > 0;
END;
$$;

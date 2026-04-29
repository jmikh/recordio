-- project_confirm_upload(p_project_id, p_screen_size_bytes, p_camera_size_bytes, p_mic_size_bytes)
--
-- Flips a project's upload_status from 'pending' to 'ready' after the client
-- has successfully uploaded all media blobs. Also records file sizes for quota tracking.
-- Uses auth.uid() so it can only be called by the project owner.
--
-- Returns true if the row was updated, false if not found / already ready.
--
-- Called by: webapp CloudProjectService after all media uploads complete
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_confirm_upload(
    p_project_id UUID,
    p_screen_size_bytes BIGINT DEFAULT 0,
    p_camera_size_bytes BIGINT DEFAULT 0,
    p_mic_size_bytes BIGINT DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rows_updated INT;
BEGIN
    UPDATE public.projects
    SET upload_status = 'ready',
        screen_size_bytes = p_screen_size_bytes,
        camera_size_bytes = p_camera_size_bytes,
        mic_size_bytes = p_mic_size_bytes
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND upload_status = 'pending';

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated > 0;
END;
$$;

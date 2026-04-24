-- get_user_storage_bytes(p_user_id)
--
-- Returns total media bytes used by a user across all non-deleted projects.
-- Excludes projects mid-cleanup (upload_status = 'deleting') so quota is
-- freed immediately on soft-delete.
--
-- Called by: storage-upload-url edge function (quota check)
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.get_user_storage_bytes(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(SUM(screen_size_bytes + camera_size_bytes + mic_size_bytes), 0)
    FROM public.projects
    WHERE user_id = p_user_id
      AND deleted_at IS NULL
      AND upload_status != 'deleting';
$$;

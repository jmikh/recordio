-- cron_cleanup_stale_uploads()
--
-- Moves uploads stuck in 'uploading' status for >1 hour into the
-- deleted_videos queue, then removes them from shared_videos.
--
-- Trigger: pg_cron (hourly)
-- Tables:  shared_videos, deleted_videos

CREATE OR REPLACE FUNCTION public.cron_cleanup_stale_uploads()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Move stale uploading videos to the deletion queue
    INSERT INTO deleted_videos (cf_video_uid, source)
    SELECT cf_video_uid, 'stale_upload'
    FROM shared_videos
    WHERE status = 'uploading'
      AND upload_started_at < NOW() - interval '1 hour';

    -- Remove them from shared_videos
    DELETE FROM shared_videos
    WHERE status = 'uploading'
      AND upload_started_at < NOW() - interval '1 hour';

    RAISE LOG '[StaleUploadCleanup] Cleaned up stale uploads';
END;
$$;

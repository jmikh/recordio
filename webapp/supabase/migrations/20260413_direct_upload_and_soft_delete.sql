-- =============================================================================
-- Direct Creator Upload + Soft Delete
-- Run in Supabase Dashboard → SQL Editor
--
-- 1. Adds status + upload_started_at to shared_videos
-- 2. Creates deleted_videos cleanup queue
-- 3. Stale upload cleanup cron (every 15 min)
-- 4. CF purge cron (every hour, calls purge-deleted-videos edge function)
-- =============================================================================

-- Ensure extensions are available
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── 1. Alter shared_videos ────────────────────────────────────────────────────

ALTER TABLE shared_videos
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS upload_started_at TIMESTAMPTZ;

-- Backfill: all existing rows are fully uploaded
UPDATE shared_videos SET status = 'ready' WHERE status IS NULL;

-- ─── 2. Create deleted_videos table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deleted_videos (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cf_video_uid  TEXT NOT NULL,
    source        TEXT NOT NULL,       -- 'user_delete', 'stale_upload', 'reshare'
    deleted_at    TIMESTAMPTZ DEFAULT now(),
    attempts      INT DEFAULT 0
);

-- No RLS — only accessed by service role (cron jobs + edge functions)

-- ─── 3. Stale upload cleanup function + cron ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_stale_uploads()
RETURNS void AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT cron.unschedule('cleanup-stale-uploads')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-stale-uploads');

SELECT cron.schedule(
    'cleanup-stale-uploads',
    '*/15 * * * *',   -- every 15 minutes
    $$SELECT public.cleanup_stale_uploads()$$
);

-- ─── 4. CF purge cron (calls edge function via pg_net) ─────────────────────────
-- The edge function handles the actual CF Stream API calls.
-- We use pg_net to invoke it with the service role key.

-- NOTE: Replace <SUPABASE_URL> and <SERVICE_ROLE_KEY> with your actual values
-- before running this in the Supabase Dashboard.

SELECT cron.unschedule('purge-deleted-videos')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-deleted-videos');

SELECT cron.schedule(
    'purge-deleted-videos',
    '0 * * * *',   -- every hour
    $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/purge-deleted-videos',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
    );
    $$
);

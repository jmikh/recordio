-- Drop the shared_videos table (replaced by the projects table).
-- Also drops the cron job and cleanup function that operated on it.

-- Remove the cron schedule that called the cleanup function
SELECT cron.unschedule('cleanup-stale-uploads');

-- Drop the cleanup function (it references shared_videos)
DROP FUNCTION IF EXISTS public.cron_cleanup_stale_uploads();

-- Drop the table
DROP TABLE IF EXISTS public.shared_videos;

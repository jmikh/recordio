-- Remove all Cloudflare Stream artifacts (fully migrated to Mux)

-- 1. Unschedule the CF purge cron job
SELECT cron.unschedule('purge-deleted-cf-streams')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-deleted-cf-streams');

-- 2. Drop the deleted_cf_streams queue table
DROP TABLE IF EXISTS public.deleted_cf_streams;

-- 3. Drop CF columns from projects table
ALTER TABLE public.projects DROP COLUMN IF EXISTS cf_video_uid;
ALTER TABLE public.projects DROP COLUMN IF EXISTS published_at;
ALTER TABLE public.projects DROP COLUMN IF EXISTS share_description;

-- Rename deleted_videos → deleted_cf_streams
ALTER TABLE IF EXISTS public.deleted_videos RENAME TO deleted_cf_streams;

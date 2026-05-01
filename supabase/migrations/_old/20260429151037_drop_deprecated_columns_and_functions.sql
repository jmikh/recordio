-- Drop deprecated *_storage_path columns from projects table.
-- These were redundant with project_data JSON and are no longer referenced by any code.
-- (thumbnail_storage_path is kept — still actively used.)

ALTER TABLE public.projects DROP COLUMN IF EXISTS screen_storage_path;
ALTER TABLE public.projects DROP COLUMN IF EXISTS camera_storage_path;
ALTER TABLE public.projects DROP COLUMN IF EXISTS mic_storage_path;

-- Drop unused transcription usage functions.
-- Usage tracking is now handled directly by the transcribe edge function.

DROP FUNCTION IF EXISTS public.upsert_transcription_usage(UUID, NUMERIC, TIMESTAMPTZ, NUMERIC);
DROP FUNCTION IF EXISTS public.rollback_transcription_usage(UUID, NUMERIC);

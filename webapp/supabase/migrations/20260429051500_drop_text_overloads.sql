-- Drop old TEXT-param overloads that conflict with the new UUID-param versions.
-- The old overloads were created by earlier migrations before the type was corrected.

DROP FUNCTION IF EXISTS public.project_get(TEXT);
DROP FUNCTION IF EXISTS public.project_update(TEXT, TEXT, JSONB, INT, INT);
DROP FUNCTION IF EXISTS public.project_delete(TEXT);
DROP FUNCTION IF EXISTS public.project_confirm_upload(TEXT, BIGINT, BIGINT, BIGINT);

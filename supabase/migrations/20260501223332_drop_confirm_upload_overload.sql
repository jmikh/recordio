-- Drop the old 4-param overload of project_confirm_upload that causes
-- PostgREST PGRST203 ambiguity when calling with only p_project_id.
DROP FUNCTION IF EXISTS public.project_confirm_upload(uuid, bigint, bigint, bigint);

-- Lock down transcription_usage to backend-only access.
-- The table is only accessed by SECURITY DEFINER functions (upsert/rollback)
-- called from edge functions using the service_role key.

-- 1. Enable RLS (no policies = no client-side access)
ALTER TABLE public.transcription_usage ENABLE ROW LEVEL SECURITY;

-- 2. Revoke table privileges from client-facing roles
REVOKE ALL ON TABLE public.transcription_usage FROM anon, authenticated;

-- 3. Revoke function execute from client-facing roles
REVOKE ALL ON FUNCTION public.upsert_transcription_usage(uuid, numeric, timestamptz, numeric) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.rollback_transcription_usage(uuid, numeric) FROM anon, authenticated;

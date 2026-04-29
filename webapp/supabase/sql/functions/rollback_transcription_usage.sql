-- TODO: Remove this function — no longer called. Usage tracking is now handled
-- directly by the transcribe edge function (simple SELECT + UPDATE).

-- rollback_transcription_usage(p_user_id, p_minutes)
--
-- Decrements a user's transcription usage (floored at 0).
-- Called when a transcription job fails and usage should be refunded.
--
-- Called by: backend transcription service (on error)
-- Tables:   transcription_usage

CREATE OR REPLACE FUNCTION public.rollback_transcription_usage(
    p_user_id UUID,
    p_minutes NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE transcription_usage
    SET minutes_used = GREATEST(minutes_used - p_minutes, 0)
    WHERE user_id = p_user_id;
END;
$$;

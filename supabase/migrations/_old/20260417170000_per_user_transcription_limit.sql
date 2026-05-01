-- Add per-user minutes_limit column (default from env var, overridable per user)
ALTER TABLE transcription_usage ADD COLUMN IF NOT EXISTS minutes_limit NUMERIC(8, 3) NOT NULL DEFAULT 60;

-- Drop old function (return type changed from NUMERIC to JSON, CREATE OR REPLACE can't handle that)
DROP FUNCTION IF EXISTS upsert_transcription_usage(UUID, NUMERIC, TIMESTAMPTZ, NUMERIC);

-- Recreate with per-row limit and JSON return
CREATE OR REPLACE FUNCTION upsert_transcription_usage(
    p_user_id        UUID,
    p_minutes        NUMERIC,
    p_reset_date     TIMESTAMPTZ,
    p_default_limit  NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_minutes NUMERIC;
    v_current_reset   TIMESTAMPTZ;
    v_limit           NUMERIC;
    v_new_minutes     NUMERIC;
BEGIN
    -- Try to get existing row with a row lock
    SELECT minutes_used, reset_date, minutes_limit
    INTO v_current_minutes, v_current_reset, v_limit
    FROM transcription_usage
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- First usage ever: insert new row with default limit
        INSERT INTO transcription_usage (user_id, minutes_used, minutes_limit, reset_date)
        VALUES (p_user_id, p_minutes, p_default_limit, p_reset_date);
        RETURN json_build_object('minutes_used', p_minutes, 'minutes_limit', p_default_limit);
    END IF;

    -- Check if cycle has rolled over (reset_date is earlier than new cycle date)
    IF v_current_reset < p_reset_date THEN
        -- New cycle: reset usage
        v_new_minutes := p_minutes;
    ELSE
        -- Same cycle: check against per-user limit
        v_new_minutes := v_current_minutes + p_minutes;
        IF v_new_minutes > v_limit THEN
            RAISE EXCEPTION 'rate_limit_exceeded';
        END IF;
    END IF;

    UPDATE transcription_usage
    SET minutes_used = v_new_minutes,
        reset_date = p_reset_date
    WHERE user_id = p_user_id;

    RETURN json_build_object('minutes_used', v_new_minutes, 'minutes_limit', v_limit);
END;
$$;

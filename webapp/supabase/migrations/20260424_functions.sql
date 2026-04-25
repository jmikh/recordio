-- Auto-generated from sql/functions/*.sql
-- Run build-functions.sh to regenerate
-- 2026-04-25 03:57:03 UTC

-- ============================================================
-- Source: cron_cleanup_expired_projects.sql
-- ============================================================
-- cron_cleanup_expired_projects()
--
-- Daily cron job that soft-deletes projects past their expires_at.
-- A separate edge function handles actual Storage file + CF Stream cleanup.
--
-- Schedule: daily at midnight UTC
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.cleanup_expired_projects()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.projects
    SET deleted_at = NOW()
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW()
      AND deleted_at IS NULL;
END;
$$;

-- ============================================================
-- Source: cron_expire_trials.sql
-- ============================================================
-- cron_expire_trials()
--
-- Finds all trialing subscriptions past their period end, marks them
-- as 'expired', and updates the user's Mixpanel profile accordingly.
--
-- Trigger: pg_cron (daily)
-- Tables:  subscriptions
-- External: Mixpanel Engage API (via pg_net)

CREATE OR REPLACE FUNCTION public.cron_expire_trials()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $_$
DECLARE
    r record;
    mp_token text := '773bc18d036f7f77ec70ec94e7eec508';
BEGIN
    -- Find all trialing subscriptions past their period end
    FOR r IN
        SELECT s.user_id, s.current_period_end
        FROM public.subscriptions s
        WHERE s.status = 'trialing'
          AND s.current_period_end < now()
    LOOP
        -- Update DB
        UPDATE public.subscriptions
        SET status = 'expired', updated_at = now()
        WHERE user_id = r.user_id;

        -- Update Mixpanel profile
        PERFORM net.http_post(
            url := 'https://api.mixpanel.com/engage#profile-set',
            body := jsonb_build_array(jsonb_build_object(
                '$token', mp_token,
                '$distinct_id', r.user_id,
                '$set', jsonb_build_object(
                    'current_plan_type', 'basic',
                    'last_active_plan_type', 'pro_trial',
                    'last_active_plan_end_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                )
            )),
            headers := '{"Content-Type": "application/json", "Accept": "text/plain"}'::jsonb
        );

        RAISE LOG '[TrialExpiry] Expired trial for user: %', r.user_id;
    END LOOP;
END;
$_$;

-- ============================================================
-- Source: cron_purge_deleted_projects.sql
-- ============================================================
-- cron_purge_deleted_projects
--
-- Daily cron that calls the purge-deleted-projects edge function via pg_net.
-- The edge function permanently deletes projects soft-deleted for 3+ days,
-- cleaning up Supabase Storage files and queueing CF Stream videos for deletion.
--
-- Schedule: daily at 3 AM UTC
-- Pattern:  B (cron → edge function via pg_net)
-- Edge fn:  functions/purge-deleted-projects/index.ts

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('purge-deleted-projects')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-deleted-projects');

SELECT cron.schedule(
    'purge-deleted-projects',
    '0 3 * * *',
    $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/purge-deleted-projects',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
    );
    $$
);

-- ============================================================
-- Source: get_user_storage_bytes.sql
-- ============================================================
-- get_user_storage_bytes(p_user_id)
--
-- Returns total media bytes used by a user across all non-deleted projects.
-- Excludes projects mid-cleanup (upload_status = 'deleting') so quota is
-- freed immediately on soft-delete.
--
-- Called by: storage-upload-url edge function (quota check)
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.get_user_storage_bytes(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(SUM(screen_size_bytes + camera_size_bytes + mic_size_bytes), 0)
    FROM public.projects
    WHERE user_id = p_user_id
      AND deleted_at IS NULL
      AND upload_status != 'deleting';
$$;

-- ============================================================
-- Source: handle_new_user.sql
-- ============================================================
-- handle_new_user()
--
-- Bootstraps a new user's account by creating a 7-day free trial
-- subscription and a default storage quota.
-- Attached as an AFTER INSERT trigger on auth.users.
--
-- Trigger: auth.users INSERT trigger
-- Tables:  subscriptions, user_quotas

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Create trialing subscription (7-day free trial)
    INSERT INTO public.subscriptions (user_id, status, current_period_end, cancel_at_period_end, updated_at)
    VALUES (new.id, 'trialing', now() + interval '7 days', true, now());

    -- Create default storage quota
    INSERT INTO public.user_quotas (user_id)
    VALUES (new.id);

    RETURN new;
END;
$$;

-- ============================================================
-- Source: rollback_transcription_usage.sql
-- ============================================================
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

-- ============================================================
-- Source: set_project_expiry.sql
-- ============================================================
-- set_project_expiry(p_user_id, p_expires_at)
--
-- Sets expires_at on all non-deleted projects for a user.
-- Called from Stripe webhook when subscription status changes:
--   - User loses Pro: p_expires_at = NOW() + 14 days
--   - User becomes Pro: p_expires_at = NULL (clears countdown)
--
-- Called by: stripe-webhooks edge function
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.set_project_expiry(p_user_id UUID, p_expires_at TIMESTAMPTZ)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE public.projects
    SET expires_at = p_expires_at
    WHERE user_id = p_user_id AND deleted_at IS NULL;
$$;

-- ============================================================
-- Source: upsert_transcription_usage.sql
-- ============================================================
-- upsert_transcription_usage(p_user_id, p_minutes, p_reset_date, p_default_limit)
--
-- Tracks per-user transcription minutes. Inserts a new row on first use,
-- resets usage when a new billing cycle starts, and raises
-- 'rate_limit_exceeded' if the user would exceed their per-user limit.
--
-- Returns JSON: { minutes_used, minutes_limit }
--
-- Called by: backend transcription service (before processing)
-- Tables:   transcription_usage

CREATE OR REPLACE FUNCTION public.upsert_transcription_usage(
    p_user_id       UUID,
    p_minutes       NUMERIC,
    p_reset_date    TIMESTAMPTZ,
    p_default_limit NUMERIC
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


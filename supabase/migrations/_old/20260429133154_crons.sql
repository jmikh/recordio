-- Auto-generated from sql/crons/*.sql
-- Run sql/build-functions.sh to regenerate
-- 2026-04-29 13:31:53 UTC

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
-- Source: cron_cleanup_pending_assets.sql
-- ============================================================
-- cron_cleanup_pending_assets
--
-- Daily cron that deletes user_assets rows stuck in 'pending' status
-- for over 1 hour. These are orphans from clients that crashed between
-- getting a signed upload URL and confirming the upload.
--
-- The corresponding storage blobs (if any were uploaded) are left for
-- storage lifecycle rules to clean up.
--
-- Schedule: daily at midnight UTC
-- Pattern:  A (pure SQL, no edge function needed)

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('cleanup-pending-assets')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-pending-assets');

SELECT cron.schedule(
    'cleanup-pending-assets',
    '0 0 * * *',
    $$
    DELETE FROM public.user_assets
    WHERE status = 'pending'
      AND created_at < now() - interval '1 hour';
    $$
);

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
-- Source: cron_purge_deleted_cf_streams.sql
-- ============================================================
-- cron_purge_deleted_cf_streams
--
-- Daily cron that calls the purge-deleted-cf-streams edge function via pg_net.
-- The edge function processes the deleted_cf_streams queue by calling
-- Cloudflare Stream DELETE API for each entry.
--
-- Schedule: daily at 4 AM UTC
-- Pattern:  B (cron → edge function via pg_net)
-- Edge fn:  functions/purge-deleted-cf-streams/index.ts

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('purge-deleted-cf-streams')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-deleted-cf-streams');

SELECT cron.schedule(
    'purge-deleted-cf-streams',
    '0 4 * * *',
    $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/purge-deleted-cf-streams',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
    );
    $$
);

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
-- Source: cron_render_stale_jobs.sql
-- ============================================================
-- cron_render_stale_jobs
--
-- Every-minute cron that marks pending render jobs as failed if no heartbeat
-- in 1 minute (4+ missed 15-second heartbeats from the worker).
--
-- Schedule: every minute
-- Pattern:  A (pure SQL, no edge function needed)

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('render-stale-jobs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'render-stale-jobs');

SELECT cron.schedule(
    'render-stale-jobs',
    '* * * * *',
    $$
    UPDATE public.render_jobs
    SET status = 'failed',
        error = 'Worker unresponsive',
        updated_at = now()
    WHERE status = 'pending'
      AND updated_at < now() - interval '1 minute';
    $$
);


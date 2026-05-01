-- Auto-generated from sql/functions/*.sql
-- Run sql/build-functions.sh to regenerate
-- 2026-04-29 04:43:30 UTC

-- ============================================================
-- Source: asset_confirm_upload.sql
-- ============================================================
-- asset_confirm_upload(p_asset_id)
--
-- Flips a user_assets row from 'pending' to 'ready' after the client
-- has successfully uploaded the blob to storage via signed URL.
-- Uses auth.uid() so it can only be called by the asset owner.
--
-- Returns true if the row was updated, false if not found / already ready.
--
-- Called by: webapp UserAssetService after signed-URL upload completes
-- Tables:   user_assets

CREATE OR REPLACE FUNCTION public.asset_confirm_upload(p_asset_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rows_updated INT;
BEGIN
    UPDATE public.user_assets
    SET status = 'ready'
    WHERE id = p_asset_id
      AND user_id = auth.uid()
      AND status = 'pending';

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated > 0;
END;
$$;

-- ============================================================
-- Source: asset_delete.sql
-- ============================================================
-- asset_delete(p_asset_id)
--
-- Soft-deletes a user asset (is_deleted = true).
-- Returns the storage_path so the client can evict from local cache.
-- Returns NULL if the asset doesn't exist or isn't owned by the caller.
--
-- Called by: webapp UserAssetService.deleteAsset
-- Tables:   user_assets

CREATE OR REPLACE FUNCTION public.asset_delete(p_asset_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    path TEXT;
BEGIN
    UPDATE public.user_assets
    SET is_deleted = true
    WHERE id = p_asset_id
      AND user_id = auth.uid()
    RETURNING storage_path INTO path;

    RETURN path;
END;
$$;

-- ============================================================
-- Source: asset_list.sql
-- ============================================================
-- asset_list(p_asset_type)
--
-- Returns active (ready, not deleted) assets for the authenticated user,
-- filtered by type. Ordered by created_at descending.
--
-- Called by: webapp UserAssetService.listAssets
-- Tables:   user_assets

CREATE OR REPLACE FUNCTION public.asset_list(p_asset_type TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'created_at') DESC), '[]'::jsonb)
    FROM (
        SELECT jsonb_build_object(
            'id', a.id,
            'asset_type', a.asset_type,
            'storage_path', a.storage_path,
            'name', a.name,
            'size_bytes', a.size_bytes,
            'created_at', a.created_at
        ) AS row_data
        FROM public.user_assets a
        WHERE a.user_id = auth.uid()
          AND a.asset_type = p_asset_type
          AND a.status = 'ready'
          AND a.is_deleted = false
    ) sub;
$$;

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
-- Source: project_confirm_upload.sql
-- ============================================================
-- project_confirm_upload(p_project_id, p_screen_size_bytes, p_camera_size_bytes, p_mic_size_bytes)
--
-- Flips a project's upload_status from 'pending' to 'ready' after the client
-- has successfully uploaded all media blobs. Also records file sizes for quota tracking.
-- Uses auth.uid() so it can only be called by the project owner.
--
-- Returns true if the row was updated, false if not found / already ready.
--
-- Called by: webapp CloudProjectService after all media uploads complete
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_confirm_upload(
    p_project_id TEXT,
    p_screen_size_bytes BIGINT DEFAULT 0,
    p_camera_size_bytes BIGINT DEFAULT 0,
    p_mic_size_bytes BIGINT DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rows_updated INT;
BEGIN
    UPDATE public.projects
    SET upload_status = 'ready',
        screen_size_bytes = p_screen_size_bytes,
        camera_size_bytes = p_camera_size_bytes,
        mic_size_bytes = p_mic_size_bytes
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND upload_status = 'pending';

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated > 0;
END;
$$;

-- ============================================================
-- Source: project_delete.sql
-- ============================================================
-- project_delete(p_project_id)
--
-- Soft-deletes a project by setting deleted_at.
-- Uses auth.uid() so only the owner can delete.
-- Returns true if a row was updated, false otherwise.
--
-- Called by: webapp CloudStorage.softDeleteProject
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_delete(p_project_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rows_updated INT;
BEGIN
    UPDATE public.projects
    SET deleted_at = NOW()
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND deleted_at IS NULL;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated > 0;
END;
$$;

-- ============================================================
-- Source: project_get.sql
-- ============================================================
-- project_get(p_project_id)
--
-- Returns full project metadata for the authenticated user.
-- Also bumps last_accessed_at so there's no need for a separate touch call.
-- Returns NULL if the project doesn't exist or is deleted.
--
-- Called by: webapp CloudStorage.loadProjectMetadata, editor/App.tsx on open
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_get(p_project_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    UPDATE public.projects
    SET last_accessed_at = NOW()
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND deleted_at IS NULL;

    SELECT jsonb_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'name', p.name,
        'project_data', p.project_data,
        'cloud_version', p.cloud_version,
        'upload_status', p.upload_status,
        'cf_video_uid', p.cf_video_uid,
        'published_at', p.published_at,
        'share_description', p.share_description,
        'last_accessed_at', p.last_accessed_at,
        'updated_at', p.updated_at,
        'created_at', p.created_at,
        'expires_at', p.expires_at,
        'screen_storage_path', p.screen_storage_path,
        'camera_storage_path', p.camera_storage_path,
        'mic_storage_path', p.mic_storage_path,
        'thumbnail_storage_path', p.thumbnail_storage_path
    ) INTO result
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.user_id = auth.uid()
      AND p.deleted_at IS NULL;

    RETURN result;
END;
$$;

-- ============================================================
-- Source: project_list.sql
-- ============================================================
-- project_list()
--
-- Returns lightweight project summaries for the dashboard.
-- Only returns non-deleted projects with upload_status = 'ready'.
-- Ordered by updated_at descending.
--
-- Called by: webapp CloudStorage.listProjectsSummary
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_list()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'updated_at') DESC), '[]'::jsonb)
    FROM (
        SELECT jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'thumbnail_storage_path', p.thumbnail_storage_path,
            'last_accessed_at', p.last_accessed_at,
            'updated_at', p.updated_at,
            'created_at', p.created_at,
            'expires_at', p.expires_at,
            'cf_video_uid', p.cf_video_uid,
            'cloud_version', p.cloud_version,
            'duration_ms', p.duration_ms
        ) AS row_data
        FROM public.projects p
        WHERE p.user_id = auth.uid()
          AND p.deleted_at IS NULL
          AND p.upload_status = 'ready'
    ) sub;
$$;

-- ============================================================
-- Source: project_update.sql
-- ============================================================
-- project_update(p_project_id, p_name, p_project_data, p_duration_ms, p_expected_version)
--
-- Updates project metadata with optimistic concurrency control.
-- If p_expected_version is provided, the update only succeeds when
-- cloud_version matches (returns NULL on conflict).
-- Returns the new cloud_version on success, NULL on conflict.
--
-- Called by: webapp CloudStorage.saveProjectMetadata
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_update(
    p_project_id TEXT,
    p_name TEXT,
    p_project_data JSONB,
    p_duration_ms INT DEFAULT NULL,
    p_expected_version INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_version INT;
BEGIN
    IF p_expected_version IS NOT NULL THEN
        -- Optimistic concurrency update
        UPDATE public.projects
        SET name = p_name,
            project_data = p_project_data,
            cloud_version = p_expected_version + 1,
            duration_ms = p_duration_ms,
            updated_at = NOW()
        WHERE id = p_project_id
          AND user_id = auth.uid()
          AND cloud_version = p_expected_version
        RETURNING cloud_version INTO new_version;
    ELSE
        -- Simple update (no version check)
        UPDATE public.projects
        SET name = p_name,
            project_data = p_project_data,
            duration_ms = p_duration_ms,
            updated_at = NOW()
        WHERE id = p_project_id
          AND user_id = auth.uid()
          AND deleted_at IS NULL
        RETURNING cloud_version INTO new_version;
    END IF;

    RETURN new_version;
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
-- Source: subscription_get.sql
-- ============================================================
-- subscription_get()
--
-- Returns the authenticated user's subscription info.
-- Returns NULL if no subscription exists (e.g. free user, or webhook hasn't fired yet).
--
-- Called by: webapp AuthManager.fetchSubscription, UpgradeModal subscription poll
-- Tables:   subscriptions

CREATE OR REPLACE FUNCTION public.subscription_get()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT jsonb_build_object(
        'status', s.status,
        'plan_id', s.plan_id,
        'current_period_end', s.current_period_end,
        'cancel_at_period_end', s.cancel_at_period_end,
        'stripe_customer_id', s.stripe_customer_id,
        'billing_interval', s.billing_interval
    )
    FROM public.subscriptions s
    WHERE s.user_id = auth.uid()
    LIMIT 1;
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


-- Auto-generated from sql/functions/*.sql
-- Run sql/build-functions.sh to regenerate
-- 2026-05-01 06:36:14 UTC

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
-- Source: handle_new_user.sql
-- ============================================================
-- handle_new_user()
--
-- Bootstraps a new user's account by creating a profile with a 7-day free trial.
-- Attached as an AFTER INSERT trigger on auth.users.
--
-- Trigger: auth.users INSERT trigger
-- Tables:  user_profiles

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Create user profile with 7-day free trial
    INSERT INTO public.user_profiles (user_id, name, trial_ends_at, updated_at)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
        now() + interval '7 days',
        now()
    );

    RETURN new;
END;
$$;

-- ============================================================
-- Source: mux_video_complete.sql
-- ============================================================
-- mux_video_complete(p_mux_asset_id, p_playback_id)
--
-- Marks a pending mux_video as completed when Mux webhook fires.
--   1. Find pending mux_video by mux_asset_id
--   2. Set status = 'completed', mux_playback_id
--
-- Old version cleanup is handled by the mux-video-purge cron.
--
-- Returns: { mux_video_id, project_id, found }
--
-- Called by: edge function mux-video-hook on video.asset.ready
-- Tables:   mux_videos

DROP FUNCTION IF EXISTS public.mux_video_complete(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.mux_video_complete(
    p_mux_asset_id TEXT,
    p_playback_id TEXT
)
RETURNS TABLE(mux_video_id UUID, project_id UUID, found BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
    v_project_id UUID;
BEGIN
    -- 1. Find mux_video by asset ID
    SELECT mv.id, mv.project_id INTO v_id, v_project_id
    FROM public.mux_videos mv
    WHERE mv.mux_asset_id = p_mux_asset_id;

    IF v_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, FALSE;
        RETURN;
    END IF;

    -- 2. Mark completed with playback ID
    UPDATE public.mux_videos
    SET status = 'completed',
        mux_playback_id = p_playback_id,
        updated_at = NOW()
    WHERE id = v_id;

    RETURN QUERY SELECT v_id, v_project_id, TRUE;
END;
$$;

-- ============================================================
-- Source: mux_video_get_or_create.sql
-- ============================================================
-- mux_video_get_or_create(p_project_id, p_user_id, p_cloud_version)
--
-- Atomically resolves a mux_video row for a specific cloud_version:
--   1. Cache hit: completed mux_video → return playback data
--   2. Dedup: pending mux_video → return it
--   3. Retry: failed/canceled → reset to pending (reuse row)
--   4. New: no row exists → insert as pending
--
-- cloud_version is passed explicitly by the caller — no projects table lookup.
--
-- Returns: { mux_video_id, status, is_new, cloud_version }
--   mux_video_id  UUID   — the mux_video row id
--   status        TEXT   — 'completed' | 'pending'
--   is_new        BOOL   — true when the caller should kick off the render/upload pipeline
--   cloud_version INT    — echo of p_cloud_version
--
-- Called by: edge function mux-video-create
-- Tables:   mux_videos

DROP FUNCTION IF EXISTS public.mux_video_start(UUID, UUID);
DROP FUNCTION IF EXISTS public.mux_video_start(UUID);
DROP FUNCTION IF EXISTS public.mux_video_resolve(UUID);
DROP FUNCTION IF EXISTS public.mux_video_get_or_create(UUID, UUID, INT);

CREATE OR REPLACE FUNCTION public.mux_video_get_or_create(
    p_project_id UUID,
    p_user_id UUID,
    p_cloud_version INT
)
RETURNS TABLE(
    mux_video_id UUID,
    status TEXT,
    is_new BOOLEAN,
    cloud_version INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_existing_status TEXT;
    v_new_id UUID;
BEGIN
    -- 1. Check for any existing row at this (project_id, cloud_version)
    SELECT mv.id, mv.status INTO v_existing_id, v_existing_status
    FROM public.mux_videos mv
    WHERE mv.project_id = p_project_id
      AND mv.cloud_version = p_cloud_version;

    IF v_existing_id IS NOT NULL THEN
        -- Cache hit: already completed
        IF v_existing_status = 'completed' THEN
            RETURN QUERY SELECT v_existing_id, 'completed'::TEXT, FALSE, p_cloud_version;
            RETURN;
        END IF;

        -- Dedup: already pending
        IF v_existing_status = 'pending' THEN
            RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, FALSE, p_cloud_version;
            RETURN;
        END IF;

        -- Retry: failed/canceled → reset to pending
        UPDATE public.mux_videos
        SET status = 'pending',
            error = NULL,
            mux_asset_id = NULL,
            mux_playback_id = NULL,
            render_storage_path = NULL,
            updated_at = NOW()
        WHERE id = v_existing_id;

        RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, TRUE, p_cloud_version;
        RETURN;
    END IF;

    -- 2. No row exists → insert new as 'pending'
    INSERT INTO public.mux_videos (project_id, user_id, cloud_version, status)
    VALUES (p_project_id, p_user_id, p_cloud_version, 'pending')
    RETURNING mux_videos.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, 'pending'::TEXT, TRUE, p_cloud_version;
END;
$$;

-- ============================================================
-- Source: mux_video_purge_candidates.sql
-- ============================================================
-- mux_video_purge_candidates()
--
-- Returns mux_videos rows that are older than the highest completed version
-- per project. Only returns non-pending rows (completed, failed, canceled)
-- that are safe to delete.
--
-- Returns: { id, mux_asset_id, render_storage_path }
--
-- Called by: edge function mux-video-purge
-- Tables:   mux_videos

DROP FUNCTION IF EXISTS public.mux_video_mark_old_deleted();
DROP FUNCTION IF EXISTS public.mux_video_purge_candidates();

CREATE OR REPLACE FUNCTION public.mux_video_purge_candidates()
RETURNS TABLE(id UUID, mux_asset_id TEXT, render_storage_path TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
    WITH latest AS (
        SELECT mv.project_id, MAX(mv.cloud_version) AS max_version
        FROM public.mux_videos mv
        WHERE mv.status = 'completed'
        GROUP BY mv.project_id
    )
    SELECT mv.id, mv.mux_asset_id, mv.render_storage_path
    FROM public.mux_videos mv
    JOIN latest l ON mv.project_id = l.project_id
    WHERE mv.cloud_version < l.max_version
      AND mv.status != 'pending'
    LIMIT 50;
$$;

-- ============================================================
-- Source: project_confirm_upload.sql
-- ============================================================
-- project_confirm_upload(p_project_id)
--
-- Flips a project's upload_status from 'pending' to 'ready' after the client
-- has successfully uploaded all media blobs.
-- Uses auth.uid() so it can only be called by the project owner.
--
-- Returns true if the row was updated, false if not found / already ready.
--
-- Called by: webapp CloudProjectService after all media uploads complete
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_confirm_upload(
    p_project_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rows_updated INT;
BEGIN
    UPDATE public.projects
    SET upload_status = 'ready'
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

CREATE OR REPLACE FUNCTION public.project_delete(p_project_id UUID)
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

CREATE OR REPLACE FUNCTION public.project_get(p_project_id UUID)
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
        'last_accessed_at', p.last_accessed_at,
        'updated_at', p.updated_at,
        'created_at', p.created_at,
        'expires_at', p.expires_at,
        'thumbnail_storage_path', p.thumbnail_storage_path,
        'is_shared', p.slug IS NOT NULL,
        'share_slug', p.slug
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
            'cloud_version', p.cloud_version,
            'duration_ms', p.duration_ms,
            'is_shared', p.slug IS NOT NULL,
            'slug', p.slug
        ) AS row_data
        FROM public.projects p
        WHERE p.user_id = auth.uid()
          AND p.deleted_at IS NULL
          AND p.upload_status = 'ready'
    ) sub;
$$;

-- ============================================================
-- Source: project_share.sql
-- ============================================================
-- project_share(p_project_id)
--
-- Generates a share slug for the project if none exists.
-- Returns the slug (existing or newly created).
--
-- Called by: webapp SettingsPanel share button
-- Tables:   projects

DROP FUNCTION IF EXISTS public.shared_video_create(UUID);
DROP FUNCTION IF EXISTS public.project_share(UUID);

CREATE OR REPLACE FUNCTION public.project_share(
    p_project_id UUID
)
RETURNS TABLE(slug TEXT, is_new BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_slug TEXT;
    v_new_slug TEXT;
BEGIN
    -- Verify project belongs to caller
    SELECT p.slug INTO v_existing_slug
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.user_id = auth.uid()
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found or not owned by user';
    END IF;

    -- Already shared — return existing slug
    IF v_existing_slug IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_slug, FALSE;
        RETURN;
    END IF;

    -- Generate new slug
    v_new_slug := left(replace(gen_random_uuid()::text, '-', ''), 12);

    UPDATE public.projects
    SET slug = v_new_slug
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND deleted_at IS NULL;

    RETURN QUERY SELECT v_new_slug, TRUE;
END;
$$;

-- ============================================================
-- Source: project_update.sql
-- ============================================================
-- project_update(p_project_id, p_project_data, p_duration_ms, p_expected_version)
--
-- Updates project metadata with optimistic concurrency control.
-- If p_expected_version is provided, the update only succeeds when
-- cloud_version matches (returns NULL on conflict).
-- Returns the new cloud_version on success, NULL on conflict.
--
-- Called by: webapp CloudStorage.saveProjectMetadata
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_update(
    p_project_id UUID,
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
    current_hash TEXT;
BEGIN
    -- Skip version bump if project_data is unchanged
    SELECT md5(project_data::text) INTO current_hash
    FROM public.projects
    WHERE id = p_project_id;

    IF current_hash IS NOT NULL AND current_hash = md5(p_project_data::text) THEN
        -- Data unchanged — update duration/timestamp but don't bump cloud_version
        UPDATE public.projects
        SET duration_ms = p_duration_ms,
            updated_at = NOW()
        WHERE id = p_project_id
          AND user_id = auth.uid()
        RETURNING cloud_version INTO new_version;
        RETURN new_version;
    END IF;

    IF p_expected_version IS NOT NULL THEN
        -- Optimistic concurrency update
        UPDATE public.projects
        SET project_data = p_project_data,
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
        SET project_data = p_project_data,
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
-- Source: project_update_name.sql
-- ============================================================
-- project_update_name(p_project_id, p_name)
--
-- Updates only the project name column. Called directly from the editor
-- header without debouncing (name is not part of project_data).
--
-- Called by: webapp CloudStorage.updateProjectName
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_update_name(
    p_project_id UUID,
    p_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.projects
    SET name = p_name,
        updated_at = NOW()
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND deleted_at IS NULL;
END;
$$;

-- ============================================================
-- Source: render_job_complete.sql
-- ============================================================
-- render_job_complete(p_job_id, p_status, p_error)
--
-- Sets a render job to a terminal state (completed, failed, canceled)
-- and cascades failures to mux_videos by (project_id, cloud_version).
--
-- On completed: NO cascade — render-job-hook handles Mux upload directly
-- On failed/canceled: mark pending mux_videos for same (project_id, cloud_version) as failed
--
-- Called by: render-job-hook, stale job cron
-- Tables:   render_jobs, mux_videos

DROP FUNCTION IF EXISTS public.render_job_complete(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.render_job_complete(
    p_job_id UUID,
    p_status TEXT,        -- 'completed' | 'failed' | 'canceled'
    p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_id UUID;
    v_cloud_version INT;
BEGIN
    -- 1. Update render job and capture project_id + cloud_version
    UPDATE public.render_jobs
    SET status = p_status,
        error = p_error,
        updated_at = NOW()
    WHERE id = p_job_id
      AND status = 'pending'
    RETURNING project_id, cloud_version INTO v_project_id, v_cloud_version;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- 2. On failure/cancel: cascade to pending mux_videos by (project_id, cloud_version)
    IF p_status IN ('failed', 'canceled') THEN
        UPDATE public.mux_videos
        SET status = 'failed',
            error = COALESCE(p_error, 'Render ' || p_status),
            updated_at = NOW()
        WHERE project_id = v_project_id
          AND cloud_version = v_cloud_version
          AND status = 'pending';
    END IF;
END;
$$;

-- ============================================================
-- Source: render_job_get_or_create.sql
-- ============================================================
-- render_job_get_or_create(p_project_id, p_user_id, p_cloud_version)
--
-- Atomically resolves a render job for a specific cloud_version:
--   1. Cache hit: completed render for this (project_id, cloud_version) → return path
--   2. Dedup: pending job for this (project_id, cloud_version) → return it
--   3. Retry: failed/canceled job exists → reset to pending (reuse row)
--   4. New: no row exists → insert as pending
--
-- cloud_version is passed explicitly by the caller — no projects table lookup.
--
-- Returns: { job_id, status, is_new, render_storage_path }
--   job_id              UUID   — the render job row id
--   status              TEXT   — 'completed' | 'pending'
--   is_new              BOOL   — true when the caller should dispatch the render worker
--   render_storage_path TEXT   — storage path for the rendered mp4 (null for dedup pending)
--
-- Called by: edge function render-job-create
-- Tables:   render_jobs

DROP FUNCTION IF EXISTS public.render_job_start(UUID, UUID);
DROP FUNCTION IF EXISTS public.render_job_resolve(UUID, UUID);
DROP FUNCTION IF EXISTS public.render_job_get_or_create(UUID, UUID, INT);

CREATE OR REPLACE FUNCTION public.render_job_get_or_create(
    p_project_id UUID,
    p_user_id UUID,
    p_cloud_version INT
)
RETURNS TABLE(job_id UUID, status TEXT, is_new BOOLEAN, render_storage_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_existing_status TEXT;
    v_existing_path TEXT;
    v_render_storage_path TEXT;
    v_new_id UUID;
BEGIN
    -- 1. Check for any existing row at this (project_id, cloud_version)
    SELECT rj.id, rj.status, rj.render_storage_path
    INTO v_existing_id, v_existing_status, v_existing_path
    FROM public.render_jobs rj
    WHERE rj.project_id = p_project_id
      AND rj.cloud_version = p_cloud_version;

    IF v_existing_id IS NOT NULL THEN
        -- Cache hit: already completed
        IF v_existing_status = 'completed' THEN
            RETURN QUERY SELECT v_existing_id, 'completed'::TEXT, FALSE, v_existing_path;
            RETURN;
        END IF;

        -- Dedup: already pending
        IF v_existing_status = 'pending' THEN
            RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, FALSE, v_existing_path;
            RETURN;
        END IF;

        -- Retry: failed/canceled → reset to pending
        v_render_storage_path := p_user_id || '/' || p_project_id || '/renders/v' || p_cloud_version || '.mp4';

        UPDATE public.render_jobs
        SET status = 'pending',
            progress = 0,
            error = NULL,
            render_storage_path = v_render_storage_path,
            start_duration_s = NULL,
            download_duration_s = NULL,
            render_duration_s = NULL,
            upload_duration_s = NULL,
            total_duration_s = NULL,
            updated_at = NOW()
        WHERE id = v_existing_id;

        RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, TRUE, v_render_storage_path;
        RETURN;
    END IF;

    -- 4. No row exists → insert new job
    v_render_storage_path := p_user_id || '/' || p_project_id || '/renders/v' || p_cloud_version || '.mp4';

    INSERT INTO public.render_jobs (project_id, user_id, cloud_version, render_storage_path)
    VALUES (p_project_id, p_user_id, p_cloud_version, v_render_storage_path)
    RETURNING render_jobs.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, 'pending'::TEXT, TRUE, v_render_storage_path;
END;
$$;

-- ============================================================
-- Source: render_purge_candidates.sql
-- ============================================================
-- render_purge_candidates()
--
-- Returns render_jobs rows that are older than the highest completed version
-- per project. Only returns non-pending rows (completed, failed, canceled)
-- that are safe to delete.
--
-- Returns: { id, render_storage_path }
--
-- Called by: edge function render-purge
-- Tables:   render_jobs

DROP FUNCTION IF EXISTS public.render_purge_candidates();

CREATE OR REPLACE FUNCTION public.render_purge_candidates()
RETURNS TABLE(id UUID, render_storage_path TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
    WITH latest AS (
        SELECT rj.project_id, MAX(rj.cloud_version) AS max_version
        FROM public.render_jobs rj
        WHERE rj.status = 'completed'
        GROUP BY rj.project_id
    )
    SELECT rj.id, rj.render_storage_path
    FROM public.render_jobs rj
    JOIN latest l ON rj.project_id = l.project_id
    WHERE rj.cloud_version < l.max_version
      AND rj.status != 'pending'
    LIMIT 50;
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
-- Returns the authenticated user's Stripe subscription info.
-- Returns NULL if no subscription exists (free/trial-only user, or webhook hasn't fired yet).
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
-- Source: user_profile_get.sql
-- ============================================================
-- user_profile_get()
--
-- Returns the authenticated user's profile info (name, trial status).
-- Returns NULL if no profile exists.
--
-- Called by: webapp AuthManager.fetchProfile
-- Tables:   user_profiles

CREATE OR REPLACE FUNCTION public.user_profile_get()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT jsonb_build_object(
        'name', p.name,
        'trial_ends_at', p.trial_ends_at
    )
    FROM public.user_profiles p
    WHERE p.user_id = auth.uid();
$$;


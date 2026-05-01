


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."asset_confirm_upload"("p_asset_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."asset_confirm_upload"("p_asset_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."asset_delete"("p_asset_id" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."asset_delete"("p_asset_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."asset_list"("p_asset_type" "text") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
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


ALTER FUNCTION "public"."asset_list"("p_asset_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_projects"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.projects
    SET deleted_at = NOW()
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW()
      AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_projects"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_asset_upload"("p_asset_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."confirm_asset_upload"("p_asset_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cron_expire_trials"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE status = 'trialing'
      AND current_period_end < now();
END;
$$;


ALTER FUNCTION "public"."cron_expire_trials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_trials"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
declare
    r record;
    mp_token text := '773bc18d036f7f77ec70ec94e7eec508';
begin
    -- Find all trialing subscriptions past their period end
    for r in
        select s.user_id, s.current_period_end
        from public.subscriptions s
        where s.status = 'trialing'
          and s.current_period_end < now()
    loop
        -- Update DB
        update public.subscriptions
        set status = 'expired', updated_at = now()
        where user_id = r.user_id;

        -- Update Mixpanel profile
        perform net.http_post(
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

        raise log '[TrialExpiry] Expired trial for user: %', r.user_id;
    end loop;
end;
$_$;


ALTER FUNCTION "public"."expire_trials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."folder_create"("p_name" "text", "p_description" "text" DEFAULT ''::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_folder JSONB;
BEGIN
    INSERT INTO public.folders (user_id, name, description)
    VALUES (auth.uid(), p_name, p_description)
    RETURNING jsonb_build_object(
        'id', id,
        'name', name,
        'description', description,
        'created_at', created_at,
        'updated_at', updated_at
    ) INTO v_folder;

    RETURN v_folder;
END;
$$;


ALTER FUNCTION "public"."folder_create"("p_name" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."folder_delete"("p_folder_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    DELETE FROM public.folders
    WHERE id = p_folder_id
      AND user_id = auth.uid();

    RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."folder_delete"("p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."folder_list"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'created_at') ASC), '[]'::jsonb)
    FROM (
        SELECT jsonb_build_object(
            'id', f.id,
            'name', f.name,
            'description', f.description,
            'created_at', f.created_at,
            'updated_at', f.updated_at,
            'project_count', (
                SELECT COUNT(*)
                FROM public.projects p
                WHERE p.folder_id = f.id
                  AND p.deleted_at IS NULL
                  AND p.upload_status = 'ready'
            )
        ) AS row_data
        FROM public.folders f
        WHERE f.user_id = auth.uid()
    ) sub;
$$;


ALTER FUNCTION "public"."folder_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."folder_update"("p_folder_id" "uuid", "p_name" "text", "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_folder JSONB;
BEGIN
    UPDATE public.folders
    SET name = p_name,
        description = p_description,
        updated_at = NOW()
    WHERE id = p_folder_id
      AND user_id = auth.uid()
    RETURNING jsonb_build_object(
        'id', id,
        'name', name,
        'description', description,
        'created_at', created_at,
        'updated_at', updated_at
    ) INTO v_folder;

    RETURN v_folder;
END;
$$;


ALTER FUNCTION "public"."folder_update"("p_folder_id" "uuid", "p_name" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mux_video_complete"("p_mux_asset_id" "text", "p_playback_id" "text") RETURNS TABLE("mux_video_id" "uuid", "project_id" "uuid", "found" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."mux_video_complete"("p_mux_asset_id" "text", "p_playback_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mux_video_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) RETURNS TABLE("mux_video_id" "uuid", "status" "text", "is_new" boolean, "cloud_version" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."mux_video_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mux_video_purge_candidates"() RETURNS TABLE("id" "uuid", "mux_asset_id" "text", "render_storage_path" "text")
    LANGUAGE "sql" SECURITY DEFINER
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


ALTER FUNCTION "public"."mux_video_purge_candidates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid", "p_screen_size_bytes" bigint DEFAULT 0, "p_camera_size_bytes" bigint DEFAULT 0, "p_mic_size_bytes" bigint DEFAULT 0) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid", "p_screen_size_bytes" bigint, "p_camera_size_bytes" bigint, "p_mic_size_bytes" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_delete"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."project_delete"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_get"("p_project_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."project_get"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_list"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
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
            'deleted_at', p.deleted_at,
            'cloud_version', p.cloud_version,
            'duration_ms', p.duration_ms,
            'is_shared', p.slug IS NOT NULL,
            'slug', p.slug,
            'folder_id', p.folder_id,
            'is_starred', p.is_starred
        ) AS row_data
        FROM public.projects p
        WHERE p.user_id = auth.uid()
          AND p.permanently_deleted = false
          AND p.upload_status = 'ready'
    ) sub;
$$;


ALTER FUNCTION "public"."project_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_move_to_folder"("p_project_id" "uuid", "p_folder_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- If assigning to a folder, verify the folder belongs to this user
    IF p_folder_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.folders
            WHERE id = p_folder_id AND user_id = auth.uid()
        ) THEN
            RETURN FALSE;
        END IF;
    END IF;

    UPDATE public.projects
    SET folder_id = p_folder_id,
        updated_at = NOW()
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND deleted_at IS NULL;

    RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."project_move_to_folder"("p_project_id" "uuid", "p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_rename"("p_project_id" "uuid", "p_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.projects
    SET name = p_name,
        updated_at = now()
    WHERE id = p_project_id
      AND user_id = auth.uid();
END;
$$;


ALTER FUNCTION "public"."project_rename"("p_project_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_restore"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    rows_updated INT;
BEGIN
    UPDATE public.projects
    SET deleted_at = NULL
    WHERE id = p_project_id
      AND user_id = auth.uid()
      AND deleted_at IS NOT NULL
      AND permanently_deleted = false;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated > 0;
END;
$$;


ALTER FUNCTION "public"."project_restore"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_share"("p_project_id" "uuid") RETURNS TABLE("slug" "text", "is_new" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."project_share"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_star"("p_project_id" "uuid", "p_starred" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.projects
    SET is_starred = p_starred,
        updated_at = now()
    WHERE id = p_project_id
      AND user_id = auth.uid();
END;
$$;


ALTER FUNCTION "public"."project_star"("p_project_id" "uuid", "p_starred" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_update"("p_project_id" "uuid", "p_project_data" "jsonb", "p_duration_ms" integer DEFAULT NULL::integer, "p_expected_version" integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."project_update"("p_project_id" "uuid", "p_project_data" "jsonb", "p_duration_ms" integer, "p_expected_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_update"("p_project_id" "uuid", "p_name" "text", "p_project_data" "jsonb", "p_duration_ms" integer DEFAULT NULL::integer, "p_expected_version" integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."project_update"("p_project_id" "uuid", "p_name" "text", "p_project_data" "jsonb", "p_duration_ms" integer, "p_expected_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_update_name"("p_project_id" "uuid", "p_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."project_update_name"("p_project_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."render_job_complete"("p_job_id" "uuid", "p_status" "text", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."render_job_complete"("p_job_id" "uuid", "p_status" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."render_job_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) RETURNS TABLE("job_id" "uuid", "status" "text", "is_new" boolean, "render_storage_path" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."render_job_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."render_job_start"("p_project_id" "uuid", "p_user_id" "uuid", "p_quality" "text", "p_cloud_version" integer, "p_output_storage_path" "text", "p_video_duration_s" real DEFAULT NULL::real) RETURNS TABLE("id" "uuid", "status" "text", "was_dedup" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_existing_id UUID;
    v_new_id UUID;
BEGIN
    -- 1. Dedup: return existing pending job if same cloud_version
    SELECT rj.id INTO v_existing_id
    FROM public.render_jobs rj
    WHERE rj.project_id = p_project_id
      AND rj.cloud_version = p_cloud_version
      AND rj.status = 'pending';

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_id, 'pending'::TEXT, TRUE;
        RETURN;
    END IF;

    -- 2. Cancel any pending job for this project (stale older version)
    UPDATE public.render_jobs rj
    SET status = 'canceled', updated_at = NOW()
    WHERE rj.project_id = p_project_id
      AND rj.status = 'pending';

    -- 3. Insert new job
    INSERT INTO public.render_jobs (project_id, user_id, quality, cloud_version, output_storage_path, video_duration_s)
    VALUES (p_project_id, p_user_id, p_quality, p_cloud_version, p_output_storage_path, p_video_duration_s)
    RETURNING render_jobs.id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, 'pending'::TEXT, FALSE;
END;
$$;


ALTER FUNCTION "public"."render_job_start"("p_project_id" "uuid", "p_user_id" "uuid", "p_quality" "text", "p_cloud_version" integer, "p_output_storage_path" "text", "p_video_duration_s" real) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."render_purge_candidates"() RETURNS TABLE("id" "uuid", "render_storage_path" "text")
    LANGUAGE "sql" SECURITY DEFINER
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


ALTER FUNCTION "public"."render_purge_candidates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_project_expiry"("p_user_id" "uuid", "p_expires_at" timestamp with time zone) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
    UPDATE public.projects
    SET expires_at = p_expires_at
    WHERE user_id = p_user_id AND deleted_at IS NULL;
$$;


ALTER FUNCTION "public"."set_project_expiry"("p_user_id" "uuid", "p_expires_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."subscription_get"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
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


ALTER FUNCTION "public"."subscription_get"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_profile_get"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
    SELECT jsonb_build_object(
        'name', p.name,
        'trial_ends_at', p.trial_ends_at
    )
    FROM public.user_profiles p
    WHERE p.user_id = auth.uid();
$$;


ALTER FUNCTION "public"."user_profile_get"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mux_videos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "cloud_version" integer NOT NULL,
    "attempt" integer DEFAULT 1 NOT NULL,
    "mux_asset_id" "text",
    "mux_playback_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error" "text",
    "render_storage_path" "text",
    "is_deleted" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mux_videos_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."mux_videos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Untitled'::"text" NOT NULL,
    "project_data" "jsonb" NOT NULL,
    "thumbnail_storage_path" "text",
    "upload_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "cloud_version" integer DEFAULT 1 NOT NULL,
    "last_accessed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "duration_ms" integer,
    "permanently_deleted" boolean DEFAULT false NOT NULL,
    "render_storage_path" "text",
    "render_cloud_version" integer,
    "slug" "text",
    "share_policy" "text" DEFAULT 'public'::"text" NOT NULL,
    "folder_id" "uuid",
    "is_starred" boolean DEFAULT false NOT NULL,
    CONSTRAINT "projects_share_policy_check" CHECK (("share_policy" = ANY (ARRAY['public'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."render_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "cloud_version" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "progress" real DEFAULT 0,
    "render_storage_path" "text",
    "error" "text",
    "video_duration_s" real,
    "start_duration_s" real,
    "download_duration_s" real,
    "render_duration_s" real,
    "upload_duration_s" real,
    "total_duration_s" real,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "render_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."render_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "status" "text" DEFAULT 'inactive'::"text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "billing_interval" "text"
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transcription_usage" (
    "user_id" "uuid" NOT NULL,
    "minutes_used" numeric(8,3) DEFAULT 0 NOT NULL,
    "reset_date" timestamp with time zone NOT NULL,
    "minutes_limit" numeric(8,3) DEFAULT 60 NOT NULL
);


ALTER TABLE "public"."transcription_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_assets" (
    "id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "asset_type" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "name" "text",
    "size_bytes" bigint DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'ready'::"text" NOT NULL
);


ALTER TABLE "public"."user_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "user_id" "uuid" NOT NULL,
    "name" "text",
    "trial_ends_at" timestamp with time zone,
    "email_subscribed" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mux_videos"
    ADD CONSTRAINT "mux_videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."render_jobs"
    ADD CONSTRAINT "render_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."transcription_usage"
    ADD CONSTRAINT "transcription_usage_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_assets"
    ADD CONSTRAINT "user_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "idx_folders_user" ON "public"."folders" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_mux_videos_asset_id" ON "public"."mux_videos" USING "btree" ("mux_asset_id") WHERE ("mux_asset_id" IS NOT NULL);



CREATE INDEX "idx_mux_videos_deleted" ON "public"."mux_videos" USING "btree" ("is_deleted") WHERE ("is_deleted" = true);



CREATE UNIQUE INDEX "idx_mux_videos_one_active_completed" ON "public"."mux_videos" USING "btree" ("project_id") WHERE (("is_deleted" = false) AND ("status" = 'completed'::"text"));



CREATE UNIQUE INDEX "idx_mux_videos_project_version" ON "public"."mux_videos" USING "btree" ("project_id", "cloud_version");



CREATE INDEX "idx_projects_folder" ON "public"."projects" USING "btree" ("folder_id") WHERE (("folder_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_projects_user_id" ON "public"."projects" USING "btree" ("user_id");



CREATE INDEX "idx_projects_user_starred" ON "public"."projects" USING "btree" ("user_id", "is_starred") WHERE ("is_starred" = true);



CREATE UNIQUE INDEX "idx_render_jobs_one_completed_per_version" ON "public"."render_jobs" USING "btree" ("project_id", "cloud_version") WHERE ("status" = 'completed'::"text");



CREATE INDEX "idx_render_jobs_project_version_status" ON "public"."render_jobs" USING "btree" ("project_id", "cloud_version", "status");



CREATE INDEX "idx_render_jobs_user_created" ON "public"."render_jobs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_user_assets_active" ON "public"."user_assets" USING "btree" ("user_id", "asset_type") WHERE (("is_deleted" = false) AND ("status" = 'ready'::"text"));



CREATE INDEX "idx_user_assets_user" ON "public"."user_assets" USING "btree" ("user_id", "asset_type");



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mux_videos"
    ADD CONSTRAINT "mux_videos_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mux_videos"
    ADD CONSTRAINT "mux_videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."render_jobs"
    ADD CONSTRAINT "render_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."render_jobs"
    ADD CONSTRAINT "render_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transcription_usage"
    ADD CONSTRAINT "transcription_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_assets"
    ADD CONSTRAINT "user_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can delete own folders" ON "public"."folders" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own folders" ON "public"."folders" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own projects" ON "public"."projects" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own assets" ON "public"."user_assets" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own mux videos" ON "public"."mux_videos" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own folders" ON "public"."folders" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own projects" ON "public"."projects" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own folders" ON "public"."folders" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."user_profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own projects" ON "public"."projects" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own render jobs" ON "public"."render_jobs" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own subscription" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mux_videos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."render_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transcription_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."asset_confirm_upload"("p_asset_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."asset_confirm_upload"("p_asset_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."asset_confirm_upload"("p_asset_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."asset_delete"("p_asset_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."asset_delete"("p_asset_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."asset_delete"("p_asset_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."asset_list"("p_asset_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."asset_list"("p_asset_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."asset_list"("p_asset_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_projects"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_projects"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_projects"() TO "service_role";



GRANT ALL ON FUNCTION "public"."confirm_asset_upload"("p_asset_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_asset_upload"("p_asset_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_asset_upload"("p_asset_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cron_expire_trials"() TO "anon";
GRANT ALL ON FUNCTION "public"."cron_expire_trials"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cron_expire_trials"() TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_trials"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_trials"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_trials"() TO "service_role";



GRANT ALL ON FUNCTION "public"."folder_create"("p_name" "text", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."folder_create"("p_name" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."folder_create"("p_name" "text", "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."folder_delete"("p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."folder_delete"("p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."folder_delete"("p_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."folder_list"() TO "anon";
GRANT ALL ON FUNCTION "public"."folder_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."folder_list"() TO "service_role";



GRANT ALL ON FUNCTION "public"."folder_update"("p_folder_id" "uuid", "p_name" "text", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."folder_update"("p_folder_id" "uuid", "p_name" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."folder_update"("p_folder_id" "uuid", "p_name" "text", "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mux_video_complete"("p_mux_asset_id" "text", "p_playback_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mux_video_complete"("p_mux_asset_id" "text", "p_playback_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mux_video_complete"("p_mux_asset_id" "text", "p_playback_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mux_video_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."mux_video_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mux_video_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."mux_video_purge_candidates"() TO "anon";
GRANT ALL ON FUNCTION "public"."mux_video_purge_candidates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mux_video_purge_candidates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid", "p_screen_size_bytes" bigint, "p_camera_size_bytes" bigint, "p_mic_size_bytes" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid", "p_screen_size_bytes" bigint, "p_camera_size_bytes" bigint, "p_mic_size_bytes" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_confirm_upload"("p_project_id" "uuid", "p_screen_size_bytes" bigint, "p_camera_size_bytes" bigint, "p_mic_size_bytes" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."project_delete"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."project_delete"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_delete"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."project_get"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."project_get"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_get"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."project_list"() TO "anon";
GRANT ALL ON FUNCTION "public"."project_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_list"() TO "service_role";



GRANT ALL ON FUNCTION "public"."project_move_to_folder"("p_project_id" "uuid", "p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."project_move_to_folder"("p_project_id" "uuid", "p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_move_to_folder"("p_project_id" "uuid", "p_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."project_rename"("p_project_id" "uuid", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."project_rename"("p_project_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_rename"("p_project_id" "uuid", "p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."project_restore"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."project_restore"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_restore"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."project_share"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."project_share"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_share"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."project_star"("p_project_id" "uuid", "p_starred" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."project_star"("p_project_id" "uuid", "p_starred" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_star"("p_project_id" "uuid", "p_starred" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."project_update"("p_project_id" "uuid", "p_project_data" "jsonb", "p_duration_ms" integer, "p_expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."project_update"("p_project_id" "uuid", "p_project_data" "jsonb", "p_duration_ms" integer, "p_expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_update"("p_project_id" "uuid", "p_project_data" "jsonb", "p_duration_ms" integer, "p_expected_version" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."project_update"("p_project_id" "uuid", "p_name" "text", "p_project_data" "jsonb", "p_duration_ms" integer, "p_expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."project_update"("p_project_id" "uuid", "p_name" "text", "p_project_data" "jsonb", "p_duration_ms" integer, "p_expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_update"("p_project_id" "uuid", "p_name" "text", "p_project_data" "jsonb", "p_duration_ms" integer, "p_expected_version" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."project_update_name"("p_project_id" "uuid", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."project_update_name"("p_project_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_update_name"("p_project_id" "uuid", "p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."render_job_complete"("p_job_id" "uuid", "p_status" "text", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."render_job_complete"("p_job_id" "uuid", "p_status" "text", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."render_job_complete"("p_job_id" "uuid", "p_status" "text", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."render_job_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."render_job_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."render_job_get_or_create"("p_project_id" "uuid", "p_user_id" "uuid", "p_cloud_version" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."render_job_start"("p_project_id" "uuid", "p_user_id" "uuid", "p_quality" "text", "p_cloud_version" integer, "p_output_storage_path" "text", "p_video_duration_s" real) TO "anon";
GRANT ALL ON FUNCTION "public"."render_job_start"("p_project_id" "uuid", "p_user_id" "uuid", "p_quality" "text", "p_cloud_version" integer, "p_output_storage_path" "text", "p_video_duration_s" real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."render_job_start"("p_project_id" "uuid", "p_user_id" "uuid", "p_quality" "text", "p_cloud_version" integer, "p_output_storage_path" "text", "p_video_duration_s" real) TO "service_role";



GRANT ALL ON FUNCTION "public"."render_purge_candidates"() TO "anon";
GRANT ALL ON FUNCTION "public"."render_purge_candidates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."render_purge_candidates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_project_expiry"("p_user_id" "uuid", "p_expires_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."set_project_expiry"("p_user_id" "uuid", "p_expires_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_project_expiry"("p_user_id" "uuid", "p_expires_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."subscription_get"() TO "anon";
GRANT ALL ON FUNCTION "public"."subscription_get"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."subscription_get"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_profile_get"() TO "anon";
GRANT ALL ON FUNCTION "public"."user_profile_get"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_profile_get"() TO "service_role";
























GRANT ALL ON TABLE "public"."folders" TO "anon";
GRANT ALL ON TABLE "public"."folders" TO "authenticated";
GRANT ALL ON TABLE "public"."folders" TO "service_role";



GRANT ALL ON TABLE "public"."mux_videos" TO "anon";
GRANT ALL ON TABLE "public"."mux_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."mux_videos" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."render_jobs" TO "anon";
GRANT ALL ON TABLE "public"."render_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."render_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."transcription_usage" TO "service_role";



GRANT ALL ON TABLE "public"."user_assets" TO "anon";
GRANT ALL ON TABLE "public"."user_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."user_assets" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































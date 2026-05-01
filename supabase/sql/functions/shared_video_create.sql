-- shared_video_create(p_project_id)
--
-- Creates a shared_videos row for the project if none exists.
-- Returns the slug (existing or newly created).
-- Generates a 12-char slug from a random UUID.
--
-- Called by: webapp SettingsPanel share button
-- Tables:   shared_videos, projects

DROP FUNCTION IF EXISTS public.shared_video_create(UUID);

CREATE OR REPLACE FUNCTION public.shared_video_create(
    p_project_id UUID
)
RETURNS TABLE(slug TEXT, is_new BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_existing_slug TEXT;
    v_new_slug TEXT;
BEGIN
    -- Verify project belongs to caller
    SELECT p.user_id INTO v_user_id
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.user_id = auth.uid()
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found or not owned by user';
    END IF;

    -- Check if share already exists
    SELECT sv.slug INTO v_existing_slug
    FROM public.shared_videos sv
    WHERE sv.project_id = p_project_id;

    IF v_existing_slug IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_slug, FALSE;
        RETURN;
    END IF;

    -- Create new share with random slug
    v_new_slug := replace(gen_random_uuid()::text, '-', '');
    v_new_slug := left(v_new_slug, 12);

    INSERT INTO public.shared_videos (project_id, user_id, slug)
    VALUES (p_project_id, v_user_id, v_new_slug);

    RETURN QUERY SELECT v_new_slug, TRUE;
END;
$$;

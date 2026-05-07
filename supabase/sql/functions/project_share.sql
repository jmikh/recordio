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
RETURNS TABLE(slug TEXT, is_new BOOLEAN, owner_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_slug TEXT;
    v_owner_id UUID;
    v_new_slug TEXT;
    is_admin BOOLEAN := auth.uid() = '01f290d7-6bfb-4076-8b09-097eca08fc8f';
BEGIN
    -- Verify project belongs to caller (or admin), fetch actual owner
    SELECT p.slug, p.user_id INTO v_existing_slug, v_owner_id
    FROM public.projects p
    WHERE p.id = p_project_id
      AND (p.user_id = auth.uid() OR is_admin)
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found or not owned by user';
    END IF;

    -- Already shared — return existing slug
    IF v_existing_slug IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_slug, FALSE, v_owner_id;
        RETURN;
    END IF;

    -- Generate new slug
    v_new_slug := left(replace(gen_random_uuid()::text, '-', ''), 12);

    UPDATE public.projects
    SET slug = v_new_slug
    WHERE id = p_project_id
      AND (user_id = auth.uid() OR is_admin)
      AND deleted_at IS NULL;

    RETURN QUERY SELECT v_new_slug, TRUE, v_owner_id;
END;
$$;

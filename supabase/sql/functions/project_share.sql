-- project_share(p_project_id, p_share_policy)
--
-- Generates a share slug for the project if none exists, and sets/updates
-- the share_policy. Can be called on drafts (creates slug) or published
-- projects (updates policy only if slug already exists).
-- Caller must be the project owner.
-- Returns the slug and whether it was newly created.
--
-- Called by: webapp share/publish flow, SettingsPanel
-- Tables:   projects

DROP FUNCTION IF EXISTS public.shared_video_create(UUID);
DROP FUNCTION IF EXISTS public.project_share(UUID);

CREATE OR REPLACE FUNCTION public.project_share(
    p_project_id   UUID,
    p_share_policy TEXT DEFAULT 'public'
)
RETURNS TABLE(slug TEXT, is_new BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _caller_id     UUID := auth.uid();
    _existing_slug TEXT;
    _owner_id      UUID;
    _new_slug      TEXT;
    _is_new        BOOLEAN := FALSE;
BEGIN
    IF p_share_policy NOT IN ('public', 'workspace', 'private') THEN
        RAISE EXCEPTION 'Invalid share_policy: %', p_share_policy;
    END IF;

    SELECT p.slug, p.owner_id INTO _existing_slug, _owner_id
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE SQLSTATE 'PT404' USING MESSAGE = 'Project not found';
    END IF;

    IF _owner_id <> _caller_id THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'Only the project owner can share a project';
    END IF;

    IF _existing_slug IS NULL THEN
        _new_slug := left(replace(gen_random_uuid()::text, '-', ''), 12);
        _is_new := TRUE;
    ELSE
        _new_slug := _existing_slug;
    END IF;

    UPDATE public.projects
    SET slug         = _new_slug,
        share_policy = p_share_policy,
        updated_at   = now()
    WHERE id = p_project_id;

    RETURN QUERY SELECT _new_slug, _is_new;
END;
$$;

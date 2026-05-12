-- workspace_get_default()
--
-- Returns the caller's current default workspace.
-- Guarantees a workspace always exists by:
--   1. Returning stored default_workspace_id if valid (member + not deleted)
--   2. Falling back to the caller's personal workspace
--   3. Creating a personal workspace if none exists
-- Writes the resolved workspace id back to user_profiles.default_workspace_id.
--
-- Called by: webapp on dashboard load, new recording flow
-- Tables:   user_profiles, workspaces, workspace_members

CREATE OR REPLACE FUNCTION public.workspace_get_default()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _uid          UUID := auth.uid();
    _workspace_id UUID;
    _result       JSONB;
BEGIN
    IF _uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    -- 1. Read stored default
    SELECT default_workspace_id INTO _workspace_id
    FROM public.user_profiles
    WHERE user_id = _uid;

    -- 2. Validate: still a member and workspace not deleted
    IF _workspace_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members wm
            JOIN public.workspaces w ON w.id = wm.workspace_id
            WHERE wm.workspace_id = _workspace_id
              AND wm.user_id = _uid
              AND w.deleted_at IS NULL
        ) THEN
            _workspace_id := NULL; -- stale — fall through to heal
        END IF;
    END IF;

    -- 3. Fall back to caller's personal workspace
    IF _workspace_id IS NULL THEN
        SELECT w.id INTO _workspace_id
        FROM public.workspaces w
        JOIN public.workspace_members wm ON wm.workspace_id = w.id
        WHERE w.is_personal = TRUE
          AND w.owner_id = _uid
          AND wm.user_id = _uid
          AND w.deleted_at IS NULL
        LIMIT 1;
    END IF;

    -- 4. Create personal workspace if none exists
    IF _workspace_id IS NULL THEN
        INSERT INTO public.workspaces (name, owner_id, is_personal)
        VALUES ('My Workspace', _uid, TRUE)
        RETURNING id INTO _workspace_id;

        INSERT INTO public.workspace_members (workspace_id, user_id, role)
        VALUES (_workspace_id, _uid, 'admin');
    END IF;

    -- 5. Heal user_profiles.default_workspace_id
    UPDATE public.user_profiles
    SET default_workspace_id = _workspace_id,
        updated_at = now()
    WHERE user_id = _uid;

    -- 6. Return workspace details with caller's role and subscription seats
    SELECT jsonb_build_object(
        'id',          w.id,
        'name',        w.name,
        'owner_id',    w.owner_id,
        'is_personal', w.is_personal,
        'role',        wm.role,
        'seats',       (SELECT s.seats FROM public.subscriptions s WHERE s.workspace_id = w.id LIMIT 1),
        'created_at',  w.created_at,
        'updated_at',  w.updated_at
    ) INTO _result
    FROM public.workspaces w
    JOIN public.workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = _uid
    WHERE w.id = _workspace_id;

    RETURN _result;
END;
$$;

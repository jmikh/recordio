-- workspace_get(p_workspace_id)
--
-- Returns workspace details, member list, pending invitations,
-- subscription seats, and the caller's role.
-- Raises if caller is not a member (assert_workspace_viewer).
--
-- Called by: webapp workspace settings page
-- Tables:   workspaces, workspace_members, workspace_invitations, subscriptions

CREATE OR REPLACE FUNCTION public.workspace_get(p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _result JSONB;
BEGIN
    PERFORM public.assert_workspace_viewer(p_workspace_id);

    SELECT jsonb_build_object(
        'id',          w.id,
        'name',        w.name,
        'owner_id',    w.owner_id,
        'role',        (
            SELECT wm2.role FROM public.workspace_members wm2
            WHERE wm2.workspace_id = w.id AND wm2.user_id = auth.uid()
        ),
        'seats',       (
            SELECT s.seats FROM public.subscriptions s
            WHERE s.workspace_id = w.id
            LIMIT 1
        ),
        'viewer_seats', (
            SELECT CASE WHEN s.seats IS NOT NULL THEN s.seats * 10 ELSE NULL END
            FROM public.subscriptions s
            WHERE s.workspace_id = w.id
            LIMIT 1
        ),
        'members',     (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'user_id',    wm.user_id,
                'role',       wm.role,
                'email',      u.email,
                'name',       (SELECT name FROM public.user_profiles WHERE user_id = wm.user_id),
                'created_at', wm.created_at
            ) ORDER BY wm.created_at ASC), '[]'::jsonb)
            FROM public.workspace_members wm
            JOIN auth.users u ON u.id = wm.user_id
            WHERE wm.workspace_id = w.id
        ),
        'invitations',  (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id',         wi.id,
                'email',      wi.email,
                'role',       wi.role,
                'invited_by', wi.invited_by,
                'created_at', wi.created_at,
                'expires_at', wi.expires_at
            ) ORDER BY wi.created_at ASC), '[]'::jsonb)
            FROM public.workspace_invitations wi
            WHERE wi.workspace_id = w.id
              AND wi.status = 'pending'
              AND wi.expires_at > now()
        ),
        'created_at',  w.created_at,
        'updated_at',  w.updated_at
    ) INTO _result
    FROM public.workspaces w
    WHERE w.id = p_workspace_id
      AND w.deleted_at IS NULL;

    RETURN _result;
END;
$$;

-- workspace_seats_set(p_workspace_id, p_seats)
--
-- Sets the seat count on the workspace's subscription.
-- Caller must be a workspace admin.
-- Blocked on personal workspaces.
-- Returns updated seats value.
--
-- Called by: workspace settings members tab (upgrade / adjust seats)
-- Tables:   subscriptions, workspaces

CREATE OR REPLACE FUNCTION public.workspace_seats_set(
    p_workspace_id UUID,
    p_seats        INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _is_personal BOOLEAN;
BEGIN
    PERFORM public.assert_workspace_admin(p_workspace_id);

    SELECT is_personal INTO _is_personal
    FROM public.workspaces
    WHERE id = p_workspace_id AND deleted_at IS NULL;

    IF _is_personal THEN
        RAISE EXCEPTION 'Cannot configure seats on a personal workspace';
    END IF;

    IF p_seats IS NULL OR p_seats < 1 THEN
        RAISE EXCEPTION 'seats must be at least 1';
    END IF;

    UPDATE public.subscriptions
    SET seats      = p_seats,
        updated_at = now()
    WHERE workspace_id = p_workspace_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No subscription found for this workspace';
    END IF;

    RETURN jsonb_build_object('seats', p_seats);
END;
$$;

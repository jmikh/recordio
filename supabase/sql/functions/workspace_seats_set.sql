-- workspace_seats_set(p_workspace_id, p_seats)
--
-- Sets the seat count on the workspace's subscription.
-- Caller must be a workspace admin.
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
BEGIN
    PERFORM public.assert_workspace_admin(p_workspace_id);

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

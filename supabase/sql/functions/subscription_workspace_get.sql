-- subscription_workspace_get(p_workspace_id)
--
-- Returns full subscription info for a specific workspace.
-- Caller must be a workspace admin.
-- Used by the workspace billing tab.
--
-- Called by: WorkspaceSettingsPage billing tab
-- Tables:   subscriptions

CREATE OR REPLACE FUNCTION public.subscription_workspace_get(p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM public.assert_workspace_admin(p_workspace_id);

    RETURN (
        SELECT jsonb_build_object(
            'status',               s.status,
            'plan',                 s.plan,
            'current_period_end',   s.current_period_end,
            'cancel_at_period_end', s.cancel_at_period_end,
            'billing_interval',     s.billing_interval,
            'seats',                s.seats
        )
        FROM public.subscriptions s
        WHERE s.workspace_id = p_workspace_id
    );
END;
$$;

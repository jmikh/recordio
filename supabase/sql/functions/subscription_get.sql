-- subscription_get(p_workspace_id)
--
-- Returns the subscription for the given workspace.
-- If p_workspace_id is omitted, falls back to the caller's oldest owned workspace.
-- Returns NULL if no subscription exists.
--
-- Security: caller must be a member of the workspace (enforced via JOIN on workspace_members).
--
-- Called by: webapp AuthManager on login, BillingTab subscription poll, workspace switch
-- Tables:   subscriptions, workspace_members, workspaces

CREATE OR REPLACE FUNCTION public.subscription_get(p_workspace_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT jsonb_build_object(
        'status',               s.status,
        'plan',                 s.plan,
        'current_period_end',   s.current_period_end,
        'cancel_at_period_end', s.cancel_at_period_end,
        'stripe_customer_id',   s.stripe_customer_id,
        'billing_interval',     s.billing_interval,
        'seats',                s.seats
    )
    FROM public.subscriptions s
    -- Verify the caller is a member of the workspace
    JOIN public.workspace_members wm
        ON wm.workspace_id = s.workspace_id
       AND wm.user_id = auth.uid()
    WHERE s.workspace_id = COALESCE(
        p_workspace_id,
        -- Fall back to caller's oldest owned workspace
        (SELECT w.id FROM public.workspaces w
         WHERE w.owner_id = auth.uid()
           AND w.deleted_at IS NULL
         ORDER BY w.created_at ASC
         LIMIT 1)
    )
    LIMIT 1;
$$;

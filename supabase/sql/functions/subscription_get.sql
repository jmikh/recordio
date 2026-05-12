-- subscription_get()
--
-- Returns the authenticated user's subscription for their personal workspace.
-- Used by AuthManager on login and UpgradeModal for Pro detection.
-- Returns NULL if no subscription exists.
--
-- Called by: webapp AuthManager.fetchSubscription, UpgradeModal subscription poll
-- Tables:   subscriptions, workspaces

CREATE OR REPLACE FUNCTION public.subscription_get()
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
    JOIN public.workspaces w ON w.id = s.workspace_id
    WHERE w.owner_id   = auth.uid()
      AND w.is_personal = TRUE
    LIMIT 1;
$$;

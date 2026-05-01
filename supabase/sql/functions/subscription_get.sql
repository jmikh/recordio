-- subscription_get()
--
-- Returns the authenticated user's Stripe subscription info.
-- Returns NULL if no subscription exists (free/trial-only user, or webhook hasn't fired yet).
--
-- Called by: webapp AuthManager.fetchSubscription, UpgradeModal subscription poll
-- Tables:   subscriptions

CREATE OR REPLACE FUNCTION public.subscription_get()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT jsonb_build_object(
        'status', s.status,
        'current_period_end', s.current_period_end,
        'cancel_at_period_end', s.cancel_at_period_end,
        'stripe_customer_id', s.stripe_customer_id,
        'billing_interval', s.billing_interval
    )
    FROM public.subscriptions s
    WHERE s.user_id = auth.uid()
    LIMIT 1;
$$;

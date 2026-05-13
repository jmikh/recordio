-- set_project_expiry(p_user_id, p_expires_at)
--
-- Sets expires_at on all non-deleted projects created by a user.
-- Called from Stripe webhook when subscription status changes:
--   - User loses Pro: p_expires_at = NOW() + 14 days
--   - User becomes Pro: p_expires_at = NULL (clears countdown)
--
-- Called by: stripe-webhooks edge function
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.set_project_expiry(p_user_id UUID, p_expires_at TIMESTAMPTZ)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE public.projects
    SET expires_at = p_expires_at
    WHERE created_by = p_user_id AND deleted_at IS NULL;
$$;

-- Service-role only — called by stripe-webhooks edge function
REVOKE ALL ON FUNCTION public.set_project_expiry(UUID, TIMESTAMPTZ) FROM public;
REVOKE ALL ON FUNCTION public.set_project_expiry(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.set_project_expiry(UUID, TIMESTAMPTZ) FROM authenticated;

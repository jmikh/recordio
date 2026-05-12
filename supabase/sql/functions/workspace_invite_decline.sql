-- workspace_invite_decline(p_token)
--
-- Declines a workspace invitation identified by token.
-- Validates: token exists, status = 'pending'.
-- Sets invitation status = 'declined'.
-- Does not require authentication — token is the secret.
--
-- Called by: invite decline page
-- Tables:   workspace_invitations

CREATE OR REPLACE FUNCTION public.workspace_invite_decline(p_token UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.workspace_invitations
    SET status = 'declined'
    WHERE token = p_token
      AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found or already used';
    END IF;
END;
$$;

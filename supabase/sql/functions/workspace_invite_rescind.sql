-- workspace_invite_rescind(p_invitation_id)
--
-- Cancels a pending workspace invitation.
-- Caller must be a workspace admin for the workspace that owns the invitation.
-- Returns the deleted invitation id.
--
-- Called by: workspace settings members tab (pending invitations list)
-- Tables:   workspace_invitations

CREATE OR REPLACE FUNCTION public.workspace_invite_rescind(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _workspace_id UUID;
BEGIN
    -- Look up the workspace this invitation belongs to
    SELECT workspace_id INTO _workspace_id
    FROM public.workspace_invitations
    WHERE id = p_invitation_id
      AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found or already resolved';
    END IF;

    -- Verify caller is an admin of that workspace
    PERFORM public.assert_workspace_admin(_workspace_id);

    -- Delete the invitation
    DELETE FROM public.workspace_invitations
    WHERE id = p_invitation_id;

    RETURN jsonb_build_object('invitation_id', p_invitation_id);
END;
$$;

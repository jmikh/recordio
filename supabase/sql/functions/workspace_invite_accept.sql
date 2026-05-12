-- workspace_invite_accept(p_token)
--
-- Accepts a workspace invitation identified by token.
-- Validates: token exists, status = 'pending', not expired.
-- Inserts the caller into workspace_members with the invitation's role.
-- Sets invitation status = 'accepted'.
-- Updates caller's default_workspace_id to the joined workspace.
--
-- Called by: invite accept page (authenticated)
-- Tables:   workspace_invitations, workspace_members, user_profiles

CREATE OR REPLACE FUNCTION public.workspace_invite_accept(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _uid UUID := auth.uid();
    _inv RECORD;
BEGIN
    SELECT * INTO _inv
    FROM public.workspace_invitations
    WHERE token = p_token
      AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found or already used';
    END IF;

    IF _inv.expires_at < now() THEN
        UPDATE public.workspace_invitations
        SET status = 'expired'
        WHERE id = _inv.id;
        RAISE EXCEPTION 'Invitation has expired';
    END IF;

    -- Add to workspace
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (_inv.workspace_id, _uid, _inv.role)
    ON CONFLICT (workspace_id, user_id) DO UPDATE
        SET role = EXCLUDED.role, updated_at = now();

    -- Mark accepted
    UPDATE public.workspace_invitations
    SET status = 'accepted'
    WHERE id = _inv.id;

    -- Update default workspace to the newly joined one
    UPDATE public.user_profiles
    SET default_workspace_id = _inv.workspace_id,
        updated_at = now()
    WHERE user_id = _uid;

    RETURN jsonb_build_object(
        'workspace_id', _inv.workspace_id,
        'role',         _inv.role
    );
END;
$$;

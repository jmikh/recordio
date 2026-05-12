-- workspace_invite(p_workspace_id, p_email, p_role)
--
-- Creates a fresh invitation for the given email in this workspace.
-- Any existing invitation for that email is deleted first (re-invite flow).
-- Caller must be a workspace admin.
-- Blocked on personal workspaces (is_personal = TRUE).
-- Fires an invite email via the send-workspace-invite edge function.
-- Returns the invitation id and token.
--
-- Called by: workspace invite UI
-- Tables:   workspace_invitations, workspaces

CREATE OR REPLACE FUNCTION public.workspace_invite(
    p_workspace_id UUID,
    p_email        TEXT,
    p_role         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _uid         UUID := auth.uid();
    _is_personal BOOLEAN;
    _inv_id      UUID;
    _token       UUID;
BEGIN
    PERFORM public.assert_workspace_admin(p_workspace_id);

    SELECT is_personal INTO _is_personal
    FROM public.workspaces
    WHERE id = p_workspace_id AND deleted_at IS NULL;

    IF _is_personal THEN
        RAISE EXCEPTION 'Cannot invite members to a personal workspace';
    END IF;

    IF p_role NOT IN ('viewer', 'creator', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role;
    END IF;

    -- Delete any existing invitation for this email in this workspace
    DELETE FROM public.workspace_invitations
    WHERE workspace_id = p_workspace_id
      AND email = lower(p_email);

    -- Create fresh invitation
    INSERT INTO public.workspace_invitations (workspace_id, email, role, invited_by, token, status, expires_at)
    VALUES (p_workspace_id, lower(p_email), p_role, _uid, gen_random_uuid(), 'pending', now() + interval '7 days')
    RETURNING id, token INTO _inv_id, _token;

    -- Fire invite email via edge function
    PERFORM net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL')
                   || '/functions/v1/send-workspace-invite',
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SECRET_KEY')
        ),
        body    := jsonb_build_object(
            'workspace_id', p_workspace_id,
            'email',        lower(p_email),
            'role',         p_role,
            'token',        _token,
            'invited_by',   _uid
        )
    );

    RETURN jsonb_build_object(
        'invitation_id', _inv_id,
        'token',         _token
    );
END;
$$;

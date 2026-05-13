-- workspace_set_default(p_workspace_id)
--
-- Sets the caller's default workspace to p_workspace_id.
-- Raises if the caller is not a member of that workspace.
--
-- Called by: webapp when the user switches workspace
-- Tables:   user_profiles, workspace_members

CREATE OR REPLACE FUNCTION public.workspace_set_default(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _uid UUID := auth.uid();
BEGIN
    PERFORM public.assert_workspace_viewer(p_workspace_id);

    UPDATE public.user_profiles
    SET default_workspace_id = p_workspace_id,
        updated_at = now()
    WHERE user_id = _uid;
END;
$$;

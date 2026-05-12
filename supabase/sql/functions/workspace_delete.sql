-- workspace_delete(p_workspace_id)
--
-- Soft-deletes a workspace by setting deleted_at.
-- Caller must be the workspace owner (owner_id).
-- Blocked on personal workspaces (is_personal = TRUE).
--
-- Called by: webapp workspace settings (danger zone)
-- Tables:   workspaces

CREATE OR REPLACE FUNCTION public.workspace_delete(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _workspace RECORD;
BEGIN
    SELECT id, owner_id, is_personal INTO _workspace
    FROM public.workspaces
    WHERE id = p_workspace_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workspace not found';
    END IF;

    IF _workspace.owner_id <> auth.uid() THEN
        RAISE EXCEPTION 'Only the workspace owner can delete a workspace';
    END IF;

    IF _workspace.is_personal THEN
        RAISE EXCEPTION 'Personal workspaces cannot be deleted';
    END IF;

    UPDATE public.workspaces
    SET deleted_at = now(), updated_at = now()
    WHERE id = p_workspace_id;
END;
$$;

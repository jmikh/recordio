-- workspace_delete(p_workspace_id)
--
-- Soft-deletes a workspace by setting deleted_at.
-- Caller must be the workspace owner (owner_id).
-- Blocked if this is the owner's last remaining workspace.
--
-- Called by: webapp workspace settings (danger zone)
-- Tables:   workspaces

CREATE OR REPLACE FUNCTION public.workspace_delete(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    _owner_id UUID;
    _owner_workspace_count INT;
BEGIN
    SELECT owner_id INTO _owner_id
    FROM public.workspaces
    WHERE id = p_workspace_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE SQLSTATE 'PT404' USING MESSAGE = 'Workspace not found';
    END IF;

    IF _owner_id <> auth.uid() THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'Only the workspace owner can delete a workspace';
    END IF;

    -- Count remaining non-deleted workspaces owned by this user
    SELECT COUNT(*) INTO _owner_workspace_count
    FROM public.workspaces
    WHERE owner_id = auth.uid()
      AND deleted_at IS NULL;

    IF _owner_workspace_count <= 1 THEN
        RAISE SQLSTATE 'PT400' USING MESSAGE = 'Cannot delete your last workspace';
    END IF;

    UPDATE public.workspaces
    SET deleted_at = now(), updated_at = now()
    WHERE id = p_workspace_id;
END;
$$;

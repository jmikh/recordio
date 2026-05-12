-- project_restore(p_project_id)
--
-- Restores a soft-deleted project by clearing deleted_at.
-- Only the project owner can restore.
-- Returns true if a row was updated, false otherwise.
--
-- Called by: webapp CloudStorage.restoreProject
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_restore(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rows_updated INT;
BEGIN
    UPDATE public.projects
    SET deleted_at = NULL
    WHERE id = p_project_id
      AND owner_id = auth.uid()
      AND deleted_at IS NOT NULL
      AND permanently_deleted = false;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated > 0;
END;
$$;

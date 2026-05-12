-- project_delete(p_project_id)
--
-- Soft-deletes a project by setting deleted_at.
-- Only the project owner can delete (owner_id = auth.uid()).
-- Returns true if a row was updated, false otherwise.
--
-- Called by: webapp CloudStorage.softDeleteProject
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_delete(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rows_updated INT;
BEGIN
    UPDATE public.projects
    SET deleted_at = NOW()
    WHERE id = p_project_id
      AND owner_id = auth.uid()
      AND deleted_at IS NULL;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated > 0;
END;
$$;

-- project_star(p_project_id, p_starred)
--
-- Sets the is_starred flag on a project.
-- Caller must be the project owner.
--
-- Called by: webapp CloudStorage.starProject
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_star(p_project_id UUID, p_starred BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.projects
    SET is_starred = p_starred, updated_at = now()
    WHERE id = p_project_id
      AND owner_id = auth.uid()
      AND deleted_at IS NULL;
END;
$$;

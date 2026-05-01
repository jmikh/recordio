-- project_rename(p_project_id, p_name)
--
-- Renames a project.
--
-- Called by: webapp CloudStorage.renameProject
-- Tables:   projects

CREATE OR REPLACE FUNCTION public.project_rename(p_project_id UUID, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.projects
    SET name = p_name,
        updated_at = now()
    WHERE id = p_project_id
      AND user_id = auth.uid();
END;
$$;

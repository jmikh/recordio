-- Folders and starred removed from the product (2026-07-24).
--
-- Push order: deploy the webapp + server first, then run sql/deploy.sh
-- (replaces project_list/project_get so they stop selecting these
-- columns, and graveyard-drops the folder_*/project_star/
-- project_move_to_folder functions), THEN push this migration.

-- Dropping the columns also drops their indexes
-- (idx_projects_folder, idx_projects_workspace_starred) and the
-- projects_folder_id_fkey constraint.
ALTER TABLE public.projects DROP COLUMN IF EXISTS folder_id;
ALTER TABLE public.projects DROP COLUMN IF EXISTS is_starred;

DROP TABLE IF EXISTS public.folders;

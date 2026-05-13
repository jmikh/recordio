-- Drop the is_personal column from workspaces.
-- Personal workspaces are now identified by owner_id = auth.uid()
-- and the oldest created_at (first workspace owned by the user).
--
-- All SQL functions have been updated accordingly.

ALTER TABLE public.workspaces DROP COLUMN IF EXISTS is_personal;

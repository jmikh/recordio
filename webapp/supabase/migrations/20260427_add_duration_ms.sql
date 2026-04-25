-- Add duration_ms column to projects table.
-- Derived from output windows and written on every sync so dashboard
-- can show duration without loading the full project_data blob.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

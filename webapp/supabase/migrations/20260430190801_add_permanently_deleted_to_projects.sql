-- Add permanently_deleted flag to projects.
-- Once true the user can no longer restore from trash.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS permanently_deleted boolean NOT NULL DEFAULT false;

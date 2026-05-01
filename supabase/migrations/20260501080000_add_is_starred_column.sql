-- Add is_starred column to projects table for starred/favorite functionality
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast filtered queries on starred projects per user
CREATE INDEX IF NOT EXISTS idx_projects_user_starred ON public.projects (user_id, is_starred) WHERE is_starred = true;

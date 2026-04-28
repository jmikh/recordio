-- Convert projects.id from TEXT to UUID.
-- All existing values are valid UUIDs stored as text.
-- The original migration (20260426100000) may have failed due to existing data/constraints.

-- 1. Drop dependent indexes
DROP INDEX IF EXISTS idx_projects_user_updated;
DROP INDEX IF EXISTS idx_projects_user_accessed;
DROP INDEX IF EXISTS idx_projects_expires;

-- 2. Drop PK, convert type, re-add PK
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_pkey;
ALTER TABLE public.projects ALTER COLUMN id TYPE UUID USING id::uuid;
ALTER TABLE public.projects ADD PRIMARY KEY (id);

-- 3. Recreate user_id index
CREATE INDEX IF NOT EXISTS idx_projects_user_id
    ON public.projects(user_id);

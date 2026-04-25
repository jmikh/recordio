-- Revert projects PK from TEXT back to UUID.
-- Local project IDs are now plain UUIDs (no "proj-" prefix), so UUID type is correct.

-- Drop old indexes (no longer needed — PK covers id, user_id index is sufficient)
DROP INDEX IF EXISTS idx_projects_user_updated;
DROP INDEX IF EXISTS idx_projects_user_accessed;
DROP INDEX IF EXISTS idx_projects_expires;

-- Change PK type back to UUID
ALTER TABLE public.projects DROP CONSTRAINT projects_pkey;
ALTER TABLE public.projects ALTER COLUMN id TYPE UUID USING id::uuid;
ALTER TABLE public.projects ADD PRIMARY KEY (id);

-- Single index on user_id for filtering by owner
CREATE INDEX IF NOT EXISTS idx_projects_user_id
    ON public.projects(user_id);

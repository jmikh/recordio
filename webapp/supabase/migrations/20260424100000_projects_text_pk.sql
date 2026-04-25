-- Change projects PK from UUID to TEXT so local project ID is used directly.
-- This makes local and cloud IDs identical, eliminating the need for a separate mapping.

-- Drop dependent indexes first
DROP INDEX IF EXISTS idx_projects_user_updated;
DROP INDEX IF EXISTS idx_projects_user_accessed;
DROP INDEX IF EXISTS idx_projects_expires;

-- Change PK type
ALTER TABLE public.projects DROP CONSTRAINT projects_pkey;
ALTER TABLE public.projects ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.projects ALTER COLUMN id TYPE TEXT;
ALTER TABLE public.projects ADD PRIMARY KEY (id);

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_projects_user_updated
    ON public.projects(user_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_user_accessed
    ON public.projects(user_id, last_accessed_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_expires
    ON public.projects(expires_at)
    WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

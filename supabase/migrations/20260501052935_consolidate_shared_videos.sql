-- Move slug + share_policy from shared_videos into projects table,
-- then drop shared_videos.

-- 1. Add columns
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS share_policy TEXT NOT NULL DEFAULT 'public'
    CHECK (share_policy IN ('public', 'private'));

-- 2. Backfill from shared_videos
UPDATE public.projects p
SET slug = sv.slug,
    share_policy = sv.policy
FROM public.shared_videos sv
WHERE sv.project_id = p.id;

-- 3. Drop old table
DROP TABLE IF EXISTS public.shared_videos;

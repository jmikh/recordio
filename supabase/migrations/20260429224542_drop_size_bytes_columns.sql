-- Drop quota system — no longer used

-- Drop per-media size tracking columns from projects
ALTER TABLE public.projects
    DROP COLUMN IF EXISTS screen_size_bytes,
    DROP COLUMN IF EXISTS camera_size_bytes,
    DROP COLUMN IF EXISTS mic_size_bytes;

-- Drop user_quotas table
DROP TABLE IF EXISTS public.user_quotas;

-- Drop get_user_storage_bytes function
DROP FUNCTION IF EXISTS public.get_user_storage_bytes(UUID);

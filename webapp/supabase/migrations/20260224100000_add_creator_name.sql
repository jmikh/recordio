-- 1. Add the column
ALTER TABLE shared_videos ADD COLUMN IF NOT EXISTS creator_name TEXT;

-- 2. Backfill from auth.users metadata (Google OAuth stores full_name)
UPDATE shared_videos sv
SET creator_name = COALESCE(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    split_part(u.email, '@', 1),
    'A Recordio user'
)
FROM auth.users u
WHERE sv.user_id = u.id
  AND sv.creator_name IS NULL;

-- Add description column to shared_videos
ALTER TABLE shared_videos
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

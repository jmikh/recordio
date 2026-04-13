-- Shared Videos table for Cloudflare Stream integration
-- Stores metadata linking local projects to uploaded CF Stream videos

CREATE TABLE IF NOT EXISTS shared_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  cf_video_uid TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, project_id)
);

-- RLS: users can only see/modify their own rows
ALTER TABLE shared_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own shared videos" ON shared_videos;
CREATE POLICY "Users can view own shared videos"
  ON shared_videos FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own shared videos" ON shared_videos;
CREATE POLICY "Users can insert own shared videos"
  ON shared_videos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own shared videos" ON shared_videos;
CREATE POLICY "Users can update own shared videos"
  ON shared_videos FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own shared videos" ON shared_videos;
CREATE POLICY "Users can delete own shared videos"
  ON shared_videos FOR DELETE
  USING (auth.uid() = user_id);

-- Allow anonymous read for the watch page (anyone with a link can view metadata)
DROP POLICY IF EXISTS "Public can view shared video metadata" ON shared_videos;
CREATE POLICY "Public can view shared video metadata"
  ON shared_videos FOR SELECT
  USING (true);

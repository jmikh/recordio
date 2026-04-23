# shared_videos

Stores metadata for videos that users have published/shared. Each row links a user's local project to an uploaded Cloudflare Stream video. Has a unique constraint on `(user_id, project_id)` so each project can only have one active share. Supports versioning via the `version` column and tracks upload progress via `status` and `upload_started_at`.

**Accessed by:** `ShareService.ts` (frontend), `upload-to-stream` / `confirm-upload` / `delete-from-stream` / `get-video-analytics` edge functions, `cron_cleanup_stale_uploads` SQL function.

**RLS:** Enabled. Public read access for viewing shared videos. Users can insert/update/delete their own rows (`auth.uid() = user_id`).

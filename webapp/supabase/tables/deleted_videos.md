# deleted_videos

Soft-deletion queue for Cloudflare Stream videos. When a video needs to be removed (stale upload, user-initiated delete), a row is inserted here instead of immediately calling the Cloudflare API. The `purge-deleted-videos` edge function runs on a cron schedule, processes rows from this table, and deletes the actual video from Cloudflare Stream.

**Accessed by:** `purge-deleted-videos` edge function, `purge-deleted-projects` edge function, `delete-from-stream` edge function, `upload-to-stream` edge function.

**RLS:** Enabled, no user-facing policies (service-role only).

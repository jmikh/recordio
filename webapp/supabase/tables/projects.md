# projects

Cloud-backed project storage. Stores project metadata (settings, timeline, segments as JSONB), media storage paths, upload tracking, published video state, and sync/expiry metadata.

## Key columns

| Column | Purpose |
|--------|---------|
| `id` | UUID primary key — same as client-side project ID |
| `project_data` | Full Project JSON (settings, timeline, segments — no blobs) |
| `duration_ms` | Total output duration in ms (derived from output windows). Written on every sync so dashboard can show duration without loading project_data |
| `screen/camera/mic_storage_path` | Supabase Storage paths. NULL = doesn't exist. `'pending'` = not yet uploaded |
| `upload_status` | `'pending'` (media uploading), `'ready'` (all uploaded), `'deleting'` (cleanup in progress) |
| `cf_video_uid` | Cloudflare Stream UID (non-null = published) |
| `cloud_version` | Optimistic concurrency — incremented on every cloud write |
| `expires_at` | Non-Pro: NOW() + 14 days. Pro: NULL. Cron soft-deletes past expiry |

## Accessed by

- `cloudStorage.ts` (webapp) — metadata CRUD via RLS
- `syncService.ts` (webapp) — orchestrates sync
- `storage-upload-url` edge function — quota check
- `storage-confirm-upload` edge function — updates paths after upload
- `cleanup-expired-projects` edge function — Storage/CF cleanup for soft-deleted rows
- `stripe-webhooks` edge function — sets expiry via `set_project_expiry()`

## RLS

- SELECT/INSERT/UPDATE: `auth.uid() = user_id`
- No DELETE policy (soft-delete only via `deleted_at`)

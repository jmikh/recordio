# Render Worker: Zero Supabase Credentials

## Context

The render worker (Fly.io) currently has full Supabase service-role credentials. We're refactoring so the worker is a "dumb" render machine — receives signed URLs, renders, uploads via signed URL PUT, and reports status via edge function callback. Quality is removed as a user-facing concept: everything renders at 1080p/30fps.

## Simplified `render_jobs` Table

Drop `phase` column. Keep only:
- `status`: `pending` | `completed` | `failed` | `canceled`
- `progress`: `0.0` to `1.0`
- `updated_at`: timestamp (used for heartbeat/stale detection)
- `error`: text (on failure)
- `output_storage_path`, `project_id`, `user_id`, `quality`, `cloud_version`

`pending` is the only "live" state. Progress tells you how far along. Status represents the outcome.

**Migration**: alter existing table to drop `phase`, add index for dedup queries.

## Edge Functions

### `render-start-job` (replaces `start-render`)

**Request:** `POST` with user JWT. Body: `{ projectId }`
**Response:** `{ jobId, status }` — also `outputStoragePath` if `completed`

Logic:
1. Auth + Pro check (via `withAuth`)
2. Look up project (RLS-scoped) — get `project_data`, `cloud_version`, media storage paths
3. **Cache hit**: completed job with same `project_id` + `cloud_version` → return it
4. **Dedup**: pending job with same `project_id` + `cloud_version` → return it
5. **Cancel stale**: set all non-completed jobs for this project to `canceled`
6. Generate signed download URLs for media (1h expiry)
7. Generate signed upload URL for output at `{userId}/{projectId}/render_1080p.mp4` (`upsert: true`)
8. Insert `render_jobs` row (quality hardcoded `'1080p'`)
9. Dispatch to worker:
   ```json
   { "jobId", "projectData", "quality", "mediaUrls": { "screen?", "camera?", "mic?" },
     "uploadUrl", "uploadToken", "statusCallbackUrl" }
   ```
10. If worker unreachable → mark job `failed`

### `render-update-status` (new, worker-only)

**Auth:** `RENDER_SECRET` in Authorization header (not JWT, not `withAuth`).

**Request:** `POST`
```json
{ "jobId": "uuid", "status?": "completed" | "failed", "progress?": 0.0-1.0, "error?": "..." }
```

**Logic:**
1. Verify `RENDER_SECRET`
2. Read current job status
3. **If current status is NOT `pending`** → don't update, return `{ "ok": true, "cancel": true }`
4. **If current status is `pending`** → apply updates, set `updated_at`, return `{ "ok": true, "cancel": false }`

This means:
- Worker sends progress every 15s → gets `cancel: false` → continues
- Job gets canceled (new render started) → worker's next heartbeat gets `cancel: true` → worker aborts
- Worker sends `completed`/`failed` → status transitions from `pending` to final state
- If job was already canceled and worker tries to mark complete → `cancel: true`, status stays `canceled`

### Stale Job Cron (pure SQL, `pg_cron`)

Runs every minute. Marks jobs as `failed` if no heartbeat in 1 minute (4+ missed 15s heartbeats):
```sql
UPDATE render_jobs
SET status = 'failed', error = 'Worker unresponsive', updated_at = now()
WHERE status = 'pending'
  AND updated_at < now() - interval '1 minute';
```
Worst case detection: ~2 minutes (worker dies right after cron run). Average ~1.5 minutes.

## Worker Changes

### Config (`config.ts`)
Only `PORT` and `RENDER_SECRET`. No Supabase vars.

### Server (`server.ts`)
- New payload shape: `{ jobId, projectData, quality, mediaUrls, uploadUrl, uploadToken, statusCallbackUrl }`
- `updateJob()` → HTTP POST to `statusCallbackUrl` with `RENDER_SECRET`
- Check response for `cancel: true` → abort render, clean up temp files
- Heartbeat every 15 seconds during rendering
- Immediate update on completion/failure
- Progress 0 during download phase

### Download (`downloadMedia.ts`)
- Plain `fetch(signedUrl)` instead of `supabase.storage.download()`
- Music CDN download unchanged

### Upload (`uploadResult.ts`)
- Single PUT to signed upload URL (drop TUS)
- Remove `tus-js-client` dependency
- Basic retry on failure (retry full PUT)

### Deletions
- `render-worker/src/supabase.ts` — deleted
- Dependencies removed: `@supabase/supabase-js`, `tus-js-client`

## File Inventory

| Action | File |
|--------|------|
| CREATE | `webapp/supabase/functions/render-start-job/index.ts` |
| CREATE | `webapp/supabase/functions/render-start-job/.config.toml` |
| CREATE | `webapp/supabase/functions/render-update-status/index.ts` |
| CREATE | `webapp/supabase/functions/render-update-status/.config.toml` |
| CREATE | `webapp/supabase/migrations/YYYYMMDD_render_jobs_simplify.sql` (drop phase, add index) |
| CREATE | `webapp/supabase/sql/crons/cron_render_stale_jobs.sql` |
| DELETE | `webapp/supabase/functions/start-render/index.ts` |
| DELETE | `render-worker/src/supabase.ts` |
| MODIFY | `render-worker/src/server.ts` |
| MODIFY | `render-worker/src/downloadMedia.ts` |
| MODIFY | `render-worker/src/uploadResult.ts` |
| MODIFY | `render-worker/src/config.ts` |
| MODIFY | `render-worker/package.json` |
| MODIFY | `render-worker/.env.example` |
| MODIFY | `webapp/supabase/functions/storage-download-urls/index.ts` (add enum mode) |

## Modify `storage-download-urls`

Add enum-based mode alongside existing `storagePath` mode (backwards compat):
```
// Existing (keep working):
{ "storagePath": "userId/projectId/screen.webm" }

// New enum mode:
{ "projectId": "uuid", "fileType": "render" }
```

When `fileType` is provided, the function builds the path internally:
- `render` → `{userId}/{projectId}/render_1080p.mp4`

Later: add `screen`, `camera`, `mic`, `thumbnail` to eliminate raw paths from client entirely.

## Client Flow (not implementing yet)
1. Flush pending project saves (ensure cloud_version is current)
2. Call `render-start-job({ projectId })` → `{ jobId, status }`
3. If `completed` → call `storage-download-urls({ projectId, fileType: 'render' })`
4. If `pending` → subscribe Realtime to `render_jobs` row, show progress bar
5. On `completed` → call `storage-download-urls({ projectId, fileType: 'render' })`
6. On `failed`/`canceled` → show error

## Verification
1. Edge functions: test via `supabase functions serve`
2. Worker: `npm run dev` with mock signed URLs
3. End-to-end: trigger render, verify full pipeline
4. Cancellation: start render, start another, verify first gets canceled
5. Stale detection: kill worker mid-render, verify cron marks job failed

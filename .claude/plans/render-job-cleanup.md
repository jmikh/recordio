# Render Job Cleanup

## Context
We refactored `render_job_start` to atomically handle cache-hit / dedup / cancel / insert. During that work we identified cleanup: the `quality` column is always `'1080p'` and unnecessary, and `output_storage_path` on `render_jobs` should be renamed to `render_storage_path` to match the projects table. `storage-download-urls` should go back to accepting raw `storagePath` since it's also used by `CloudStorage.requestDownloadUrl` for media downloads.

## Changes

### 1. New migration: drop `quality`, rename `output_storage_path` → `render_storage_path` on `render_jobs`
- `ALTER TABLE render_jobs DROP COLUMN quality;`
- `ALTER TABLE render_jobs RENAME COLUMN output_storage_path TO render_storage_path;`

### 2. Update `render_job_start.sql`
- Remove `quality` from INSERT
- Use `render_storage_path` instead of `output_storage_path` in INSERT and return type

### 3. Update `render-start-job/index.ts`
- Read `jobResult.render_storage_path` for signed upload URL
- Remove `quality` from worker dispatch body

### 4. Revert `storage-download-urls/index.ts` back to `storagePath` mode
- Accept `{ storagePath }`, verify it starts with `${user.id}/`

### 5. Update `render-update-status/index.ts`
- Read `render_storage_path` (was `output_storage_path`) from render_jobs
- Already writes `render_storage_path` to projects — no change there

### 6. Update `ExportModal.tsx`
- Add `render_storage_path` to the poll select
- On completion, call `storage-download-urls` with `{ storagePath: job.render_storage_path }`

### 7. Run `build-functions.sh`

## Files
- `supabase/sql/functions/render_job_start.sql`
- `supabase/functions/render-start-job/index.ts`
- `supabase/functions/storage-download-urls/index.ts`
- `supabase/functions/render-update-status/index.ts`
- `webapp/src/editor/components/settings/ExportModal.tsx`
- New migration for column changes

# Direct S3 Upload for Project Creation & Render Worker

## Context
Media uploads go through Supabase's storage proxy (TUS for project creation, signed PUT for render worker), which throttles throughput to ~2 MB/s on a 100 Mbps connection. Downloads were already switched to direct S3 presigned URLs and saw a big speed improvement. This change applies the same pattern to all uploads.

## Plan

### 1. Edge function: `project-create` — S3 presigned PUT URLs

**File:** `supabase/functions/project-create/index.ts`

- Add S3 client + `PutObjectCommand` imports (same pattern as `storage-download-urls/index.ts`)
- Replace lines 100-116 (Supabase `createSignedUploadUrl` loop) with S3 `PutObjectCommand` + `getSignedUrl`
- Each upload entry returns `{ fileType, storagePath, signedUrl }` — drop `token` field
- 1 hour expiry (matches downloads)

### 2. Edge function: `render-job-create` — S3 presigned PUT URL for render output

**File:** `supabase/functions/render-job-create/index.ts`

- S3 client already exists (lines 15-23, used for download URLs)
- Replace lines 157-164 (Supabase `createSignedUploadUrl`) with S3 `PutObjectCommand` + `getSignedUrl`
- Add `PutObjectCommand` to the existing S3 import on line 3

### 3. Client: replace TUS upload with `XMLHttpRequest` PUT

**File:** `webapp/src/storage/cloudStorage.ts`

- Replace `uploadBlobTus()` with `uploadBlobDirect()` using `XMLHttpRequest` for progress tracking (fetch doesn't support upload progress). XHR pattern already used elsewhere in this file.
- Remove `tus-js-client` import

### 4. Client: update `uploadMedia` caller

**File:** `webapp/src/storage/cloudProjectService.ts`

- Line 182: change `CloudStorage.uploadBlobTus(...)` → `CloudStorage.uploadBlobDirect(...)`
- Update `uploads` type to drop `token` field
- Retry logic stays the same (outer retry loop)

### 5. Render worker: remove Supabase-specific header

**File:** `render-worker/src/uploadResult.ts`

- Remove `'x-upsert': 'true'` header (line 25) — S3 presigned PUT doesn't need it
- Everything else already works (it's just a `fetch PUT`)

### 6. Clean up

- Remove `tus-js-client` from `package.json`

## Files to modify
1. `supabase/functions/project-create/index.ts` — S3 presigned PUT URLs
2. `supabase/functions/render-job-create/index.ts` — S3 presigned PUT for render output
3. `webapp/src/storage/cloudStorage.ts` — new `uploadBlobDirect()`, remove TUS
4. `webapp/src/storage/cloudProjectService.ts` — use new upload method
5. `render-worker/src/uploadResult.ts` — drop `x-upsert` header
6. `package.json` — remove `tus-js-client`

## Verification
- Create a new project with screen + camera + mic — confirm upload completes and status flips to 'ready'
- Re-open project — confirm media loads correctly
- Trigger a cloud render — confirm render worker uploads MP4 successfully
- Check network tab to verify requests go directly to S3 endpoint

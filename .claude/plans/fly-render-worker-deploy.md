# Fly.io Render Worker Deployment

## Context

Server-side rendering works locally via Playwright (headless Chromium running ExportManager in browser). Now we need to deploy it as a standalone Fly.io service with an async job system.

## Architecture

```
Webapp → Supabase Edge Function (start-render)
           ├─ Auth user, check Pro subscription
           ├─ Look up project (cloud_version, storage paths)
           ├─ Compute output path: {user_id}/{project_id}/render_{quality}_{cloud_version}.mp4
           ├─ INSERT render_jobs row (status: 'pending', output_storage_path pre-set)
           ├─ POST to Fly.io worker (await acceptance, ~10s timeout)
           │    └─ Worker validates, updates status → 'processing', responds 200
           ├─ If worker unreachable → mark job 'failed', return error
           └─ Return { jobId } to client

Fly.io Worker (after responding 200)
           ├─ Download media from Supabase Storage
           ├─ Run Playwright render
           ├─ Upload MP4 via TUS to output_storage_path
           ├─ UPDATE render_jobs → 'completed'
           └─ On error → UPDATE render_jobs → 'failed' + error

Webapp subscribes to render_jobs row → downloads MP4 when completed
```

## 1. Database: `render_jobs` table

**File**: `webapp/supabase/migrations/{timestamp}_create_render_jobs_table.sql`

```sql
CREATE TABLE IF NOT EXISTS public.render_jobs (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    quality TEXT NOT NULL,
    cloud_version INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed
    progress REAL DEFAULT 0,                 -- 0.0 to 1.0
    phase TEXT,                              -- downloading | rendering | uploading
    output_storage_path TEXT,                -- pre-computed by edge function
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own render jobs" ON public.render_jobs
    FOR SELECT USING (auth.uid() = user_id);
GRANT ALL ON TABLE public.render_jobs TO service_role;
GRANT SELECT ON TABLE public.render_jobs TO authenticated;
```

## 2. Supabase Edge Function: `start-render`

**File**: `webapp/supabase/functions/start-render/index.ts`

Uses `withAuth` from `_shared/auth.ts`:
1. Auth user (JWT), check Pro subscription
2. Query project → `cloud_version`, `screen_storage_path`, `camera_storage_path`, `mic_storage_path`
3. Compute output path: `{user.id}/{projectId}/render_{quality}_{cloud_version}.mp4`
4. INSERT `render_jobs` row with `output_storage_path` pre-set
5. POST to worker: `{ jobId, projectId, userId, quality, cloudVersion, storagePaths, outputStoragePath }`
   - Auth: `Bearer <RENDER_SECRET>`
   - **Await response** (~10s timeout)
6. Worker responds 200 = accepted → return `{ jobId }` to client
7. Worker down/timeout → UPDATE job `'failed'`, return error

**Env vars**: `RENDER_WORKER_URL`, `RENDER_SECRET`

## 3. Fly.io Render Worker

### 3a. `render-worker/src/server.ts` — Fastify entry point

- `GET /health`
- `POST /render`:
  - Validate `RENDER_SECRET` bearer
  - UPDATE job → `'processing'`
  - **Respond 200** (accepted)
  - Background: download → render → upload → update job
  - Progress updates written to `render_jobs` row periodically

### 3b. Upload via TUS

Worker uploads the MP4 to `output_storage_path` (passed by edge function) using TUS resumable protocol:
- Endpoint: `{SUPABASE_URL}/storage/v1/upload/resumable`
- Auth: `Bearer <SUPABASE_SECRET_KEY>` (service role)
- Bucket: `project-media`
- Chunked upload (6MB chunks) for reliability with large files
- Uses `tus-js-client` npm package (same as webapp)

### 3c. Moved from backend

| From | To |
|------|-----|
| `backend/src/render/playwrightRender.ts` | `render-worker/src/playwrightRender.ts` |
| Download logic from `backend/src/render/route.ts` | `render-worker/src/downloadMedia.ts` |

### 3d. New files

- `render-worker/src/server.ts` — Fastify entry
- `render-worker/src/config.ts` — env validation
- `render-worker/src/supabase.ts` — service-role client
- `render-worker/src/uploadResult.ts` — TUS upload to Supabase Storage
- `render-worker/Dockerfile`
- `render-worker/fly.toml`

### 3e. Package.json

Add: `fastify`, `playwright`, `zod`, `tus-js-client`
Remove: `@napi-rs/canvas`
Build: `tsup` (bundles `@shared/*` aliases into single output)

### 3f. Dockerfile (multi-stage)

```
Stage 1 (render-page-builder): node:22-slim
  - COPY shared/, webapp/src/, webapp/public/, render-worker/render-page/
  - Vite build render-page → dist/

Stage 2 (worker-builder): node:22-slim
  - COPY shared/, render-worker/src/, render-worker/package.json
  - npm ci && tsup bundle → dist/

Stage 3 (runtime): mcr.microsoft.com/playwright:v1.59.1-noble
  - COPY render-page/dist/, worker dist/, node_modules
  - npx playwright install chromium
  - EXPOSE 8080, CMD node dist/server.js
```

Docker context = monorepo root (needs shared/, webapp/src/).

### 3g. fly.toml

```toml
app = "recordio-render-worker"
primary_region = "sjc"

[http_service]
  internal_port = 8080
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "performance-2x"  # 4GB RAM for Playwright
```

Secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RENDER_SECRET`

## 4. Storage path convention

`{user_id}/{project_id}/render_{quality}_{cloud_version}.mp4`
- Same `project-media` bucket as source media
- Edge function computes path and stores in `render_jobs.output_storage_path`
- Future: check if path already exists → skip re-render (cache hit)

## 5. Webapp changes

- Call `start-render` edge function instead of backend `/render`
- Subscribe to `render_jobs` row via Supabase Realtime
- Display progress/phase from row updates
- On `'completed'`: download MP4 via signed URL from `output_storage_path`

## 6. Backend cleanup

- Remove `backend/src/render/route.ts` and `playwrightRender.ts`
- Remove `playwright` dep from backend

## Implementation order

1. Create `render_jobs` migration
2. Create `start-render` edge function
3. Build render-worker (server.ts, playwrightRender.ts, downloadMedia.ts, uploadResult.ts, config.ts)
4. Update package.json + tsup build
5. Create Dockerfile + fly.toml
6. Test locally
7. Deploy to Fly.io
8. Update webapp to use edge function + realtime
9. Clean up backend

## Verification

1. Local: `tsx --env-file=.env src/server.ts` → curl POST /render
2. Docker: `docker build -f render-worker/Dockerfile .`
3. Fly: `fly deploy --config render-worker/fly.toml`
4. E2E: webapp → edge function → worker → TUS upload → webapp downloads

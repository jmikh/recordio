# Render Worker

Headless browser video render service. Receives render jobs via HTTP, runs the same ExportManager pipeline as the webapp inside Playwright Chromium, and uploads the resulting MP4.

## Where it runs

- **Google Cloud Run** (us-east4) with NVIDIA L4 GPU
- Service URL: `https://render-worker-969001955617.us-east4.run.app`
- GCP project: `recordio-484905`
- Scales to zero when idle, ~5s cold start
- See README.md for GPU setup details (Vulkan ICD, Chrome flags, etc.)

## Architecture

```
Edge function (render-sync)
  → POST /render with signed URLs + project JSON
  → Worker responds immediately, renders in background
  → Reports progress via statusCallbackUrl
  → Uploads MP4 via signed uploadUrl
```

The worker has **zero Supabase credentials**. All auth is via `RENDER_SECRET` shared secret and signed URLs.

## Key files

- `src/server.ts` — Fastify HTTP server, `/render` endpoint, background job orchestration
- `src/playwrightRender.ts` — Playwright browser management, route interception for render page, GPU config
- `src/downloadMedia.ts` — Downloads screen/camera/mic from signed URLs to temp dir
- `src/config.ts` — Env validation (PORT, RENDER_SECRET)
- `render-page/` — Vite app loaded inside Playwright that runs ExportManager (shared/ pipeline)

## How rendering works

1. Media files downloaded to temp dir
2. Playwright opens `render-page/` (served via route interception at `localhost:9999`)
3. Media files served by Fastify at `localhost:8080/media/{jobId}/` (NOT route interception)
4. Route interception removed after page load (`page.unrouteAll()`)
5. render-page runs `ExportManager` (from `shared/export/`) using WebCodecs
6. Browser POSTs MP4 to Fastify (`/result/{jobId}`), Node uploads to storage from disk, temp dir cleaned up

## CDP size limit — critical constraint

Playwright communicates with Chrome via a CDP pipe. Large payloads crash with `ERR_STRING_TOO_LONG` (~500MB limit). This affects ALL data flowing through Playwright:
- **Route interception** enables CDP Fetch domain which serializes ALL request/response bodies through the pipe — even requests that don't match any route pattern
- **`page.evaluate`** serializes arguments and return values through the pipe. A `fetch()` inside evaluate still triggers CDP network monitoring if routes are active
- **`page.unrouteAll()`** disables CDP Fetch, but `page.evaluate` itself still uses the pipe for its own protocol messages

The fix is to never let large binaries touch CDP at all:
- **Serving large files to the browser** → Fastify HTTP at `localhost:8080/media/{jobId}/`
- **Getting large files out of the browser** → browser POSTs to Fastify at `localhost:8080/result/{jobId}`, Node uploads from disk

## Build & Deploy

```bash
# Build + push Docker image
docker buildx build --platform linux/amd64 \
  -t us-central1-docker.pkg.dev/recordio-484905/render-worker/render-worker:TAG \
  -f render-worker/Dockerfile --push .

# Deploy to Cloud Run
gcloud run deploy render-worker \
  --image us-central1-docker.pkg.dev/recordio-484905/render-worker/render-worker:TAG \
  --region us-east4 --project recordio-484905 \
  --gpu=1 --gpu-type=nvidia-l4 \
  --concurrency=1 --max-instances=4 \
  --set-secrets="RENDER_SECRET=render-secret:latest" \
  --no-cpu-throttling --cpu=8 --memory=32Gi
```

Docker context is the monorepo root (needs `shared/`, `webapp/public/`).

## Env vars

| Var | Required | Description |
|-----|----------|-------------|
| `RENDER_SECRET` | Yes | Shared secret for auth between edge functions and worker |
| `PORT` | No | Server port (default 8080) |

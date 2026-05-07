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
2. Playwright opens `render-page/` served by Fastify at `localhost:8080/` (NOT route interception)
3. Media files served by Fastify at `localhost:8080/media/{jobId}/`
4. render-page runs `ExportManager` (from `shared/export/`) using WebCodecs
5. Browser POSTs MP4 to Fastify (`/result/{jobId}`), streamed to disk, Node streams upload to storage, temp dir cleaned up

## Progress reporting

| Progress | Milestone |
|----------|-----------|
| 0% | Job received |
| 5% | Media downloaded |
| 10% | First frame processed |
| 10–95% | Frame encoding (linear by frame count) |
| 95% | All frames done, uploading |
| 100% | Upload complete, status `completed` |

Heartbeats send progress immediately on each milestone and every 5s in between. The 5s timer resets on each milestone.

## CDP size limit — critical constraint

Playwright communicates with Chrome via a CDP pipe. Large payloads crash with `ERR_STRING_TOO_LONG` (~500MB limit). This affects ALL data flowing through Playwright:
- **Route interception** enables CDP Fetch domain which serializes ALL request/response bodies through the pipe — even requests that don't match any route pattern
- **`page.evaluate`** serializes arguments and return values through the pipe

**Nothing must be served via Playwright route interception.** All HTTP serving goes through Fastify:
- Render-page static files → Fastify `setNotFoundHandler` (serves from dist at root `/`)
- Media files → Fastify at `/media/{jobId}/`
- Result MP4 from browser → Fastify at `/result/{jobId}`, streamed to disk
- Upload to storage → `fs.createReadStream` (not `readFileSync`)

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


## Knowledge
update this claude.md file concisely if we are making changes to the render pipeline. Previous implementations that had problems that we had to revert so don't reattempt them. Only things that are not super trival.

- **Do NOT use Playwright route interception** — even for render-page static files. It enables CDP Fetch globally which crashes on large payloads. Serve everything via Fastify instead.
- **Do NOT use `page.unrouteAll()` after page load** as a workaround — the render page lazy-loads WASM/JS at runtime that would 404 after routes are removed.
- **Do NOT serve render-page under a subpath** (e.g. `/render-page/`) — WASM files loaded at runtime use absolute paths from root. Serve at `/` via `setNotFoundHandler`.
- **Do NOT use `readFileSync` for large files** — use streaming (`createReadStream`/`pipeline`) for both receiving and uploading MP4s to avoid V8 string length limit.
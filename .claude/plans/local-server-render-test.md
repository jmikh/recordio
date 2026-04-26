# Local Server-Side Rendering Test

## Context

Phase 2 of the server-side rendering plan is complete (nodeRenderContext, ServerFrameExtractor, ServerAudioMixer). Before deploying to Fly.io, we want to test the entire render pipeline locally. This adds a "Server Export (Test)" button in the export modal that renders via the local Fastify backend instead of the browser. **This is temporary test code** — meant to be reverted once cloud rendering is stable.

---

## Plan

### 1. Move `scaleProject` to shared

Extract the pure `scale` + `scalePixelValues` logic from `webapp/src/core/Project.ts` → `shared/utils/projectScale.ts`. Webapp's `ProjectImpl.scale` becomes a thin wrapper. Render-worker can then import it.

**Files:**
- `shared/utils/projectScale.ts` (new)
- `webapp/src/core/Project.ts` (modify — delegate to shared)

### 2. Move `ExportQuality` + `getHeightForQuality` to shared

The trivial quality→height map from `webapp/src/editor/export/codecResolver.ts` needs to be importable from render-worker.

**Files:**
- `shared/utils/exportQuality.ts` (new — just the type + height map)
- `webapp/src/editor/export/codecResolver.ts` (modify — re-export from shared)

### 3. Create `ServerExportPipeline` in render-worker

The main orchestrator that ties together all Phase 2 components. Mirrors ExportManager's `runExport` but server-side.

**Input:** project JSON, quality, media file paths (temp dir), progress callback
**Steps:**
1. Scale project via `scaleProject()`
2. Init `ServerFrameExtractor` per video source (screen, camera)
3. Build `TimeMapper` from output windows
4. Load images (device frame, background) via `nodeRenderContext.loadImage()`
5. Run `mixAudio()` → `audio.aac` in temp dir
6. Spawn FFmpeg encoder: `ffmpeg -f rawvideo -pix_fmt rgba -s WxH -r 30 -i pipe:0 -i audio.aac -c:v libx264 -pix_fmt yuv420p -c:a copy output.mp4`
7. Frame loop — for each frame at 30fps:
   - Map output time → source time (TimeMapper)
   - Extract source frame (ServerFrameExtractor)
   - Create canvas, run painter stack (replicating PlaybackRenderer.render using shared/ painters)
   - Get raw RGBA buffer (`canvas.data()`), pipe to FFmpeg stdin
   - Report progress every 30 frames
8. Close FFmpeg, await completion, dispose extractors

**File:** `render-worker/src/ServerExportPipeline.ts` (new)

### 4. Backend render route

Three endpoints on the existing Fastify server:

**POST `/render/start`** — starts a render job
- Auth via existing `authenticateRequest()`
- Receives `{ projectData, quality }`
- Downloads media from Supabase Storage using service key: `supabase.storage.from('project-media').download(storageUrl)`
- Saves to temp dir with known names (screen.webm, camera.webm, etc.)
- Kicks off `ServerExportPipeline` in background
- Returns `{ jobId }`

**GET `/render/:jobId/events`** — SSE progress stream
- Sets `Content-Type: text/event-stream` headers on `reply.raw`
- Streams `{ progress, phase, status }` events as they occur
- Ends with `status: 'complete'` or `status: 'error'`

**GET `/render/:jobId/download`** — serves completed MP4
- Streams the output file, schedules temp dir cleanup

**Files:**
- `backend/src/render/route.ts` (new — all 3 endpoints)
- `backend/src/render/jobStore.ts` (new — in-memory Map for job state)
- `backend/src/render/mediaDownloader.ts` (new — Supabase Storage download logic)
- `backend/src/index.ts` (modify — register render route)
- `backend/src/config.ts` (modify — add optional `WEBAPP_BASE_URL` for device frame images)
- `backend/tsconfig.json` (modify — add `@shared/*` path alias, include shared + render-worker)
- `backend/package.json` (modify — add `@napi-rs/canvas` dependency)

### 5. Webapp "Server Export (Test)" button

Add button in ExportModal, only visible in dev mode (`import.meta.env.DEV`).

**Handler flow:**
1. Set export state (reuse existing progress UI)
2. Get auth token via `AuthManager.getSession()`
3. POST full project JSON to `/render/start`
4. Stream progress from `/render/:jobId/events` via fetch + ReadableStream (EventSource doesn't support auth headers)
5. On completion, fetch `/render/:jobId/download`, create blob, trigger browser download
6. On error, show toast

**Files:**
- `webapp/src/editor/components/settings/ExportModal.tsx` (modify — add button + handler)

---

## Key design decisions

- **Media download via Supabase service key** — backend calls `supabase.storage.from('project-media').download(path)` directly, no edge functions needed
- **Device frame images** — fetched from webapp dev server URL (e.g., `http://localhost:5173/assets/devices/macbook.png`) via `WEBAPP_BASE_URL` config
- **Painter stack replicated, not imported** — `PlaybackRenderer` lives in webapp and has editor deps. ServerExportPipeline reimplements the render call sequence using direct `@shared/painters/*` imports (~50 lines of orchestration)
- **Auth required** — reuses existing `authenticateRequest()` pattern. For local dev, user must be logged in with an active subscription (same as regular export)
- **In-memory job store** — no database needed for local testing. Jobs auto-cleanup after 30 minutes
- **SSE via raw reply** — Fastify supports SSE by writing to `reply.raw` with event stream headers

---

## Verification

1. Start webapp dev server: `cd webapp && npm run dev`
2. Start backend dev server: `cd backend && npm run dev` (with `.env` containing SUPABASE_URL, SUPABASE_SECRET_KEY, CORS_ORIGIN=http://localhost:5173, WEBAPP_BASE_URL=http://localhost:5173)
3. Open a cloud-synced project in the webapp (needs `storageUrl` on sources)
4. Open export modal → click "Server Export (Test)"
5. Verify: progress updates in the modal, MP4 downloads on completion
6. Compare: visually compare server-rendered frame vs browser-rendered frame for parity

# Local Server-Side Rendering Test

## Context

Phase 2 of the server-side rendering plan is complete (nodeRenderContext, ServerFrameExtractor, ServerAudioMixer). Before deploying to Fly.io, we want to test the entire render pipeline locally. This adds a "Server Export (Test)" button in the export modal that kicks off a render on the local Fastify backend. The rendered MP4 is written to `/tmp/` — no download, no cleanup, no job management. Progress and errors are logged to the backend console. **Temporary test code.**

---

## Plan

### 1. Move `scaleProject` to shared

Extract the pure `scale` + `scalePixelValues` logic from `webapp/src/core/Project.ts` → `shared/utils/projectScale.ts`. Webapp's `ProjectImpl.scale` becomes a thin wrapper.

**Files:**
- `shared/utils/projectScale.ts` (new)
- `webapp/src/core/Project.ts` (modify — delegate to shared)

### 2. Move `ExportQuality` + `getHeightForQuality` to shared

The trivial quality→height map from `webapp/src/editor/export/codecResolver.ts`.

**Files:**
- `shared/utils/exportQuality.ts` (new — just the type + height map)
- `webapp/src/editor/export/codecResolver.ts` (modify — re-export from shared)

### 3. Create `ServerExportPipeline` in render-worker

The orchestrator that ties together all Phase 2 components.

**Input:** project JSON, quality, media file paths, progress callback  
**Steps:**
1. Scale project via `scaleProject()`
2. Init `ServerFrameExtractor` per video source (screen, camera)
3. Build `TimeMapper` from output windows
4. Fetch CDN images (device frames, preset backgrounds) and load via `nodeRenderContext.loadImage()`. Custom backgrounds/music skipped for now.
5. Run `mixAudio()` → `audio.aac`
6. Spawn FFmpeg encoder: reads raw RGBA from stdin + audio file, outputs H.264 MP4
7. Frame loop at 30fps — paint each frame using shared painters, pipe RGBA to FFmpeg
8. Close FFmpeg, dispose extractors

**File:** `render-worker/src/ServerExportPipeline.ts` (new)

### 4. Backend render route

**Single endpoint: POST `/render`**
- Auth via existing `authenticateRequest()`
- Receives `{ projectData, quality }`
- Downloads source media from Supabase Storage using service key → writes to tmp dir
- Runs `ServerExportPipeline` synchronously (long-running request, fine for local testing)
- Logs progress to console (`console.log`)
- On success: responds `{ ok: true, outputPath: '/tmp/render-xxx/output.mp4' }`
- On error: responds `{ ok: false, error: message }`
- Output stays in `/tmp/` — no cleanup, no download serving

**Files:**
- `backend/src/render/route.ts` (new — single POST endpoint)
- `backend/src/index.ts` (modify — register render route)
- `backend/tsconfig.json` (modify — add `@shared/*` path alias, include shared + render-worker)
- `backend/package.json` (modify — add `@napi-rs/canvas` dependency)

### 5. Webapp "Server Export (Test)" button

Add button in ExportModal, only visible in dev mode (`import.meta.env.DEV`).

**Handler:** POST full project JSON to `/render`, show a toast when it returns (success with file path, or error). No progress streaming — just fire and wait.

**Files:**
- `webapp/src/editor/components/settings/ExportModal.tsx` (modify — add button + handler)

---

## Key design decisions

- **No job management** — single synchronous request, progress logged to backend console
- **No download endpoint** — output stays in `/tmp/`, user opens it manually via Finder/terminal
- **No cleanup** — files stay until OS cleans `/tmp/`
- **All public assets on CDN** — device frames, preset backgrounds, preset music at `cdn.recordio.cc/*`. Server fetches by URL directly
- **Custom assets deferred** — custom user-uploaded backgrounds and music won't work yet
- **Painter stack replicated** — ServerExportPipeline reimplements PlaybackRenderer's render call sequence using direct `@shared/painters/*` imports

---

## Verification

1. `cd webapp && npm run dev`
2. `cd backend && npm run dev`
3. Open a cloud-synced project → export modal → "Server Export (Test)"
4. Watch backend console for frame-by-frame progress
5. Open `/tmp/render-xxx/output.mp4` and compare visually with browser export

# Server-Side Video Rendering

## Context

Video export currently runs entirely in the browser using WebCodecs + OffscreenCanvas. A 5-minute video takes 5 minutes to render, the browser must stay open the whole time, and the tab can lose resources (codec reclaim). Moving rendering to the server eliminates all of these UX problems — user clicks "Export", closes the tab, gets notified when it's done.

**Key insight:** the existing painter stack in `webapp/src/core/painters/` already accepts a `RenderContext` abstraction ([renderContext.ts](webapp/src/core/renderContext.ts)) designed for exactly this — it separates canvas operations so they can run in Node.js. The rendering logic is largely reusable; what needs replacing are the browser-only APIs (WebCodecs, OfflineAudioContext).

---

## Architecture

```
Client (webapp)                    Supabase                         Fly.io
───────────────                    ────────                         ──────

1. Insert render_jobs row ──────→  render_jobs table
   { projectId, quality }          (status: 'pending')
                                        │
2. Call render-dispatch ────────→  Supabase Edge Function
                                        │
                                   Calls Fly Machines API:
                                   "Create machine with JOB_ID=xyz"
                                        │
                                        ▼
                                   Fly Machine boots (~1-2s)
                                   ┌─────────────────────────────┐
                                   │ 1. Read job from Supabase   │
                                   │ 2. Download media            │
                                   │ 3. FFmpeg decode → frames    │
                                   │ 4. Canvas paint each frame   │
                                   │ 5. FFmpeg encode → MP4       │
                                   │ 6. Upload to Supabase Storage│
                                   │ 7. If published → CF Stream  │
                                   │ 8. Update job → 'complete'   │
                                   │ 9. Exit (machine destroyed)  │
                                   └─────────────────────────────┘
                                        │
3. Supabase Realtime ←─────────────────┘  (live progress updates)
```

### Key properties
- **One machine per render** — zero contention, every user gets dedicated 4 vCPU
- **Ephemeral** — machine boots, renders, exits. Pay only for render time (~$0.03/render)
- **No polling loop** — Fastify explicitly creates a machine per job, no queue polling needed
- **Output always lands in Supabase Storage first**, then optionally Cloudflare Stream
- **Client gets live progress** via Supabase Realtime (push, no polling)

### Role of each service
- **Railway (Fastify, unchanged)** — Existing `/transcribe` route only. No changes.
- **Supabase** — job table, media storage, auth (RLS), realtime progress, **new `render-dispatch` Edge Function** (consistent with existing `upload-to-stream`, `confirm-upload` pattern)
- **Fly.io (render only, new)** — Ephemeral machines for render compute. No persistent machines, no always-on cost. One machine created per job, auto-destroyed on exit.
- **Cloudflare** — published video streaming (unchanged)

---

## Phase 1 — Shared rendering core (move painters to `shared/`)

The painters and their dependencies currently live in `webapp/src/core/`. To reuse them on the server without importing from webapp, extract the rendering core into the `shared/` package.

`shared/` already has `types/`, `components/`, `theme/`, `assets/`. We add organized rendering subdirectories:

```
shared/
├── types/            ← existing (core.ts, events.ts, bridge.ts)
├── components/       ← existing
├── theme/            ← existing
├── assets/           ← existing
├── painters/         ← NEW: all painters
│   ├── backgroundPainter.ts
│   ├── screenPainter.ts
│   ├── cameraPainter.ts
│   ├── mouseClickPainter.ts
│   ├── mouseDragPainter.ts
│   ├── keyboardPainter.ts
│   ├── captionPainter.ts
│   ├── spotlightPainter.ts
│   ├── overlayPainter.ts
│   ├── smartFramePainter.ts
│   └── utils/
│       └── roundRect.ts
├── animators/        ← NEW: zoom, spotlight, camera animation logic
│   ├── zoomAnimator.ts
│   ├── cameraAnimator.ts
│   ├── spotlightAnimator.ts
│   └── easing.ts
├── mappers/          ← NEW: time/view mapping
│   ├── timeMapper.ts
│   ├── timeMapper.test.ts
│   ├── viewMapper.ts
│   ├── viewMapper.test.ts
│   └── displayMapper.ts
└── utils/            ← NEW: shared rendering utilities
    ├── renderContext.ts   (RenderContext / CanvasHandle interfaces)
    ├── geometry.ts
    ├── aspectRatio.ts
    ├── captionUtils.ts
    └── deviceFrames.ts
```

**What stays in webapp (browser-specific):**
- `PlaybackRenderer.ts` (has editor/store dependencies — server gets its own orchestrator)
- `ExportManager.ts` (browser WebCodecs pipeline — stays for client-side fallback)
- `FrameExtractor.ts` (WebCodecs-specific)
- `browserRenderContext` (uses `OffscreenCanvas` / `Image`)
- `zoom/autoZoom.ts`, `zoom/hoverDetector.ts`, `zoom/focusManager.ts` (editor-specific, depend on UI state)
- `spotlight/autoSpotlight.ts` (editor-specific)
- `autocut/` (editor-specific)
- `transcription/` (editor-specific, uses workers)
- `analytics/` (editor-specific)

**Webapp re-exports these from `shared/`** — no behavior change client-side.

---

## Phase 2 — Node.js render context + FFmpeg frame pipeline

### 2a. `nodeRenderContext`

Implements `RenderContext` using `@napi-rs/canvas` (Rust-based, fast):

**File:** `render-worker/src/nodeRenderContext.ts`

```ts
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { RenderContext } from 'shared/renderContext';

export const nodeRenderContext: RenderContext = {
  createCanvas(w, h) {
    const canvas = createCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d') };
  },
  async loadImage(src) {
    return loadImage(src);
  },
};
```

### 2b. `ServerFrameExtractor` — FFmpeg-based frame decoding

Replaces the WebCodecs `FrameExtractor`. Uses FFmpeg to decode source video frames.

**Approach:** Spawn FFmpeg to decode the full source video, outputting raw RGBA frames via pipe. Buffer frames indexed by frame number. TimeMapper maps output time → source time → source frame number.

```
ffmpeg -i input.mp4 -f rawvideo -pix_fmt rgba pipe:1
```

For long videos, use a streaming approach: decode on-demand with `-ss` seeking to avoid loading everything into memory.

**File:** `render-worker/src/ServerFrameExtractor.ts`

### 2c. `ServerAudioMixer` — FFmpeg-based audio mixing

Replaces `OfflineAudioContext` + SoundTouch.js. FFmpeg natively handles:
- Mixing multiple audio tracks (screen audio, mic, background music)
- Time-stretching with `atempo` filter (pitch-preserving)
- Trimming segments based on TimeMapper cuts
- Encoding to AAC

Build an FFmpeg filter graph: inputs → `atrim`/`atempo` → `amix` → AAC output.

**File:** `render-worker/src/ServerAudioMixer.ts`

---

## Phase 3 — Server export pipeline

### `ServerExportPipeline` — orchestrates the full render

**File:** `render-worker/src/ServerExportPipeline.ts`

1. **Resolve project** — Fetch `project_data` JSONB from Supabase DB
2. **Download media** — Signed URLs from Supabase Storage → temp dir
3. **Build TimeMapper** — Same pure logic as client
4. **Decode frames** — `ServerFrameExtractor` extracts source frames via FFmpeg
5. **Frame render loop** (30fps) — For each output frame:
   - Map output time → source time via TimeMapper
   - Get decoded source frame
   - Create output canvas via `nodeRenderContext`
   - Run painter stack: background → screen → mouse → camera → keyboard → captions → overlay → spotlight
   - Pipe rendered frame (raw RGBA) to FFmpeg encoder
6. **Audio** — `ServerAudioMixer` produces audio in parallel
7. **Mux** — FFmpeg combines video + audio → MP4
8. **Upload** — Push MP4 to Supabase Storage `rendered-videos` bucket
9. **Publish** — If project is published, also push to Cloudflare Stream

**Progress:** Update `render_jobs.progress` (0-100) periodically as frames complete. Client sees updates via Supabase Realtime.

---

## Phase 4 — Job queue + dispatch

### `render_jobs` table (Supabase)

```sql
create table render_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) not null,
  user_id uuid references auth.users(id) not null,
  quality text not null,  -- '480p', '720p', '1080p', '2k', '4k'
  status text not null default 'pending',  -- pending | processing | complete | failed
  progress int default 0,  -- 0-100
  fly_machine_id text,  -- track which machine is running this job
  output_path text,  -- Supabase Storage path when complete
  error text,
  retry_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: users see only their own jobs
alter table render_jobs enable row level security;
create policy "Users see own jobs" on render_jobs
  for all using (auth.uid() = user_id);
```

### Dispatch Edge Function (Supabase)

**File:** `webapp/supabase/functions/render-dispatch/index.ts`

Same pattern as existing `upload-to-stream` and `confirm-upload` Edge Functions.

```ts
// 1. Auth is automatic (Supabase passes JWT)
// 2. Read job from DB, verify status = 'pending' and belongs to user
// 3. Atomically set status = 'processing' (WHERE status = 'pending' guard)
// 4. Call Fly Machines API to create a machine:
//    - Image: render-worker Docker image
//    - Size: performance-4x (4 vCPU, 8GB RAM)
//    - Env: JOB_ID, SUPABASE_URL, SUPABASE_SECRET_KEY
//    - Auto-destroy: on exit
// 5. Store fly_machine_id on the job row
```


### Render worker entry point

**File:** `render-worker/src/index.ts`

```ts
// This runs inside the Fly Machine
const jobId = process.env.JOB_ID;
// 1. Fetch job from Supabase
// 2. Run ServerExportPipeline
// 3. Update job status → 'complete'
// 4. Process exits → Fly auto-destroys machine
```

No polling loop. No queue claiming. The machine boots, does one job, exits.

---

## Phase 5 — Client integration (API only, no UI changes)

### `ServerExportService`

**File:** `webapp/src/editor/services/ServerExportService.ts`

- `startServerExport(projectId, quality)`:
  1. Insert into `render_jobs` via Supabase client
  2. Call `render-dispatch` Edge Function with the job ID
- `subscribeToProgress(jobId, callback)` → Supabase Realtime subscription on the job row
- `getOutputUrl(jobId)` → Fetch `output_path`, generate signed download URL

---

## Render worker package

New package in the monorepo: `render-worker/`

```
render-worker/
├── Dockerfile          ← Node.js + FFmpeg, deployed to Fly.io registry
├── package.json
├── src/
│   ├── index.ts                  ← Entry point: read JOB_ID, run pipeline, exit
│   ├── nodeRenderContext.ts      ← @napi-rs/canvas implementation
│   ├── ServerFrameExtractor.ts   ← FFmpeg frame decoding
│   ├── ServerAudioMixer.ts       ← FFmpeg audio mixing
│   └── ServerExportPipeline.ts   ← Orchestrator
└── fly.toml            ← Fly app config (no persistent machines, API-only creation)
```

### Dockerfile

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
CMD ["node", "dist/index.js"]
```

---

## New dependencies

| Package | Where | Purpose |
|---------|-------|---------|
| `@napi-rs/canvas` | render-worker | Node.js canvas rendering (Rust-based, fast) |
| `fluent-ffmpeg` | render-worker | FFmpeg process management |
| `@fly-sdk/api` | Supabase Edge Fn | Fly Machines API client (to create/stop machines) |

**System requirement:** FFmpeg in the render-worker Docker image.

---

## Cost

| Scenario | Cost |
|----------|------|
| Single 5-min video render (4 vCPU, ~3 min) | ~$0.03 |
| 50 renders/day | ~$1.50/day, ~$45/mo |
| 3 concurrent renders | 3 machines, each $0.03, zero contention |
| Idle | $0 (no machines running) |

---

## Implementation order

1. **Phase 1** — Extract painters to `shared/` (lowest risk, unblocks everything)
2. **Phase 2a** — `nodeRenderContext` (small, testable in isolation)
3. **Phase 2b** — `ServerFrameExtractor` (test with sample video)
4. **Phase 2c** — `ServerAudioMixer`
5. **Phase 3** — `ServerExportPipeline` (integrate all pieces, test locally)
6. **Phase 4** — `render_jobs` table + `render-dispatch` Edge Function + Dockerfile
7. **Phase 5** — Client `ServerExportService`

---

## Verification

1. **Painter parity:** Render a single frame server-side vs client-side, compare output visually
2. **Pipeline test:** Feed a real project through `ServerExportPipeline` locally, verify MP4 plays and matches client export
3. **Fly test:** Deploy Docker image to Fly, create a machine via API, confirm it renders and uploads
4. **E2E test:** Client inserts job → dispatches → Fly machine renders → Supabase Realtime delivers progress → output appears in Storage
5. **Regression:** Verify client-side export still works (painters now imported from `shared/`)

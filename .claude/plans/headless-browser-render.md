# Headless Browser Server Rendering

## Context

The FFmpeg pipe approach for server-side rendering is unworkably slow (30+ seconds per frame due to raw RGBA pipe I/O). The browser export pipeline (`ExportManager`) does the same job in ~2 seconds using WebCodecs. Instead of reimplementing, we run the exact same browser pipeline in headless Chromium via Playwright. The render page is a self-contained HTML page served by the backend — not part of the webapp.

---

## Architecture

```
Backend (Fastify :3001)
  1. POST /render → auth, fetch storage paths from Supabase
  2. Download media files → /tmp/recordio-render-XXX/
  3. Serve /tmp/ dir at /render-media/* (static files)
  4. Serve render page at /render-page (static HTML+JS bundle)
  5. Launch Playwright → navigate to localhost:3001/render-page
  6. Inject job config via window.__RENDER_JOB__
  7. Wait for window.__RENDER_DONE__
  8. Extract MP4 ArrayBuffer → write to /tmp/
  9. Close browser, return path

Render Page (self-contained HTML)
  - Reads window.__RENDER_JOB__ = { project, quality, mediaBaseUrl }
  - project.screenSource.runtimeUrl → mediaBaseUrl/screen.webm (already downloaded)
  - Runs ExportManager.exportProject() (WebCodecs, zero-copy, fast)
  - Stores result blob → window.__RENDER_RESULT__ (ArrayBuffer)
  - Simple debug UI: status, progress, errors
```

**The page does NO network I/O** — no Supabase, no auth, no downloads, no uploads. It's a pure render engine. All media is pre-downloaded by the backend and served as local static files.

---

## Plan

### 1. Build the render page bundle

**New: `render-worker/render-page/`**

A small Vite project that bundles ExportManager and its deps into a single HTML page.

- `render-worker/render-page/index.html` — minimal HTML shell with `<div id="root">` and debug UI
- `render-worker/render-page/main.ts` — entry point:
  - Reads `window.__RENDER_JOB__` (`{ project, quality, mediaBaseUrl }`)
  - Patches `runtimeUrl` on each source to point at `mediaBaseUrl + filename`
  - Runs `new ExportManager().exportProject(project, quality, onProgress, { skipDownload: true })`
  - Writes result: `window.__RENDER_RESULT__ = await blob.arrayBuffer()`
  - Sets `window.__RENDER_DONE__ = true` (or `window.__RENDER_ERROR__` on failure)
  - Updates debug UI with progress/status
- `render-worker/render-page/vite.config.ts` — builds to `render-worker/render-page/dist/`
  - Resolves `@shared/*` paths (same as webapp)
  - Bundles ExportManager, FrameExtractor, PlaybackRenderer, shared painters, browserRenderContext

**Key reuse**: Imports directly from `webapp/src/editor/export/ExportManager.ts`, `webapp/src/core/renderContext.ts`, shared painters. No reimplementation.

### 2. Backend serves render page + media

**Modify: `backend/src/render/route.ts`**

- Register static route `/render-media/*` → serves the current job's `/tmp/` dir
- Register static route `/render-page` → serves `render-worker/render-page/dist/index.html`

**New: `backend/src/render/playwrightRender.ts`**

```ts
export async function renderViaPlaywright(opts: {
    project: Project;
    quality: ExportQuality;
    mediaDir: string;
    mediaBaseUrl: string;  // http://localhost:3001/render-media/
    onProgress: (phase: string, progress: number, msg: string) => void;
}): Promise<{ outputPath: string; durationMs: number }>
```

Steps:
1. Launch Playwright Chromium (headless, WebCodecs-capable)
2. `page.addInitScript()` → set `window.__RENDER_JOB__`
3. Navigate to `http://localhost:3001/render-page`
4. `page.waitForFunction('window.__RENDER_DONE__', { timeout: 300_000 })`
5. Check `window.__RENDER_ERROR__` — throw if set
6. Extract `window.__RENDER_RESULT__` (ArrayBuffer) via `page.evaluate()`
7. Write to `mediaDir/output.mp4`
8. Close browser, return result

### 3. Update render route

**Modify: `backend/src/render/route.ts`**

- Swap `renderProject()` call → `renderViaPlaywright()`
- Keep: auth, Supabase query for storage paths, media download to `/tmp/`
- Add: register/unregister static file serving for the job's media dir

### 4. Dependencies

**`backend/package.json`**: Add `playwright` (or `playwright-core`)
**`render-worker/render-page/package.json`**: Vite + deps needed to bundle ExportManager
**Setup**: `npx playwright install chromium`

---

## Files

| File | Action |
|------|--------|
| `render-worker/render-page/index.html` | Create — HTML shell |
| `render-worker/render-page/main.ts` | Create — render entry point |
| `render-worker/render-page/vite.config.ts` | Create — bundle config |
| `render-worker/render-page/package.json` | Create — deps |
| `backend/src/render/playwrightRender.ts` | Create — Playwright orchestrator |
| `backend/src/render/route.ts` | Modify — swap to Playwright, add static serving |
| `backend/package.json` | Modify — add playwright dep |

## What becomes unused

ServerExportPipeline, ServerFrameExtractor, ServerAudioMixer, nodeRenderContext, `@napi-rs/canvas` — leave in place, don't delete until proven.

## Verification

1. `cd render-worker/render-page && npm run build` (produces dist/)
2. `cd backend && npm run dev`
3. `cd webapp && npm run dev` (not strictly needed — render page is self-contained)
4. Open project → Export modal → "Server Export (Test)"
5. Backend console shows Playwright progress
6. Open output MP4 from `/tmp/`
7. Debug: open `localhost:3001/render-page` directly in Chrome, set `window.__RENDER_JOB__` in console

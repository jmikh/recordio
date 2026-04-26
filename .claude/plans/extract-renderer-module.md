# Phase 1: Make Rendering Code Browser-Agnostic

## Context

The painting/compositing code in `webapp/src/core/painters/` is tightly coupled to browser DOM APIs (`document.createElement`, `new OffscreenCanvas`, `new Image()`, `ctx.roundRect()`, `ctx.filter`). This plan removes those direct dependencies so the same code can later run on a Node.js server (via node-canvas + FFmpeg) for faster video export. No files move — all changes are in place.

---

## What Changes

### 1. RenderContext interface

New file: `webapp/src/core/renderContext.ts`

```ts
export interface RenderContext {
  createCanvas(width: number, height: number): CanvasHandle;
  loadImage(src: string): Promise<CanvasImageSource>;
}

export interface CanvasHandle {
  canvas: CanvasImageSource & { width: number; height: number };
  ctx: CanvasRenderingContext2D;
}

export type VideoSource = CanvasImageSource;
```

Browser implementation (same file or adjacent):
```ts
export const browserRenderContext: RenderContext = {
  createCanvas(w, h) {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d')! };
  },
  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  },
};
```

---

### 2. Replace `ctx.roundRect()` — 7 painters

`spotlightPainter.ts` already has a `drawRoundedRectPathMultiRadius` function that uses `arcTo` (works everywhere). Extract it to `webapp/src/core/painters/utils/roundRect.ts` and replace all `ctx.roundRect()` calls:

| File | Lines |
|------|-------|
| [cameraPainter.ts](webapp/src/core/painters/cameraPainter.ts#L113) | `ctx.roundRect` in `definePath` |
| [captionPainter.ts](webapp/src/core/painters/captionPainter.ts#L134) | caption background box |
| [keyboardPainter.ts](webapp/src/core/painters/keyboardPainter.ts#L131) | hotkey overlay (has typeof guard already) |
| [overlayPainter.ts](webapp/src/core/painters/overlayPainter.ts#L121) | blur region, border, text bg (~4 call sites) |
| [screenPainter.ts](webapp/src/core/painters/screenPainter.ts#L24) | screen clip path |
| [spotlightPainter.ts](webapp/src/core/painters/spotlightPainter.ts#L137) | spotlight region (already has fallback inline) |
| [toolbarPainter.ts](webapp/src/core/painters/toolbarPainter.ts#L208) | toolbar background |

---

### 3. Inject RenderContext into 4 painters

**[cameraPainter.ts](webapp/src/core/painters/cameraPainter.ts)** — `document.createElement('canvas')` (lines 174, 219)
- Feather effect cached offscreen canvases
- Add `renderCtx: RenderContext` param to `drawCamera`
- Replace `document.createElement('canvas')` → `renderCtx.createCanvas(w, h)`
- Module-level cache vars become `CanvasHandle | null`

**[spotlightPainter.ts](webapp/src/core/painters/spotlightPainter.ts)** — `new OffscreenCanvas(sw, sh)` (line 78)
- Snapshot cache canvas
- Add `renderCtx: RenderContext` param to `drawSpotlight`
- Replace `new OffscreenCanvas()` → `renderCtx.createCanvas(sw, sh)`

**[backgroundPainter.ts](webapp/src/core/painters/backgroundPainter.ts)** — `new OffscreenCanvas(1,1)` (line 7)
- Module-level color validation context
- Add `renderCtx: RenderContext` param to `drawBackground`
- Lazy-init via `renderCtx.createCanvas(1, 1)` on first call

**[toolbarPainter.ts](webapp/src/core/painters/toolbarPainter.ts)** — `new Image()` (lines 63, 78)
- SVG icon lazy loading
- Pre-load icons via `renderCtx.loadImage()` during init
- Pass loaded images as param to `drawToolbar` instead of lazy internal loading

---

### 4. Strip audio side-effects from PlaybackRenderer

[PlaybackRenderer.ts](webapp/src/editor/components/canvas/PlaybackRenderer.ts) currently calls `playClickSounds`, `playDragSounds` (lines 100-101) — these are browser-only audio APIs that don't belong in the rendering pipeline.

Move these calls to the webapp's canvas component that invokes `PlaybackRenderer.render()`. The renderer becomes pure painting — no audio.

---

### 5. Widen types in PlaybackRenderer

[PlaybackRenderer.ts](webapp/src/editor/components/canvas/PlaybackRenderer.ts) `RenderResources` interface:

```ts
// Before
export type VideoSource = HTMLVideoElement | VideoFrame;
export interface RenderResources {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bgRef: HTMLImageElement | null;
  videoRefs: { [sourceId: string]: VideoSource };
  deviceFrameImg: HTMLImageElement | null;
}

// After
export interface RenderResources {
  ctx: CanvasRenderingContext2D;
  renderCtx: RenderContext;
  bgRef: CanvasImageSource | null;
  videoRefs: { [sourceId: string]: CanvasImageSource };
  deviceFrameImg: CanvasImageSource | null;
  sourceCanvas?: CanvasImageSource;  // for spotlight snapshot
}
```

`RenderContext` flows through `PlaybackRenderer.render()` → individual painter calls.

---

### 6. `ctx.filter = 'blur(...)'` — deferred to Phase 2

[backgroundPainter.ts](webapp/src/core/painters/backgroundPainter.ts) and [overlayPainter.ts](webapp/src/core/painters/overlayPainter.ts) use `ctx.filter = 'blur(...)'` which node-canvas doesn't support. This stays as-is — it works in the browser. Phase 2 introduces a software blur fallback (stackblur-canvas) behind the RenderContext when server-side rendering is implemented.

---

## What Does NOT Change

- No files move between directories
- No new modules, packages, or path aliases
- All types stay where they are (`webapp/src/types/`, `shared/types/`)
- Extension is unaffected (never imports painter code)
- `core/zoom/`, `core/spotlight/`, `core/mappers/` — unchanged except their painters now accept `RenderContext`
- All existing imports across the webapp remain valid

---

## Implementation Order

1. Create `RenderContext` interface + browser implementation in `webapp/src/core/renderContext.ts`
2. Extract `roundRect` utility from spotlightPainter → `webapp/src/core/painters/utils/roundRect.ts`
3. Replace all `ctx.roundRect()` calls across 7 painters
4. Inject `RenderContext` into cameraPainter, spotlightPainter, backgroundPainter, toolbarPainter
5. Update `PlaybackRenderer` — widen types, add `RenderContext` to `RenderResources`, strip audio
6. Update callers of `PlaybackRenderer.render()` to pass `browserRenderContext` and handle audio separately
7. Update `ExportManager.ts` to pass `browserRenderContext`

---

## Verification

1. `npm run build:webapp` compiles cleanly
2. `grep -rn 'document\.createElement\|new Image(\|new OffscreenCanvas' webapp/src/core/painters/ --include='*.ts'` → 0 hits
3. Dev server �� editor playback renders identically
4. Export a short video end-to-end

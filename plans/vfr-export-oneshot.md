# Variable frame rate (VFR) export — oneshot plan

## Context

Local export (`shared/export/ExportManager.ts`) samples the timeline on a fixed 30 fps grid and draws + encodes every slot. Profiling a 224 s project (6,731 frames, source 1920×992 VP9) showed:

| Output | ms/frame | Whole export | Share spent in encode stage (`backpressure=`) |
|---|---|---|---|
| 4K | ~15.9 | ~107 s | ~96% |
| 1080p | ~4.2 | ~28 s | ~90% |

Decode (~0.15 ms/frame) and canvas draw calls (~0.5 ms/frame) are negligible. The cost is per encoded frame, so the lever is encoding fewer frames.

Recordings are already VFR: Chrome tab capture only emits frames when the tab repaints (`extension/src/shared/videoRecorder.ts:498-500`). The sample project has 3,623 source frames over 226 s, and some 5 s stretches contain only 22 new frames. Frame-diffing the exported 4K file showed ~59% of output frames are near-identical to the previous one. Nothing needs to change in the extension; the export just doesn't exploit the VFR input.

**Goal:** "variable in, variable out". Don't draw or encode an output frame when nothing visible changed since the last encoded frame; let the previous frame last longer instead. Behind a toggle; constant frame rate (CFR) stays the default.

## Key facts this design relies on

- **Every animator and painter is a pure function of output time** plus segment data, user events, the viewport and the current source frames. No painter reads the previous frame or keeps incremental state; module-level caches (`spotlightPainter`, `cameraPainter`, `overlayPainter` scratch canvases) are fully cleared on each use. Skipping `render()` calls is safe.
- **mp4-muxer derives each sample's duration from the gap to the next sample's timestamp** (`node_modules/mp4-muxer/build/mp4-muxer.mjs` `addSampleToTrack_fn`, ~L1675-1692). Only the last sample uses its own `duration`. So skipped frames need no muxer changes.
- **Nothing animates during a hold.** Every effect is a transition window (zoom, spotlight, camera layout), a fixed-length event window (click 500 ms, keyboard 1500 ms with fade from 1000 ms, drag + 80 ms lag), or a step change (caption segment/word, overlay segment, toolbar URL).
- **Two wall-clock dependencies** would otherwise get "frozen" into a held frame:
  - Toolbar logo/puzzle icons load lazily on first draw (`toolbarPainter.ts:60-80`).
  - Web fonts (`Satoshi` for captions, `Inter` for keyboard, overlay text fonts) may finish loading mid-export.

## Design

### 1. Frame signature (change detection)

Before drawing output frame *i*, compute a **signature**: a compact serialization of everything that determines its pixels. If it equals the signature of the last encoded frame, skip the frame.

New module `shared/export/frameSignature.ts`:

```ts
computeFrameSignature({ project, userEvents, timeMapper, currentTimeMs, frameRefs }): string
```

Components (only those whose layer is enabled and drawable):

| Layer | Signature part | Source of truth |
|---|---|---|
| Screen video | screen `VideoFrame.timestamp` | frame from extractor |
| Viewport | rect `x,y,w,h` | `getViewportStateAtTime` (zoomAnimator) |
| Spotlight | full state (phase, progress, dimOpacity, scale, rects) or `null` | `getSpotlightStateAtTime` (needs ViewMapper, see below) |
| Camera | resolved `x,y,w,h,shape,radius,opacity`; plus camera `VideoFrame.timestamp` **only when opacity > 0** | `getResolvedCameraStateAtTime` |
| Clicks | `[(index, elapsedMs)]` of active clicks | new `getActiveClicks()` |
| Drags | `[(index, laggedX, laggedY)]` | new `getActiveDrags()` |
| Keyboard | `(eventIndex, opacity)` or `null` | new `getKeyboardOverlayState()` |
| Captions | `(segmentId, highlightUpToIndex)` or `null` | new `getActiveCaption()` |
| Overlays | active segment ids | new `getActiveOverlaySegments()` |
| Toolbar | address text (only when the toolbar is drawn) | `getUrlAtTime` |

Static-for-the-whole-export inputs (background, device frame, settings, output size) are not part of the signature.

**Single source of truth:** each "new" helper above is extracted from its painter, and the painter is changed to call it. Drawing and signature then share the exact same timing logic (windows, inclusive/exclusive ends, constants, source→output mapping). No timing constants are duplicated in the signature module.

- `mouseClickPainter.ts`: extract `getActiveClicks(clicks, t, timeMapper)` from `paintMouseClicks` (88-114).
- `mouseDragPainter.ts`: extract `getActiveDrags(userEvents, t, timeMapper)` (window + lagged position) from `drawDragEffects` (48-110).
- `keyboardPainter.ts`: extract `getKeyboardOverlayState(events, t, timeMapper)` (latest active event + opacity) from `drawKeyboardOverlay` (35-64).
- `captionPainter.ts`: extract `getActiveCaption(segments, settings, t)` (segment + `highlightUpToIndex`) from `drawCaptions` (57-104).
- `overlayPainter.ts`: extract `getActiveOverlaySegments(segments, t)` from `drawOverlays` (89-101).
- `screenPainter.ts`: extract `createScreenViewMapper(project, inputSize)` (the ViewMapper construction at 70-85) and `getToolbarAddressText(...)` (126-133 / 222-229, duplicated today — dedupe while extracting).

These are refactors with no behavior change. Existing painter tests (e.g. `overlayPainter.test.ts`) must keep passing.

Why a signature instead of precomputed "busy ranges": it automatically handles the frame right after an effect ends (the signature changes when a ripple drops out of the active list), it lets holds inside long windows be skipped (keyboard label held for 1 s, caption between word changes), and it needs no knowledge of inclusive/exclusive window ends.

### 2. Frame loop changes (`ExportManager.ts`)

New export option (in the `options` param of `exportProject`): `frameRateMode: 'constant' | 'variable'` (default `'constant'`) and `verifySkippedFrames?: boolean`.

Per output frame *i*, in VFR mode:

1. Decode as today: `getFrameAtTime` is still called for every slot. It's cheap, keeps the extractor's sequential access pattern, and gives frame identity.
2. Compute the signature.
3. **Encode** if any of:
   - `i === 0` or `i === totalFrames - 1` (the first frame, and the last frame, whose own `duration` ends the track),
   - signature differs from the last encoded frame's,
   - `currentTimeMs - lastEncodedTimeMs >= MAX_FRAME_HOLD_MS` (1000 ms safety cap, so no frame lasts longer than 1 s: better player/editor behavior and limits damage from a missed change).
4. **When encoding a frame whose signature is unchanged** (cap or last frame): don't redraw. The canvas still holds the last drawn image, so create the `VideoFrame` from it directly.
5. **When skipping:** close the decoded frame refs and continue. No `clearRect`, no draw, no encode, no backpressure wait.

**Keyframes** switch from frame index (`i % 60 === 0`) to time: force a keyframe on the first encoded frame where `currentTimeMs - lastKeyframeTimeMs >= 2000`. With the 1 s cap, keyframes are at most ~3 s apart.

**Timestamps** stay `i * (1e6 / fps)`, so encoded frames remain on the 30 fps grid. The encoder config keeps `framerate: 30` as a hint.

CFR mode follows exactly today's path. The signature isn't computed, so CFR has no overhead.

### 3. Remove wall-clock dependencies (applies to both modes)

- `toolbarPainter.ts`: export `preloadToolbarIcons(renderCtx): Promise<void>`. `ExportManager`'s concurrent setup awaits it when the toolbar is enabled.
- Fonts: before the frame loop, `await document.fonts.load(...)` for each family the project draws (caption font, keyboard font, overlay text `fontFamily`s). Guard for contexts without `document.fonts`.

This also fixes a small existing CFR glitch: the first frames of an export can be drawn without toolbar icons or with a fallback font.

### 4. Verify mode (debug safety net)

When `verifySkippedFrames` is on, every frame that VFR would skip is still drawn. Its pixels (`getImageData`) are compared with the pixels of the last encoded frame. On mismatch, log `[Export:VFR] MISMATCH t=…ms diffPixels=N` with the current signature parts, so the missing component is obvious. The output file is still produced exactly as in VFR mode. Verify mode is slow (full-canvas readback per frame); use it at 1080p.

### 5. Logging

- Per-batch line gains `encoded=X/150`.
- `PlaybackRenderer.flushProfile` is passed the number of frames actually rendered, so its label stays correct.
- End-of-export summary: `[Export] VFR: encoded X/Y frames (Z% skipped), longest hold N ms, verify mismatches M`.

### 6. Toggle

- `useUIStore`: `vfrExport: boolean` (default false) and `vfrVerify: boolean`, with toggles in `DebugBar.tsx` next to the existing debug toggles.
- `DownloadModal` → `useLocalRender` → `exportProject(..., { skipDownload, frameRateMode, verifySkippedFrames })`.
- Cloud render is unchanged (see Out of scope).

## Implementation steps

1. **Extract painter helpers**: `getActiveClicks`, `getActiveDrags`, `getKeyboardOverlayState`, `getActiveCaption`, `getActiveOverlaySegments`, `createScreenViewMapper`, `getToolbarAddressText`. Painters call them. No behavior change; run the existing tests.
2. **`frameSignature.ts`** + unit tests (`frameSignature.test.ts`) on a small fixture project:
   - equal signatures for two times inside a zoom hold;
   - different at every frame inside a click window, and at the first frame after it ends vs the last frame inside;
   - keyboard: equal during the 0–1000 ms hold, different during the fade;
   - caption: changes at word starts only;
   - camera: frame timestamp ignored while a hidden block holds at opacity 0;
   - toolbar URL change → different.
3. **Preload toolbar icons and fonts** in setup.
4. **Frame loop**: `frameRateMode` option, skip logic, last/first/cap encodes, time-based keyframes, logging, verify mode.
5. **Toggles**: UI store + DebugBar + plumbing through `DownloadModal` / `useLocalRender`.
6. **Verify** (see below).

## Verification

On the 224 s "Prospect" project and on a feature-heavy project (clicks, keyboard, captions, overlays, spotlight, zooms, camera with a hidden block):

- **Verify mode:** 0 mismatches.
- **CFR vs VFR output:** export both at 1080p.
  - Resample VFR to 30 fps and compute per-frame PSNR against CFR:
    `ffmpeg -i cfr.mp4 -i vfr.mp4 -lavfi "[1:v]fps=30[v];[0:v][v]psnr=stats_file=psnr.log" -f null -`.
    Expect uniform values at encoder-noise level, with no dips around effects.
  - Durations match (`ffprobe`), and audio is in sync at the end.
- **Playback:** Chrome, QuickTime, VLC. Seek across long holds.
- **Upload:** once through the share flow (Mux ingest).
- **Bitrate/quality:** check the frame right after a long hold isn't visibly degraded. Encoder rate control with `bitrateMode: 'constant'` + `framerate: 30` hint, fed VFR input.
- **Speed:** compare total time and skip % against the CFR baseline above.

## Risks

- **A missed time dependence** shows a stale frame for ≤ 1 s (cap). Mitigations: single-source helpers, unit tests, verify mode.
- **Rate control:** VideoToolbox / OpenH264 behavior with VFR input under `constant` bitrate is untested. Check in verification.
- **Editing apps:** some (e.g. Premiere) handle VFR MP4 poorly, so CFR must remain available. The default is a product decision.
- **Little or no gain:** when the camera is visible, the camera frame changes almost every frame, so little is skipped.

## Out of scope

- **Cloud render:** pass `frameRateMode` through the render job (`render-worker/src/playwrightRender.ts` `__RENDER_JOB__`, `render-page/main.ts`) after local validation. Needs a render-worker deploy.
- **Product:** default mode, user-facing option/messaging (e.g. "constant frame rate for editing apps"), `estimateLocalTime` in `DownloadModal`, and export-resolution defaults based on source resolution.
- **60 fps export.**

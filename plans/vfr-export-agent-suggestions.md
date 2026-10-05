# VFR export — agent suggestions

Findings noticed while planning/implementing [vfr-export-oneshot.md](vfr-export-oneshot.md) that are out of its scope.

## 1. Cloud render never loads the Satoshi font

- **Where:** `render-worker/render-page/index.html` (no Satoshi load); captions draw with `Satoshi` in `shared/painters/captionPainter.ts:80`, loaded in the webapp only via CSS from fontshare (`shared/theme/index.css:5`).
- **Why it matters:** cloud exports render captions in a fallback font, so they look different from local exports of the same project.
- **Suggestion:** load the fonts the painters use (Satoshi, Inter, overlay text fonts) in the render page and await `document.fonts.load(...)` before rendering. The VFR plan adds the await in `ExportManager`, so the render page then only needs the `@font-face`/stylesheet.

## 2. Local export always decodes on the CPU

- **Where:** `webapp/src/editor/stores/useUIStore.ts:393`: `videoDecodePreference: 'cpu', // Always default to CPU during product restructuring`. `useLocalRender.ts:54` writes it into the decode prefs before every export.
- **Why it matters:** cheap for ≤1080p sources (measured ~0.15 ms/frame), but recordings can be up to 4K VP9, where software decode plus CPU→GPU upload per frame is costly.
- **Suggestion:** likely root cause of the hardware decode "unreliability": `FrameExtractor` feeds 2 s ahead (`FEED_AHEAD_MS = 2000`) and holds every decoded frame until passed, so up to ~60 open `VideoFrame`s. Hardware decoders have a small output pool and stall when frames aren't closed. Cap the number of held frames (feed only a few frames past the target), then re-test GPU decode on a 4K source before re-enabling it.

## 3. Zoom segments aren't re-sorted on update

- **Where:** `addZoomSegment` sorts by `sourceEndTimeMs` (`zoomActionSlice.ts:56`), but `updateZoomSegment` (`zoomActionSlice.ts:28-48`) does not.
- **Why it matters:** `getViewportStateAtTime` (`shared/animators/zoomAnimator.ts`) assumes sorted, non-overlapping segments. Out-of-order/overlapping segments make the later block jump into the middle of its transition.
- **Suggestion:** re-sort (and ideally clamp overlaps) in `updateZoomSegment`, or sort defensively in the animator's caller.

## 4. Inconsistent visibility checks across layers

- **Where:** zoom, spotlight and captions treat `visible` as truthy (`undefined` → hidden); overlays skip on `!visible`; camera-move uses `visible !== false` (`undefined` → visible).
- **Why it matters:** a segment with no `visible` field is hidden in one layer and shown in another.
- **Suggestion:** pick one convention (probably `visible !== false`) and apply it in all animators/painters, or guarantee `visible` is always set at creation/migration.

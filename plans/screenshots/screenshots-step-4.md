# Screenshots — Step 4: Extension region select

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
"Select area" in the popup: a drag-to-select overlay on the page, then a visible-tab capture cropped
to the selection in the service worker, persisted and handed off like visible mode.

## Files
- `extension/src/content/captureToast.ts` (new) — the bottom hint/progress toast shared by region
  and full-page capture (same visual recipe as the blur picker toast, no logo/button).
- `extension/src/content/regionSelectOverlay.ts` (new) — `showRegionSelect(onSelected, onCancel)`:
  fixed root, SVG even-odd dim mask with a clear hole, size label, Esc/Enter, ≥4 px drag; the overlay
  is removed and the page given 2×rAF + 50 ms to repaint BEFORE the selection is reported.
- `extension/src/content/content.ts` — `BACKGROUND_CONTENT_GET_PAGE_INFO`, `START_REGION_SELECT`,
  `CANCEL_REGION_SELECT` handlers; cleanup on `recordio-cleanup`.
- `extension/src/background/screenshotCapture.ts` — region flow: `ensureContentScript`, start the
  overlay (popup is acked and closes), wait for `CONTENT_REGION_SELECTED` / `_CANCELLED` (resolved
  from `background.ts`'s message listener), capture, crop with `createImageBitmap` +
  `OffscreenCanvas`, persist. Popup Cancel forwards `CANCEL_REGION_SELECT` to the tab.
- `extension/src/background/background.ts` — routes the three `CONTENT_*` messages to the module.

## Decisions
- Selection coordinates are visual-viewport CSS px; the crop scale is `bitmap.width / viewport.width`
  per axis, so browser zoom / DPR / pinch zoom need no special cases.
- A click without a drag (< 4 px) is ignored, not treated as a selection.

## Verification
- Drag from every corner direction; Enter confirms; Esc cancels (no import tab); crop matches the
  selection at DPR 2 and at 150 % browser zoom; the overlay, label and toast never appear in the PNG.

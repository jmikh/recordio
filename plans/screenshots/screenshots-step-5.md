# Screenshots — Step 5: Extension full-page capture

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
"Full page" in the popup: scroll the document one viewport at a time, capture each tile at Chrome's
2-per-second limit, stitch in the service worker, restore the page, hand off.

## Files
- `extension/src/content/fullPageCapture.ts` (new) — `FullPageSession` with `prepare()`,
  `scrollTo(y, i, n)`, `finish()`. Prepare: hide scrollbars, force `scroll-behavior: auto`, lazy
  images → eager + a pre-scroll pass (lazy loaders / infinite scroll), freeze `scrollHeight`, collect
  fixed/sticky elements with their natural document offsets, detect inner scrollers and pinch zoom,
  show the toast, arm Escape. ScrollTo: for tiles after the first, hide fixed elements and sticky
  elements that are stuck at this offset; wait 2×rAF + 150 ms; hide the toast; 2×rAF; report the
  ACTUAL `scrollY`. Finish restores everything (idempotent).
- `extension/src/content/content.ts` — `FULLPAGE_PREPARE` / `SCROLL_TO` / `FINISH` handlers.
- `extension/src/background/screenshotCapture.ts` — the driver loop: tile plan (`MAX_TILES = 50`),
  scale from the first tile, uniform downscale to `MAX_DIM = 16384` / `MAX_PIXELS = 64e6`, draw each
  tile at `actualScrollY × scale`, badge `%` + `SCREENSHOT_STATE` progress, cancel checks after every
  await, `FINISH` in `finally`.
- `extension/src/background/background.ts` — `CONTENT_SCREENSHOT_CANCELLED` routing.

## Decisions
- Inner-scroller or pinch-zoomed pages fall back to a visible-area capture (v1).
- Very long pages are downscaled rather than truncated; beyond 50 tiles they are truncated and
  flagged (`fullPage.truncated`).
- Only the current horizontal scroll column is captured (horizontal tiling is a follow-up).

## Verification
- Short page (1 tile), exact-N-viewports page, N + partial page (no duplicated strip), > 50 viewports
  (truncated, ≤ ~30 s), sticky header + fixed banner (once, at top), lazy images loaded, page with
  `scroll-behavior: smooth`, macOS overlay scrollbar absent; Esc mid-capture and popup Cancel restore
  scroll/visibility and open no tab; badge shows `%` and clears.

# Full-page capture v2 — oneshot plan

> Step 0 saves this as `plans/full-page-capture-oneshot.md` (planning-skill location; this file only
> exists because plan mode pins the path). Supersedes Step 5 of `plans/screenshots/`.

## Context

Full-page screenshots (extension → `runFullPageCapture` → stitched PNG) are visibly wrong on real
pages. Diagnosed against a saved Reddit capture + its HTML, a GoFullPage capture of Gmail, and a read
of GoFullPage 8.7's content script (techniques only — nothing copied):

| Symptom | Root cause (confirmed) |
|---|---|
| Reddit header avatar + first left-nav items repeat on every tile | We hide hosts with `visibility:hidden`. `visibility` is inherited and any descendant can override it — Reddit has `faceplate-partial[loading=eager]{visibility:visible}`; the nav uses Lit shadow styles. |
| Sticky rails (Reddit sidebars, LinkedIn rails) blank / repeat | `visibility:hidden` keeps the layout box; our "stuck" test marks rails stuck on every tile after the first. |
| Thin seam lines at tile tops | `planTiles` steps by exactly `viewportHeight`; integer `innerHeight` vs bitmap rounding leaves 1 px gaps. |
| 15 k-CSS-px page came out at 0.54× | `MAX_DIM = 16384` (Chrome allows 32767/side). |
| Gmail / app layouts → first screen only | `prepare()` sees an inner scroller and we fall back to a visible capture. |
| Feeds duplicate/shift content near seams | Page reflows mid-capture; height measured once (the docstring's "freeze" was never implemented). |

Already fixed this session (keep): `fetch(data:)` CSP block → in-process base64 decode; canvas never
painted (stale rAF handle after a StrictMode remount); toast `<kbd all:initial>` leaking through
`visibility:hidden`.

Outcome: captures match GoFullPage on Reddit, LinkedIn, Gmail and plain pages — fixed header once,
sticky things once at their natural position, no seams, inner scrollers expanded (up to 3 composed),
and (bonus) bottom-anchored fixed bars at the page bottom. DOM approach (make the browser paint the
right thing); no pixel diffing, no `chrome.debugger`.

## Design

### Vocabulary
- css px = page coords. `scale = bitmap.width / viewportWidth` (device px per css px); `s` = downscale
  for canvas limits; `k = scale·s`. `overlap = ceil(devicePixelRatio)` css px.
- **Strip** = one scroll source + the canvas region it owns. Strip −1 = the window (only if the
  document scrolls). Strips 0..2 = inner scrollers (`MAX_INNER_SCROLLERS = 3`).
- **Tile** = one `captureVisibleTab` at one `(windowY, scrollTop)`.
- **headerH** = css height of the fixed header band, decided once at prepare; drives the window step.

### Hiding rule (applies everywhere)
Only `opacity: 0 !important` hides anything — it composites the subtree, is not inherited, and no
descendant rule can undo it. `visibility` is never used. The toast hides with `display: none`.

### Content side — `extension/src/content/fullPage/` + `fullPageCapture.ts` (rewrite)
- `styleStack.ts` — `StyleStack.set(el, prop, value)` records `(el, prop, prev, prevPriority)` once per
  pair, applies with `setProperty(…, 'important')`; re-applies if a framework wiped the inline value
  (checked on each per-tile walk); `restoreAll()` in reverse. Owns the session `<style>`:
  `*::-webkit-scrollbar{display:none}`, `*{scrollbar-width:none!important; transition:none!important;
  animation-play-state:paused!important}` (pause, never `animation:none` — fill-mode fade-ins would
  snap to their 0-frame), `html,body{scroll-behavior:auto!important; overflow-anchor:none!important;
  scroll-snap-type:none!important}`.
- `domWalk.ts` — `walkComposed(root, visit, {maxNodes: 40000, maxMs: 250})`: iterative, descends into
  open `shadowRoot`s, skips `data-recordio` / `recordio-` nodes and their subtrees; returns
  `budgetHit`.
- `elementClassifier.ts` — `classifyElement(el, style, rect, vw, vh)`; the rect-only part
  `classifyFixedRect(rect, vw, vh)` is pure and lives in the background planner module so it is
  unit-tested and shared. Containing-block check: an ancestor with `transform`/`filter`/
  `perspective`/`will-change:transform`/`contain:paint|layout` means a fixed element already scrolls
  with the page → skip.
- `scrollerFinder.ts` — `findInnerScrollers({vw, vh, maxY})`: BFS from `body` through shadow roots;
  candidate iff `overflow-y ∈ {auto, scroll, overlay}`, `scrollHeight > clientHeight + 40`,
  `clientHeight > 50`, `clientWidth > 40`, `pointer-events ≠ none`, not `documentElement` (`body` IS
  allowed — covers `html{overflow:hidden} body{overflow:auto}` SPAs); do not descend into a match.
  Eligible iff fully visible once the window is at `windowY = clamp(boxTop, 0, maxY)`
  (`boxTop − windowY ≥ 0 && boxTop − windowY + boxH ≤ vh + 2`). Rank by `scrollHeight − clientHeight`
  desc, keep 3.
- `fillColor.ts` — `backgroundColorAt(x, y)`: `elementsFromPoint` minus recordio nodes → walk up
  (hopping shadow hosts via `getRootNode().host`) to the first non-transparent `background-color`;
  fallback `body`/`html` colour, then `#fff`. Fill is modelled as `{kind:'color', color}` so a
  sampled-row variant (keeps vertical dividers) can be added later.
- `captureTiming.ts` — `settle(ms)` and `afterRepaint()` (2×rAF + 50 ms, moved out of
  `regionSelectOverlay.ts:100` and reused there).

**Classification** (computed style + rect when first seen; identity in a `WeakMap`, class is sticky):

| Class | Rule | Treatment |
|---|---|---|
| sticky | `position:sticky` | `position:relative; top/left/right/bottom:auto; transition:none` for the session → appears once at its natural position |
| skip | fixed and (entirely offscreen \| `height ≥ vh−20 && width ≥ ⅔vw` (modal/backdrop) \| containing-block ancestor) | untouched |
| header | fixed, `top < 20`, `height < vh−20`, `width ≥ vw/2`; decided at prepare only; `headerH = max(rect.bottom)`; if `vh − headerH − overlap < vh/3` → `headerH = 0`, treat as fixedOther | visible on window tile 0; `opacity:0` on every other tile; band clipped out of tiles ≥1 and the step reduced |
| bottomFixed (Step 5) | fixed, `bottom ≥ vh−20`, `top > 20` | `opacity:0` on every tile; revealed only in the footer pass |
| fixedOther | any other fixed | visible on window tile 0; `opacity:0` afterwards (discovered later → hidden immediately). Absolutize is a later refinement, not v1 |
| bgFixed | `background-attachment:fixed` | `→ scroll` for the session |
| innerAbsolute (strips only) | `position:absolute`, `offsetParent` outside the strip element, area < 5 000 px² | `opacity:0` (overlay buttons pinned to the box frame) |

**`prepare()`** → `FullPagePrepareResult`: inject styles; lazy images → eager; pre-scroll the window
AND each candidate scroller (capped) so lazy loaders fire; back to 0; record original window scroll +
every scroller's `scrollTop`; run the classifier (sets `headerH`, relativizes sticky, converts
bgFixed); THEN the scroller finder (rects are natural positions now); fills sampled at
`(column mid-x, vh−1)` for the non-strip x-ranges (left of first strip, between, right of last) and
`pageBackground` at `(vw/2, vh−1)`; `hasBottomFixed`; toast + Escape; `pinchZoomed`.

**`scrollTo(payload)`** — `{ phase:'tile'|'footer', strip:-1|0..2, windowY, scrollTop?, tileIndex,
tileCount }`:
1. Toast text/show. `window.scrollTo(scrollX, windowY)`; if strip ≥ 0, `el.scrollTop = scrollTop`.
   Verify: read back; if off by > 1 and in range, wait 50 ms, retry once.
2. Per-tile `walkComposed(body)`: classify new elements; apply header/fixedOther/bottomFixed opacity
   for this tile (`tileIndex ≥ 1` hides; footer phase reveals bottomFixed and hides nothing else);
   re-assert wiped inline styles.
3. `settle(150)`; cancelled check; toast `display:none`; `afterRepaint()`.
4. Return `{ cancelled, scrollY, scrollTop?, box? (strip element's border box on screen ∩ viewport,
   css), documentHeight (live), stripScrollHeight?, footerRects? (footer phase) }`.

**`finish()`**: `restoreAll()`, lazy attrs, each strip's original `scrollTop`, window scroll, remove
style/toast/listener. Idempotent; reached from Escape, popup cancel, tab close, `recordio-cleanup`.

### Background side — `extension/src/background/`
- `fullPagePlan.ts` — **pure, no `chrome`/DOM, unit-tested**: `classifyFixedRect`,
  `planWindowTiles`, `planStripTiles`, `adoptHeightChange`, `computeDownscale`,
  `computeCanvasLayout` (height, owned regions, fills, relocation), `tileOps` → `DrawOp[]`
  (`{src, dst, clipOut?}`) / `FillOp[]` in device px.
- `fullPageStitcher.ts` — executor over `OffscreenCanvas`: `ensureSize(w, h, s)` (copy-grow into a
  new canvas; rescale by `s'/s` if `s` must drop; free the old one), `draw(op, bitmap)` with evenodd
  clip-out, `fill(op)`, `relocate` (via `createImageBitmap(canvas, …)` so overlapping src/dst is safe),
  `finalize(cropBottom)` → PNG blob.
- `screenshotCapture.ts` — `runFullPageCapture` becomes the driver (below). `MAX_DIM = 32767`,
  `MAX_PIXELS = 80e6` (≈320 MB RGBA transient in the SW — deliberate bump from 64e6 so DPR-2 pages
  ~15 k css px tall stay ≥ 0.96×; watch Sentry, revert to 64e6 if the SW OOMs), `MAX_TILES = 50`
  total across strips + footer.

**Math.** `maxY = max(0, docH − vh)`; `step = vh − headerH − overlap`.
- Window tile i at ACTUAL `Y_i` (planned lazily from the previous actual value, so clamping is
  absorbed): i=0 `src=(0,0,bw,bh)`, `dst.y=0`; i≥1 `src=(0, round(headerH·scale), bw, bh−…)`,
  `dst.y = round((Y_i + headerH)·k)`. Continuity: tile i starts at `Y_{i−1} + vh − overlap` → `overlap`
  css px of overlap, later tile on top.
- Strip tile: content returns on-screen box `B`; `src = B·scale`, `dst = (B.x, B.y + scrollY +
  scrollTop)·k` — valid even if `B` is viewport-clipped, so a later "box hangs below the fold" mode is
  planner-only. `stepS = boxH − overlap`, `maxT = scrollHeight − clientHeight`. Each strip captures its
  own tile 0 (the window pass may have been at a different `windowY`).
- **Owned region** per strip: `x ∈ [box.x, box.x+box.w]`, `y ∈ [boxTop, boxTop + scrollHeight]`
  (document css, from prepare). Every window op carries `clipOut = ownedRegions ∩ dst` (intersect
  FIRST — a clip-out rect extending past `dst` flips evenodd parity and becomes *included*). Draw order
  is therefore irrelevant to correctness.
- **Gmail mode** = `!document.scrollable && strips.length ≥ 1`: each strip's tail (rows
  `[boxBottom, vh]` in its column) is copied from the strip's tile-0 bitmap to
  `y = boxBottom + (scrollHeight − clientHeight)`. `H = max(docH, max_j(boxTop_j + scrollHeight_j +
  (gmailMode ? vh − boxBottom_j : 0)))`.
- **Fills**: clear the canvas to `pageBackground`, then fill rows `[docH, H]` per non-strip column
  with the sampled colours, before any draw.
- **Height adoption**: after window tiles 1 and 2 (and strip tile 1), if the live height differs,
  re-plan the remaining tiles and `ensureSize`; after that growth is ignored (feeds never terminate
  otherwise). Shrinks: actual offsets are used; `finalize` crops to `drawnBottom`.
- **Footer pass** (Step 5): one extra `{phase:'footer', strip:-1, windowY:maxY}`; content reveals
  bottomFixed, returns their on-screen rects; each is drawn at `dst.y = H_dev − (vh − rect.y)·k`.
  Skipped when the capture was a single tile with no strips (leave them visible on tile 0).

**Driver order**: PREPARE → plan + `ensureSize` + fills → window tiles 0..n−1 → strips in rank order
(tiles 0..m−1 at `windowY_j`) → footer pass → FINISH (always, also on cancel/error) →
`persistAndOpen` + `trackScreenshotCaptured`. Progress = tiles done / planned total.

### Protocol — `extension/src/shared/messageTypes.ts`
```ts
interface FullPageStripInfo { index: number; box: Rect /* document css, natural */; scrollHeight: number; clientHeight: number; windowY: number }
interface FullPagePrepareResult {
  viewportWidth; viewportHeight; devicePixelRatio; scrollX;
  document: { scrollWidth; scrollHeight; scrollable: boolean };
  headerHeight: number; strips: FullPageStripInfo[];
  pageBackground: string; fills: Array<{ x0; x1; color }>;
  hasBottomFixed: boolean; pinchZoomed: boolean; walkBudgetHit: boolean;
}
interface FullPageScrollToPayload { phase: 'tile'|'footer'; strip: number /* -1 window */; windowY: number; scrollTop?: number; tileIndex: number; tileCount: number }
interface FullPageScrollToResult { cancelled: boolean; scrollY: number; scrollTop?: number; box?: Rect; documentHeight: number; stripScrollHeight?: number; footerRects?: Rect[] }
```
Remove `innerScroller` and the TEMP `scrollHeight`/`viewportHeight` fields.
`shared/types/screenshot.ts` `RawScreenshot.fullPage` `+ stripCount?, headerHeight?, replanned?`.
`extension/src/utils/mixpanel.ts trackScreenshotCaptured` `+ strip_count, header_clipped, replanned,
walk_budget_hit, bottom_fixed`. `e2e/fixtures/extensionMock.ts` literal: unchanged shape works
(all new fields optional); add `fullPage` only if the inspector starts showing it.

### Edge cases (decided)
| Case | Handling |
|---|---|
| Header that hides/shrinks on scroll | irrelevant: opacity-hidden + band clipped on tiles ≥1 with the prepare-time `headerH` |
| Fixed element straddling tile 0's bottom | cut at the tile edge (accepted; absolutize later) |
| Modal / cookie backdrop | skipped → repeats, as GoFullPage; user sees what's on screen |
| Fixed under transformed/contained ancestor | skipped (already scrolls) |
| Inner box not fully visible at its `windowY` | ineligible in v1 (formula already general) |
| Nested scrollers | BFS stops at a match |
| Horizontal overflow, `scrollX ≠ 0`, iframes, closed shadow roots | not tiled; x preserved |
| Growth after tile 2 (infinite feed) | ignored; capture ends at the planned height |
| Virtualised inner lists | `scrollHeight` is the spacer height; rows render during settle |
| Walk budget hit | continue with what was classified; telemetry flag |
| Lit re-render wipes inline styles | per-tile walk re-asserts via `StyleStack` |
| Cancel (Esc / popup / tab close) | unchanged paths; `finish()` also restores strip `scrollTop`s |
| Pinch zoom | visible-area fallback (the only remaining fallback) |

## Implementation steps

**Step 0 — Housekeeping.** Copy this doc to `plans/full-page-capture-oneshot.md`. Remove the TEMP
`[fullpage-debug]` code: `screenshotCapture.ts` (log block + `lastTileBottom`), `fullPageCapture.ts`
`scrollTo` return, `messageTypes.ts` optional fields. Drop the false "freeze the document height"
docstring.

**Step 1 — Foundations (no behaviour change except seams/limits).** `styleStack.ts`, `domWalk.ts`,
`captureTiming.ts` (+ `regionSelectOverlay.ts` uses it), toast `display:none`, session stylesheet.
`fullPagePlan.ts` with `planWindowTiles` (overlap, no header yet), `computeDownscale`
(32767 / 80e6) + `fullPagePlan.test.ts`; add `'extension/src/**/*.test.ts'` to `vitest.config.ts`
include. `fullPageStitcher.ts` (later-over-earlier draws, `ensureSize`, `finalize(crop)`).
*Verify: plain long page — no seam lines; Reddit not downscaled below ~0.96.*

**Step 2 — Window strip rewrite (Reddit / LinkedIn).** Classifier + table; sticky → relative at
prepare; header `opacity:0` + band clip + reduced step; fixedOther hide after tile 0; bgFixed;
per-tile re-walk with shadow roots; scroll verify/retry; height adoption at tiles 1–2 with copy-grow;
new protocol (window only; `strip`/`phase` fields ship now so later steps don't change the shape).
Delete `setVisibility` and the "stuck" logic. *Verify: Reddit home (header + avatar once, nav items
once), LinkedIn feed (rails once), a docs page with a fixed header (the text line directly under the
header is present on every tile).*

**Step 3 — Single inner scroller (Gmail mode).** `scrollerFinder.ts` (cap 1), `fillColor.ts`,
`computeCanvasLayout` (owned region, fills, relocation), stitcher `clipOut` + `relocate`, driver
strip loop, innerAbsolute rule, pre-scroll of the scroller. Visible fallback only for `pinchZoomed`.
*Verify: Gmail inbox matches the GoFullPage reference (chrome once, list expanded to the "Program
Policies" footer, side columns filled with the sidebar colour); a `body`-scroller SPA.*

**Step 4 — Multi-strip (≤ 3) with a scrollable document.** Lift the cap; ranking; shared tile
budget; `windowY_j` positioning; multi-column fills; progress across strips. *Verify: Reddit — feed
via the window, left nav and right sidebar each expanded in place beside it; Esc restores their
`scrollTop`.*

**Step 5 — Bonus: bottom-fixed footer pass.** `bottomFixed` class, `phase:'footer'`, `footerRects`,
footer draw op, budget reservation, telemetry. *Verify: LinkedIn messaging bar and a cookie banner
appear once, at the canvas bottom.*

**Step 6 — Docs.** `plans/screenshots/screenshots-architecture.md` §4 full-page bullet → strips
model + link; Step log entry in `plans/screenshots/screenshots-tiered-plan.md`.

## Verification (end to end)
Build `npm run build:extension:dev`, reload the extension; `npx vitest run extension/src shared`.
Unit (`fullPagePlan.test.ts`): tile continuity property test over random `(docH, vh, headerH, dpr)`
(overlap ≥ `overlap·scale`, full coverage, clamped last tile still overlaps); header taller than
⅔ vh rejected; `adoptHeightChange` only at indices 1–2; owned regions / fills / relocation only in
Gmail mode; `clipOut ⊆ dst`; footer op lands at `H − (vh − rect.y)`; `classifyFixedRect` rows;
`computeDownscale` limits.

Manual matrix (open each capture in the editor at 1:1):

| Page | Expect |
|---|---|
| Reddit home, DPR 2 | header + avatar once; nav items once; rails expanded in place (Step 4); no seams; `s ≥ 0.96` |
| Reddit post | sticky comment-sort bar once; "back to top" (appears on scroll) never shown |
| LinkedIn feed | nav once; sticky cards once at natural position; messaging bar once at the bottom (Step 5); feed growth adopted at tiles 1–2 |
| Gmail inbox | matches the GoFullPage reference; Esc restores list scroll |
| Docs page with fixed header | header once; line under the header present on every tile; DPR 1 / 1.25 / 2 |
| Cookie-banner page | banner once at the bottom (Step 5) |
| Plain long page | identical to today minus seams; 1-tile page = 1 capture |
| `body`-scroller SPA | single strip, full height |
| > 50 tiles | `truncated`, no error |
| Pinch-zoomed | visible fallback |
| Esc / popup cancel / tab close mid-capture | styles + all scroll positions restored; no import tab; badge cleared |

# Screenshots sub-product (tiered plan)

> On implementation, copy this doc to `plans/screenshots/screenshots-tiered-plan.md` (planning skill
> convention). Step docs go in the same folder as `screenshots-step-N.md`, written when each step starts.

## Context

Recordio today records video only. Users frequently want a quick annotated screenshot of the page they
are on (bug reports, docs, support replies) and shouldn't have to leave Recordio for that. This plan adds
a **screenshot sub-product**: capture from the extension popup (visible area / full page / selected
region), annotate in a new webapp editor (text, arrow, line, rect, ellipse, blur/pixelate, crop), then
copy to clipboard, download PNG/PDF, or share a public link.

Decisions agreed with the user:
- Tiered plan.
- Editor lives in the **webapp** (new tab), not in the extension.
- v1 tools: text, arrow, line, rect, ellipse, blur/pixelate, crop. No beautify, pen, or numbered markers.
- Share: public link + view page. Export: copy to clipboard, PNG, PDF, all client-side.
- **Screenshots are their own entity**: a `screenshots` table and `screenshot-*` routes, not a kind of
  project. Nothing screenshot-related is called "project".
- **Separate free-plan cap for screenshots** (proposed `FREE_SCREENSHOT_CAP = 20` live screenshots per
  free workspace, unlimited on trial/pro; one constant, easy to tune).
- **Policy-only sharing** in v1 (private / workspace / public + view/edit workspace access). No
  per-user editor grants, so no `screenshot_editors` table.
- Dashboard: **own "Screenshots" sidebar section**; Trash shows both videos and screenshots.

## Guiding principles

- **Reuse the overlay stack, not the project row.** `shared/types/overlay.ts`,
  `shared/painters/overlayPainter.ts`, the per-item editor in
  `webapp/src/editor/components/canvas/CanvasOverlayEditor.tsx` and the `bounding-box/` kit already
  implement blur/text/arrow/border editing on Canvas 2D. Screenshots reuse them by dropping the time
  dimension. The persistence layer is separate and mirrors the project routes' proven patterns
  (slug default, share policy, CAS on `cloud_version`, soft delete + purge job).
- **Client never touches tables.** All DB access is Fastify routes with TypeBox schemas in
  `shared/api/screenshots.ts` (edge functions/RPCs are decommissioned; the CLAUDE.md rule maps to routes).
- **Privacy on share.** The public page serves a **flattened render** uploaded by the editor, never the
  raw source, so blur actually hides content.
- **Fast first edit.** The editor opens from the locally cached blob (`BlobCache`) while the TUS upload
  proceeds, same as video.

---

## Architecture

```
Extension popup ──POPUP_CAPTURE_SCREENSHOT{mode}──▶ background/screenshotCapture.ts
   visible : captureVisibleTab
   region  : content regionSelectOverlay → rect → captureVisibleTab → crop (OffscreenCanvas in SW)
   fullpage: content fullPageCapture (scroll, hide fixed/sticky) ↔ tiles (≤2/s) → stitch (OffscreenCanvas)
                                                          ▼
   ProjectStorage (IndexedDB): RawScreenshot + PNG blob → chrome.tabs.create(/import?id&ext&kind=screenshot)
                                                          ▼
Webapp /import ── bridge HANDOFF (chunk source 'image') ──▶ ScreenshotService.importScreenshot
   screenshot-create → TUS upload {uid}/screenshots/{sid}/source.png → screenshot-confirm-upload
                                                          ▼
/screenshot/{slug}/edit  ScreenshotEditor (zustand+zundo, shared OverlayItemEditor, renderScreenshot())
   autosave  → screenshot-update (CAS)        thumbnail → screenshot-update-thumbnail
   export    → canvas.toBlob PNG / ClipboardItem / jspdf
   share     → flattened PNG → screenshot-render-upload → {uid}/screenshots/{sid}/renders/v{n}.png
                                                          ▼
/screenshot/{slug}  ScreenshotViewPage ── shared-screenshot-get (presigned URL of the render only)
```

### Data model

**DB** — `supabase/migrations/<date -u '+%Y%m%d%H%M%S'>_screenshots_create.sql`
(+ reference snapshot `supabase/sql/tables/screenshots.sql`):
```sql
CREATE TABLE public.screenshots (
  id                     uuid PRIMARY KEY,
  created_by             uuid NOT NULL,
  owner_id               uuid NOT NULL,
  workspace_id           uuid NOT NULL REFERENCES public.workspaces(id),
  name                   text NOT NULL DEFAULT 'Untitled',
  screenshot_data        jsonb NOT NULL,                     -- ScreenshotDoc (editor struct)
  source_storage_path    text NOT NULL,                      -- server-authoritative copy of source meta
  width_px               integer NOT NULL,
  height_px              integer NOT NULL,
  capture_mode           text NOT NULL CHECK (capture_mode IN ('visible','fullPage','region')),
  page_url               text,
  page_title             text,
  thumbnail_storage_path text,
  upload_status          text NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending','ready')),
  cloud_version          integer NOT NULL DEFAULT 1,
  slug                   text NOT NULL UNIQUE DEFAULT left(replace(gen_random_uuid()::text,'-',''),12),
  share_policy           text NOT NULL DEFAULT 'private' CHECK (share_policy IN ('private','workspace','public')),
  workspace_access       text NOT NULL DEFAULT 'view' CHECK (workspace_access IN ('view','edit')),
  render_storage_path    text,
  render_cloud_version   integer,
  last_accessed_at       timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  permanently_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX screenshots_workspace_idx ON public.screenshots (workspace_id) WHERE permanently_deleted = false;
ALTER TABLE public.screenshots ENABLE ROW LEVEL SECURITY;   -- no policies: server-only access (current practice)
```
`projects` is untouched. Test seed: `seedScreenshot()` in `server/test/helpers/db.ts`.

**Storage paths** (bucket `project-media`; first folder = uid satisfies the TUS RLS policy and the
`/storage-download-urls` prefix rule, so thumbnails and the source resolve through the existing route):
```
{userId}/screenshots/{screenshotId}/source.png
{userId}/screenshots/{screenshotId}/thumbnail.webp
{userId}/screenshots/{screenshotId}/renders/v{cloudVersion}.png
```
Purge deletes the `{created_by}/screenshots/{id}/` prefix.

**Shared types** — new `shared/types/screenshot.ts` (exported from `shared/types/index.ts`):
```ts
export type ScreenshotCaptureMode = 'visible' | 'fullPage' | 'region';

/** Extension-side capture result (IndexedDB + bridge payload). */
export interface RawScreenshot {
  kind: 'screenshot'; id: string; name: string; timestamp: number;
  captureMode: ScreenshotCaptureMode;
  image: { storagePath: string /* recordio-blob://shot-<id>-image */; mimeType: 'image/png'; size: Size };
  page: { url: string; title: string; viewport: Size; devicePixelRatio: number; scale: number };
  region?: Rect;                                   // CSS px, viewport-relative
  fullPage?: { documentSize: Size; tileCount: number; truncated: boolean; downscaled: boolean };
}
export type RawCaptureItem = RawRecording | RawScreenshot;   // RawRecording has no `kind` → legacy = recording

/** Editor document stored in screenshots.screenshot_data. All coords in UNCROPPED source pixels. */
export interface ScreenshotDoc {
  id: ID; schemaVersion: number;
  source: { storagePath: string; widthPx: number; heightPx: number; devicePixelRatio: number;
            pageUrl?: string; pageTitle?: string; captureMode: ScreenshotCaptureMode };
  cropPx: Rect | null;                             // non-destructive crop
  annotations: OverlayItem[];                      // z-order = array order
  annotationDefaults: Pick<OverlaySettings, 'blurDefaults'|'textDefaults'|'arrowDefaults'|'borderDefaults'>;
}
```
`source` is duplicated into row columns at create time so server routes (share page, purge, lists)
never parse JSON; the JSON copy keeps the editor doc self-contained.

**Overlay type extensions** (`shared/types/overlay.ts`, all optional → existing video JSON untouched):
- `ArrowOverlayItem.headStyle?: 'arrow' | 'none'` → line
- `BorderOverlayItem.shape?: 'rect' | 'ellipse'` → ellipse
- `BlurOverlayItem.mode?: 'blur' | 'pixelate'` (`blurRadiusPx` = cell size when pixelate)

`OverlayItemType` stays `'blur'|'text'|'arrow'|'border'`, so the item editor switch, labels/icons,
inspector and overlay slice need no changes.

### Contracts

**Bridge** (`shared/types/bridge.ts`): `ChunkPayload.source` += `'image'`;
`HandoffMetadataResponse = HandoffRecordingMetadataResponse (kind?: 'recording') |
HandoffScreenshotMetadataResponse { success: true; kind: 'screenshot'; screenshot: RawScreenshot;
imageSize; imageType; extensionDistinctId? }`; `buildImportUrl(id, extId, kind?)` appends
`&kind=screenshot` (cosmetic, backward compatible).

**Extension messages** (`extension/src/shared/messageTypes.ts`): `POPUP_CAPTURE_SCREENSHOT {mode}`,
`POPUP_CANCEL_SCREENSHOT`, `BACKGROUND_CONTENT_GET_PAGE_INFO`, `BACKGROUND_CONTENT_START_REGION_SELECT`,
`BACKGROUND_CONTENT_CANCEL_REGION_SELECT`, `BACKGROUND_CONTENT_FULLPAGE_PREPARE`,
`BACKGROUND_CONTENT_FULLPAGE_SCROLL_TO {y,tileIndex,tileCount}`, `BACKGROUND_CONTENT_FULLPAGE_FINISH`,
`CONTENT_REGION_SELECTED {rect,viewport,dpr,visualScale}`, `CONTENT_REGION_CANCELLED`,
`CONTENT_SCREENSHOT_CANCELLED`. `STORAGE_KEYS` += `SCREENSHOT_STATE`, `SCREENSHOT_ERROR`.

**Shared API** — new `shared/api/screenshots.ts` (TypeBox schemas = server validation, plus wire
interfaces `CloudScreenshot`, `CloudScreenshotSummary`), registered in `ApiRoutes`
(`shared/api/index.ts`). `shared/api/entitlements.ts` gains `screenshotCap: number | null`.

**Server routes** — new folder `server/src/routes/screenshots/`, all `POST`, registered in
`server/src/app.ts`, each mirroring its `routes/projects/` sibling:
| Route | File | Behaviour |
|---|---|---|
| `/screenshot-create` | `screenshotCreate.ts` | `requireUser` + `isWorkspaceMember` + live `COUNT(*)` on `screenshots` vs `entitlements.screenshotCap` → 403 `screenshot_cap_reached`. Body `{ screenshot: ScreenshotDoc (additionalProperties: true), name?, workspaceId }`. Stamps `source.storagePath`, upserts row (`pending`), returns `{ screenshotId, slug, bucket, storagePath }`. |
| `/screenshot-confirm-upload` | `screenshotConfirmUpload.ts` | owner-only `pending → ready` |
| `/screenshot-get` | `screenshotGet.ts` | `{ screenshotId } \| { slug }`, `canEditScreenshot`, bumps `last_accessed_at`, returns `CloudScreenshot` |
| `/screenshot-list` | `screenshotList.ts` | `{ workspaceId }`, member check, `permanently_deleted=false AND upload_status='ready'`, returns summaries incl. `deleted_at`, `share_policy`, `thumbnail_storage_path`, `width_px/height_px` |
| `/screenshot-update` | `screenshotUpdate.ts` | `{ screenshotId, screenshotData, expectedVersion }`; md5 no-op short-circuit + compare-and-set on `cloud_version` → 409 `version_conflict` |
| `/screenshot-rename` | `screenshotRename.ts` | editor access |
| `/screenshot-delete`, `/screenshot-restore` | `screenshotDelete.ts`, `screenshotRestore.ts` | owner-only; restore gated by `entitlements.canRestore` |
| `/screenshot-share` | `screenshotShare.ts` | owner-only + `canShare` (except → private); `{ sharePolicy, workspaceAccess }` |
| `/screenshot-update-thumbnail` | `screenshotUpdateThumbnail.ts` | multipart ≤ 500 KB, forced `image/webp`, `putObject` under `created_by` prefix |
| `/screenshot-render-upload` | `screenshotRenderUpload.ts` | multipart `{ screenshotId, cloudVersion, file }` ≤ 25 MB, editor access; `putObject(renders/v{n}.png)` + `UPDATE ... WHERE cloud_version=$n` (0 rows → delete object, 409 `version_mismatch`); best-effort delete of the previous render |
| `/shared-screenshot-get` | `server/src/routes/sharedScreenshotGet.ts` | `optionalUser`, 60/min; slug → `{ name, userName, widthPx, heightPx, imageUrl: presigned render \| null, stale }` with the same public / `auth_required` / `canViewScreenshot` / 404 ladder as `sharedVideoGet.ts` |

Access helpers: `server/src/services/screenshotAccess.ts` — `getScreenshotIfEditor`,
`canEditScreenshot`, `canViewScreenshot`. Same shape as `projectAccess.ts` minus the editors-table
clauses (edit = owner OR non-viewer workspace member when `share_policy IN ('workspace','public') AND
workspace_access='edit'`; view = public OR owner OR any member when `workspace`). `isWorkspaceMember`
is reused from `projectAccess.ts`.

Entitlements: `FREE_SCREENSHOT_CAP = 20` + `screenshotCap` in `server/src/services/entitlements.ts`
(`entitlementsForState`: free → 20, trial/pro → null).

Purge: `server/src/jobs/screenshotsPurgeDeleted.ts` (`screenshots.purge-deleted`, 30 days, deletes
the storage prefix then flips `permanently_deleted`), registered in `server/src/jobs/index.ts`.

### Webapp routing
New `webapp/src/lib/screenshotUrls.ts`: `screenshotEditPath(slug)` → `/screenshot/{slug}/edit`,
`screenshotViewPath(slug)` → `/screenshot/{slug}`, `screenshotUrl(slug)` (absolute, for copy link).
`App.tsx`: regex `/^\/screenshot\/[^/]+\/edit\/?$/` → `pages/ScreenshotEditorPage.tsx`;
`/screenshot/…` → `pages/ScreenshotViewPage.tsx`; both ungated like `/video/` (view page prompts on 403).

### Webapp persistence layer (`webapp/src/screenshot/`)
- `api/screenshotStorage.ts` — transport over `invokeFunction`/`invokeFunctionUpload`: create,
  confirmUpload, get, list, update (throws `CloudVersionConflictError`), rename, delete, restore, share,
  uploadThumbnail, uploadRender, sharedGet. Reuses `CloudStorage.uploadBlobResumable` (TUS) and
  `CloudStorage.requestDownloadUrls`.
- `screenshotService.ts` — orchestration mirroring `CloudProjectService`: `importScreenshot(blob, raw,
  workspaceId)` (build doc via `core/createScreenshotDoc.ts`, `SCREENSHOT_SCHEMA_VERSION = 1`; guard
  sides > 16384 px by downscaling; create → `BlobCache.put(storagePath)` → **await** TUS upload →
  confirm; name = page title truncated to 40 or "Screenshot"), `loadScreenshot({slug})` (get →
  `core/migrateScreenshotDoc.ts` → blob URL from `BlobCache`/signed URL), `saveScreenshot` (SHA-256
  no-op skip, in-flight guard, CAS, conflict → existing `ConflictModal` via a screenshot resolver;
  extract `projectDataHash` into `webapp/src/storage/dataHash.ts` so both services share it),
  `saveThumbnail`, `publishRender`, `listScreenshots`, `loadThumbnails` (batch signed URLs +
  `BlobCache`, same as projects).
- `store/useScreenshotMetaStore.ts` — `ScreenshotShareMeta { id, slug, ownerId, workspaceId,
  sharePolicy, workspaceAccess, cloudVersion }` (not part of undo history).

### Reuse seams in the video editor (behaviour-preserving)
1. `shared/painters/overlayPainter.ts`: export `drawOverlayItem(ctx, item, paint: OverlayPaintContext)`
   with `{outputSize, viewport, effectScale, textScale}`; `drawOverlays` keeps its signature and builds
   the context exactly as today (video pixels unchanged, pinned by a stub-ctx parity test). Add the
   three variants inside `drawArrow`/`drawBorder`/`drawBlur` (pixelate = downscale to an offscreen
   canvas at 1/cell, `imageSmoothingEnabled=false` back into the rounded clip). Export `wrapLines`.
   Screenshots use width-based scales (`cropWidth/1920`) so tall pages don't inflate shadows/padding.
2. `webapp/src/editor/hooks/useDisplayMapper.ts`: add `DisplayMapperProvider`; the hook returns the
   context value if present, else the store-derived mapper. `BoundingBox`, `CornerRadiusHandle`, arrow
   handles and the text editor then work in both editors unchanged.
3. `webapp/src/editor/hooks/useHistoryBatcher.ts`: `createHistoryBatcher(getTemporal)` factory with
   per-instance counters; `useHistoryBatcher = createHistoryBatcher(() => useProjectStore.temporal)`.
4. Move `OverlayItemEditor`, `ArrowPointHandles`, `InlineTextEditor` out of `CanvasOverlayEditor.tsx`
   into `webapp/src/editor/components/canvas/overlay-item/` with explicit props
   `{item, updateItem, batcher, previewItemRef, constraintBounds?, textScale, isEditing, onEnterEdit, onExitEdit}`
   (no store reads inside). `OverlayEditor` becomes a thin video wrapper.
5. `createDefaultItem(type, outputSize, settings)` → wrapper over new
   `createDefaultItemInRect(type, area, defaults)` in `webapp/src/editor/overlay/defaultItems.ts`.
6. `ShareModal.tsx`: extract the presentational pieces (policy dropdown options, access dropdown,
   copy-link row, owner/read-only messaging) into `webapp/src/share/SharePolicyControls.tsx`; the video
   `ShareModal` keeps its `project-share` / `mux-video-create` / member-grants logic. Screenshots get
   their own small `ScreenshotShareModal` (no member grants) built from the extracted controls.
7. `ProjectNameField` accepts optional `{value, onCommit}`; `OverlayItemSettings` exported from
   `OverlayInspector.tsx` with `updateSettings` optional; `ProjectCard` accepts `onOpen`, `href`,
   `badge`, `showDuration` so the Screenshots grid and Trash can reuse it.

### Extension capture design (summary; details in step docs)
- **Popup**: `MultiToggle<'video'|'image'>` (icon-only `LuVideo` / `LuImage`) in the `PopupApp.tsx`
  header beside the logo, hidden while a recording is active. Mode persisted in `recordio_prefs` via a
  new `popup/prefs.ts` (`loadPrefs`/`updatePrefs` merge — also fixes `PreRecordingView` overwriting
  the whole prefs object). New `popup/ImageCaptureView.tsx`: three rows (Visible area `LuAppWindow`,
  Full page `LuGalleryVertical`, Select area `LuSquareDashed`), disabled on non-http/file tabs. Region
  and full page close the popup after ack; visible keeps it open until the import tab steals focus.
  Reopened popup during full-page shows progress + Cancel from `SCREENSHOT_STATE`.
- **Background** `extension/src/background/screenshotCapture.ts`: owns the session; throttled
  `captureVisibleTab(windowId,{format:'png'})` (≥510 ms spacing; Chrome caps at 2/s); decode via
  `fetch(dataUrl)` + `createImageBitmap`; crop/stitch with `OffscreenCanvas` in the service worker
  (no offscreen document needed); scale = `bitmap.width / viewportCssWidth` (robust to zoom/DPR);
  `ensureContentScript(tabId)` injects on demand using the existing `contentScriptPath`; tab
  closed/navigated → cancel. Errors → `SCREENSHOT_ERROR` + badge `!` (recording-failure pattern).
- **Region** `extension/src/content/regionSelectOverlay.ts` (vanilla DOM like `countdownOverlay.ts`):
  SVG evenodd dim mask with clear hole, size label, hint toast, Esc/Enter; overlay removed then
  2×rAF + 50 ms before reporting so it never appears in the capture; rect in visual-viewport CSS px.
- **Full page** `extension/src/content/fullPageCapture.ts`: prepare (hide scrollbars,
  `scroll-behavior:auto`, lazy→eager + pre-scroll pass, freeze `scrollHeight`, collect fixed/sticky),
  per-tile scroll + hide fixed/stuck-sticky after tile 0, wait 2×rAF+150 ms, hide toast, respond with
  actual `scrollY` (last-tile overlap handled by drawing at the actual offset); finish restores
  everything. Background caps `MAX_TILES=50`, downscales uniformly to `MAX_DIM=16384` /
  `MAX_PIXELS=64e6`, badge shows `%`. Inner-scroller pages → fall back to visible area with a message.
  Horizontal tiling is a follow-up (v1 captures the current column).
- **Persistence**: `RawScreenshot` in the existing IndexedDB `projects` store, blob `shot-<id>-image`
  in `recordings` (no DB version bump; `clearAll`/delete-by-id keep working). Handoff handlers in
  `background.ts` branch on `isRawScreenshot`.

### Webapp editor design (summary)
- `webapp/src/screenshot/`: `store/useScreenshotStore.ts` (zustand+zundo, `partialize {doc}`, JSON
  equality, limit 50, 2 s autosave → `saveScreenshot`) + non-temporal `store/useScreenshotUIStore.ts`
  (tool, selection, crop draft); `render/renderScreenshot.ts` (pure: draw cropped source, then
  `drawOverlayItem` per annotation; used by canvas, thumbnail, export, publish); `geometry.ts`
  (hit-test incl. arrow/line tolerance, bounds, fit-to-width, thumbnail crop; unit-tested); components
  `ScreenshotCanvas` (event-driven redraw, fit-to-width, vertical scroll, drag-to-create),
  `AnnotationLayer` (shared `OverlayItemEditor` inside `DisplayMapperProvider`), `CropLayer`
  (`BoundingBox` + `DimmedOverlay`), `ScreenshotToolbar` (shortcuts V T A L R O B C, Del, Esc,
  ⌘Z/⇧⌘Z), `ScreenshotInspector` (`OverlayItemSettings` + Blur/Pixelate, Rect/Ellipse, Arrow/Line
  toggles, z-order, delete), `ScreenshotHeader` (undo/redo, name, Copy image, Download PNG/PDF, Share,
  user menu), `ScreenshotEditor.tsx` (bootstrap like `editor/App.tsx`; thumbnail = top 16:9 region at
  480 px webp after each successful save).
- Safari: default new blur items to `pixelate` when `ctx.filter` is unsupported.
- Zoom is deferred; the `DisplayMapper(outputSize, displaySize)` seam makes it a later multiplier.

### Export & share
- `webapp/src/screenshot/export/exportScreenshot.ts`: offscreen render at crop resolution →
  `toBlob('image/png')`; clipboard via `ClipboardItem({'image/png': promise})` (keeps the user gesture
  in Safari; toast fallback "Download instead"); PDF via lazy `import('jspdf')`, one page sized to the
  image in px (paginate only when `h*0.75 > 14400` pt). Add `jspdf` to root `package.json`.
- Share: `ScreenshotShareModal` calls `screenshot-share`; on leaving private it renders + uploads the
  flattened PNG via `screenshot-render-upload` before showing the link; the editor re-publishes
  (debounced, hash-guarded) after saves while `sharePolicy !== 'private'` so `stale` is transient.
  Dashboard share = policy only; view page shows "not published yet" when `imageUrl` is null.
  `ScreenshotViewPage` mirrors `VideoPage.tsx` (header, attribution, 403 → `AuthModal`, not-found)
  with an `<img>` card, Copy link, Download (fetch presigned URL → blob → `<a download>`).

### Dashboard
`DashboardView` += `'screenshots'`; sidebar item "Screenshots" (`LuImage`) with count and
`ownedScreenshotCount / screenshotCap` under the cap indicator (same pattern as videos). `DashboardPage`
loads `screenshot-list` alongside `project-list` for the workspace; the Screenshots view renders
`ProjectCard`s with an image badge, no duration, open → `screenshotEditPath`, copy link →
`screenshotUrl`, card menu (rename, share, delete) dispatching to the screenshot service. Trash view
merges both lists (client-side `kind` tag) with restore/delete dispatched per kind. Sidebar label
"Your Videos" stays as is.

---

## Steps

1. **DB + shared contracts** — `screenshots` migration + snapshot + `seedScreenshot`; `shared/types/screenshot.ts`;
   overlay variant fields; `overlayPainter` refactor (`drawOverlayItem`, variants, `wrapLines` export)
   with a stub-ctx parity test; `shared/api/screenshots.ts` + `ApiRoutes` + `screenshotCap`; bridge
   types (`'image'` chunk, metadata union, `buildImportUrl` kind).
2. **Server routes + entitlements + purge** — `screenshotAccess.ts`; all `screenshot-*` routes;
   `shared-screenshot-get`; `FREE_SCREENSHOT_CAP`; `screenshots.purge-deleted` job; server tests under
   `server/test/screenshots/` (real-Postgres tier, `fakeS3` assertions) + entitlements/jobs tests.
3. **Extension: popup + visible capture + handoff** — `prefs.ts`, header toggle, `ImageCaptureView`,
   `screenshotCapture.ts` (visible mode), `ProjectStorage` screenshot save/load, `background.ts`
   handoff branch, mixpanel events. End-to-end to the `/import` page (stub upload).
4. **Extension: region select** — `regionSelectOverlay.ts`, `captureToast.ts`, content wiring,
   `ensureContentScript`, crop in SW.
5. **Extension: full page** — `fullPageCapture.ts`, driver loop, throttle, stitching/downscale,
   badge progress, cancel paths, tab guards, reopened-popup progress view.
6. **Webapp persistence + import + routing** — `screenshotStorage.ts`, `screenshotService.ts`,
   `dataHash.ts` extraction, meta store, `useExtensionBridge` image chunks, `ImportPage` screenshot
   branch (await upload, cap copy "screenshots"), `screenshotUrls.ts`, `App.tsx` routes, page wrappers.
   Lands on an empty editor shell that loads the doc.
7. **Editor reuse seams** — `DisplayMapperProvider`, `createHistoryBatcher`, `overlay-item/` extraction,
   `createDefaultItemInRect`, `ProjectNameField`/`OverlayItemSettings`/`ProjectCard` props,
   `SharePolicyControls` extraction. Video editor smoke-tested for parity before moving on.
8. **Screenshot editor** — stores, `renderScreenshot`, `geometry.ts` (+ tests), canvas, annotation
   layer, crop layer, toolbar + shortcuts, inspector, header (name/undo/redo), autosave, thumbnail,
   conflict/sync modals.
9. **Export** — PNG, clipboard, PDF (`jspdf` lazy), toasts.
10. **Share** — `ScreenshotShareModal`, publish/re-publish flow, `ScreenshotViewPage`.
11. **Dashboard** — Screenshots view, sidebar item + cap, card reuse, menu actions, Trash merge.
12. **E2E + polish** — `e2e/fixtures/screenshot.ts` seed (service role upload + `screenshot-create`),
    `screenshot.spec.ts` (editor, share dialog, public view), extension mock `kind` option follow-up,
    final lint/tsc across `shared`/`webapp`/`server`/`extension`.

## Verification (end-to-end)

1. `supabase db reset` applies the migration; `npm test` green including new server suites
   (create + screenshot cap, get/list/update CAS 409, share gating, render-upload 409/413/happy path,
   shared-screenshot-get 404/403/null-render/stale, purge job deletes the prefix).
2. Video regression: open an existing project with all four overlay types → identical rendering;
   add/drag/undo overlays; blur correct while zoomed; `ShareModal` unchanged. Record + import a video
   unchanged (bridge compat).
3. Extension (`npm run build:extension:dev`): toggle persists; visible/region/full-page on DPR 1 and 2,
   browser zoom 150 %/67 %, sticky header page, lazy-image page, >50-viewport page (truncated/downscaled
   flag, finishes ≤ ~30 s), Esc mid-capture restores page and opens no tab, restricted pages disabled,
   capture blocked while recording, overlay/toast never in the PNG.
4. Import lands on `/screenshot/{slug}/edit` with the page title as name; editor opens from cache;
   reload after upload restores.
5. Editor: every tool by drag and by click; move/resize; text inline edit; crop apply/reset keeps
   annotation positions; undo/redo; "Saved" indicator; thumbnail on dashboard after one save.
6. Export: PNG dims = crop dims; paste into another app; PDF single page at image size.
7. Share: public in editor → incognito `/screenshot/{slug}` shows the flattened image (blurred regions
   blurred, `source.png` never requested); edit → `stale` clears after re-publish; private → sign-in
   prompt; dashboard share of a never-published screenshot shows "not published".
8. Dashboard: Screenshots view lists only screenshots with badge and no duration; Trash shows both;
   free workspace hits the screenshot cap at 20 with the right copy while videos still count to 5.
9. Playwright `screenshot.spec.ts` green; `editor.spec.ts`, `import.spec.ts`, `smoke.spec.ts` unchanged.

## Follow-ups (not in v1)
Per-user editor grants for screenshots (`screenshot_editors`), keyboard shortcut for capture
(`commands` in manifest), screen/window image capture via `desktopCapture`, horizontal tiling and
inner-scroller full-page, beautify (background/padding/shadow), pen/highlighter/numbered markers,
editor zoom, OG meta for share pages.

## Step log
- Step 1 — completed 2026-09-14. Design changes: `ScreenshotShareResponse` is `{ slug }` only (no
  legacy `isNew`); `screenshot-create` validates `screenshot.source` dims/mode inline (the row columns
  are copied from it); `seedScreenshot` defaults to `share_policy='private'`, `upload_status='ready'`.
  Bridge: `HandoffMetadataResponse` is now a union; the import hook rejects `kind: 'screenshot'` with a
  clear error until Step 6. Migration applied to the local stack with `supabase migration up`.
- Step 2 — completed 2026-09-14. Design changes: no `sharedAccess.ts` extraction (the two tables'
  view checks differ; the ladder is three lines inline); `screenshot-update`'s no-op path does not
  touch `updated_at`; render upload checks `cloud_version` before the S3 put and again as a CAS;
  thumbnail keys use the row's `created_by` prefix. New log keys `screenshot.*` added to the
  `DomainLogFields` catalog in `server/src/logging.ts`. 60 route/job tests green.
- Step 3 — completed 2026-09-14. Design changes: none. Visible-area capture is awaited by the popup;
  region/full page currently answer "not available yet" (Steps 4–5). All screenshot message names,
  storage keys and payload types were added up front in `messageTypes.ts`. `PreRecordingView` now
  merges prefs through `popup/prefs.ts` (it used to overwrite the whole object).
- Step 4 — completed 2026-09-14. Design changes: the region selection promise is resolved from
  `background.ts`'s existing message listener (`onRegionSelected/onRegionCancelled`) instead of a
  second `onMessage` listener; the overlay owns pointer events on its root (no document-level
  capture listeners needed).
- Step 5 — completed 2026-09-14. Design changes: sticky "stuck" detection uses the element's
  natural document offset recorded at scroll 0 (`y + stickyTop > naturalDocTop`) — deterministic,
  no per-tile layout probing. Inner-scroller / pinch-zoomed pages fall back to a visible capture
  silently (the popup is closed by then). Content-script async handlers now `return true`.
  **Superseded 2026-09-15** by `plans/full-page-capture-oneshot.md`: strips (window + up to 3 inner
  scrollers + footer pass), sticky → relative, `opacity`-only hides, header band clip, tile overlap,
  shadow-root walk, `MAX_DIM 32767`. The visible-capture fallback now only applies to pinch zoom and
  pages with nothing to tile.
- Step 6 — completed 2026-09-15. Design changes: the import page AWAITS the source upload before
  navigating (no pending state in the screenshot editor); conflicts go to a new
  `screenshotConflict` slot on `useSyncStatusStore` (the video `conflict` slot and `ConflictModal`
  are project-specific); `CapRecoveryPanel` gained a `kind` prop and lists/deletes screenshots for
  `screenshot_cap_reached`; `ScreenshotService.importScreenshot` downscales sources whose longest
  side exceeds 16384 px. `/screenshot/{slug}/edit` renders a shell that loads the doc + image;
  the view route lands in Step 10. `projectDataHash` moved to `storage/dataHash.ts`.
- Step 7 — completed 2026-09-15. Design changes: `OverlayItemEditor` takes a `batcher` object
  (`HistoryBatcher`) and host-owned `isEditing/onEnterEdit/onExitEdit` instead of reading
  `useOverlayEditorStore`; `createHistoryBatcher` returns a hook-shaped accessor to a stable batcher;
  `ProjectCard` gained `shareUrl`/`badge`/`showDuration` (the `href` name in the plan);
  `SharePolicyControls.tsx` also exports `ShareCreatorRow`, `OwnerOnlyNote`, `Avatar`. Pure refactor:
  tsc clean, lint errors on touched files are the pre-existing ones (moved verbatim), vitest unchanged.
  Browser parity check of the video overlay editor is pending a manual run.
- Step 8 — completed 2026-09-15. Design changes: the canvas provides a `DisplayMapper` over the
  FULL source and offsets the layer wrapper by `-crop × scale` (annotations keep uncropped
  coordinates without a mapper change); the drag preview is a `previewItemRef` whose setter
  schedules a redraw (no rAF loop); crop apply/reset/cancel live in `actions.ts` (toolbar,
  inspector and shortcuts share them); save failures show a "Save failed" badge instead of a
  blocking modal; the first thumbnail is generated on load when the row has none. `geometry.test.ts`
  (14 tests) green; tsc + eslint clean on the module. Manual browser pass pending.
- Step 9 — completed 2026-09-15. Design changes: none. `jspdf@^3` added to the root package.json
  (no workspaces) and lazy-imported; Download is a `Dropdown` (PNG / PDF) next to a Copy button in
  the header. Clipboard/PDF behaviour needs a manual browser pass (Chrome + Safari).
- Step 10 — completed 2026-09-15. Design changes: `publishRenderIfNeeded` (in `publish.ts`) is the
  single publish path (share modal on leaving private / copy link, editor after each save) and
  retries once on 409; the share modal works without an image (dashboard) and explains that the
  render is published from the editor. `/screenshot/{slug}` view page + route added. tsc/eslint clean.
- Step 11 — completed 2026-09-15. Design changes: the screenshot grid is its own
  `ScreenshotsView` (no search/duration filters — those stay video-only); the sidebar's usage bar
  became a `UsageMeter` component rendered once per cap; Trash merges both kinds sorted by deletion
  time. tsc clean; lint parity with HEAD on the dashboard files.
- Step 12 — completed 2026-09-15. Design changes: e2e fixtures seed into the user's DEFAULT
  workspace (`workspace-get-default`) — the oldest one from `workspace-list` is a different, free
  workspace in the local stack, which made the dashboard list empty and `screenshot-share` 403;
  `e2e/fixtures/project.ts` got the same fix (its dashboard test was failing for the same reason).
  The PNG fixture is generated (640×360). `screenshot.spec.ts` (6 tests) + `editor.spec.ts`,
  `import.spec.ts`, `smoke.spec.ts` green against a second stack (webapp 3002 → server 8081 running
  the new routes; the long-running dev server on 8080 predates them and needs a restart). Whole
  vitest run green; extension dev build, server + webapp tsc clean.
  Still pending manual checks: real extension capture on DPR 2 / zoom / sticky pages, Safari
  clipboard + pixelate default, PDF output.

# Screenshots — architecture reference

Current state of the screenshots sub-product as implemented (2026-09-15). This is the map to hand
another agent: what exists, where it lives, and the rules that keep it consistent. History and
per-step decisions are in [screenshots-tiered-plan.md](./screenshots-tiered-plan.md).

## 1. What it is

A screenshot is its own entity (table `screenshots`, routes `screenshot-*`, URLs `/screenshot/…`).
Nothing screenshot-related is called "project". The flow:

```
Extension popup (Image mode) ─► background capture (visible / full page / region)
        ─► IndexedDB (RawScreenshot + PNG blob) ─► new tab /import?id=…&ext=…&kind=screenshot
        ─► webapp bridge handoff ('image' chunks) ─► screenshot-create + TUS upload + confirm
        ─► /screenshot/{slug}/edit  (annotate: text, arrow, line, rect, ellipse, blur/pixelate, crop)
              ├─ autosave (screenshot-update, CAS on cloud_version)
              ├─ thumbnail (screenshot-update-thumbnail) after each save
              ├─ export: clipboard / PNG / PDF (client-side)
              └─ share: policy (screenshot-share) + flattened render (screenshot-render-upload)
        ─► /screenshot/{slug}  public page (shared-screenshot-get → presigned RENDER url only)
        ─► dashboard "Screenshots" section, Trash shows videos + screenshots
```

Guiding rules:
- **Reuse the overlay stack, not the project row.** Annotations are `OverlayItem`s painted by
  `shared/painters/overlayPainter.ts`; persistence mirrors the project routes' patterns.
- **No table access from the client** — everything goes through Fastify routes typed in `shared/api`.
- **The public page never sees the source image.** It serves the flattened render the editor
  uploads, so blur/pixelate is real privacy.
- **Separate free-plan cap** (`FREE_SCREENSHOT_CAP = 20` live screenshots per free workspace).

## 2. Data model

### DB — `public.screenshots`
Migration `supabase/migrations/20260914201211_screenshots_create.sql`, snapshot
`supabase/sql/tables/screenshots.sql`. RLS enabled with no policies (server-only access).

| Column | Notes |
|---|---|
| `id` uuid PK | = the extension's capture id |
| `created_by`, `owner_id`, `workspace_id` | storage prefix is under `created_by`; cap counts `owner_id` |
| `name` | default 'Untitled'; page title truncated to 40 chars at import |
| `screenshot_data` jsonb | the `ScreenshotDoc` (editor document) |
| `source_storage_path`, `width_px`, `height_px`, `capture_mode`, `page_url`, `page_title` | authoritative copies of `doc.source` so routes never parse JSON |
| `thumbnail_storage_path` | null until the editor uploads one |
| `upload_status` `pending`/`ready` | confirm-upload flips it; lists only show `ready` |
| `cloud_version` | compare-and-set on every update |
| `slug` unique, DB default | permanent; `/screenshot/{slug}` |
| `share_policy` `private`/`workspace`/`public`, `workspace_access` `view`/`edit` | policy-only sharing (no per-user grants table) |
| `render_storage_path`, `render_cloud_version` | the published render + the version it was made from; `stale` = differs from `cloud_version` |
| `deleted_at`, `permanently_deleted` | soft delete + purge job |

### Storage (bucket `project-media`)
```
{createdBy}/screenshots/{screenshotId}/source.png
{createdBy}/screenshots/{screenshotId}/thumbnail.webp
{createdBy}/screenshots/{screenshotId}/renders/v{cloudVersion}.png
```
First folder = user id satisfies the TUS RLS policy and the `/storage-download-urls` prefix rule.

### Shared types — `shared/types/screenshot.ts`
- `RawScreenshot` — the extension's capture result (`kind: 'screenshot'`, `image`, `page`,
  `captureMode`, optional `region` / `fullPage` info). `RawCaptureItem = RawRecording | RawScreenshot`;
  `isRawScreenshot()` discriminates (recordings have no `kind`).
- `ScreenshotDoc` — `{ id, schemaVersion, source, cropPx: Rect | null, annotations: OverlayItem[],
  annotationDefaults }`. **All coordinates are UNCROPPED source pixels.** The crop is a view, never
  applied destructively; annotations outside it are hidden, not deleted. `schemaVersion` is
  `SCREENSHOT_SCHEMA_VERSION` (1) in `webapp/src/screenshot/core/createScreenshotDoc.ts`;
  migrations live in `core/migrateScreenshotDoc.ts` (same rules as `migrateProject.ts`).
- `AnnotationDefaults` = the four `*Defaults` of `OverlaySettings` (same values as the video
  overlay defaults in `core/Project.ts`).

### Overlay type extensions — `shared/types/overlay.ts` (all optional, video JSON untouched)
`ArrowOverlayItem.headStyle?: 'arrow' | 'none'` (line) · `BorderOverlayItem.shape?: 'rect' | 'ellipse'`
· `BlurOverlayItem.mode?: 'blur' | 'pixelate'` (`blurRadiusPx` = cell size when pixelating).
`OverlayItemType` is still `'blur'|'text'|'arrow'|'border'`, so the item editor, inspector and
labels needed no new cases.

## 3. Server

### Contract — `shared/api/screenshots.ts`
TypeBox schemas ARE the server's runtime validation and, via `ApiRoutes` in `shared/api/index.ts`,
the webapp's compile-time types (`invokeFunction('screenshot-…', body)` is fully typed). Multipart
routes (`screenshot-update-thumbnail`, `screenshot-render-upload`) are unmapped and use
`invokeFunctionUpload`. `CloudScreenshot` / `CloudScreenshotSummary` are the snake_case wire rows.

### Routes — `server/src/routes/screenshots/` (+ `routes/sharedScreenshotGet.ts`), all `POST`
| Route | Rule |
|---|---|
| `/screenshot-create` | member of workspace; live `COUNT(*)` of owner's screenshots vs `entitlements.screenshotCap` → 403 `{ error: 'screenshot_cap_reached', cap }`; stamps `source.storagePath`; upserts `pending`; returns `{ screenshotId, slug, bucket, storagePath }` |
| `/screenshot-confirm-upload` | owner; `pending → ready` |
| `/screenshot-get` | `{ screenshotId } \| { slug }`; editor access; bumps `last_accessed_at`; returns full row (`screenshot_data` untouched — no response schema) |
| `/screenshot-list` | `{ workspaceId }`; member; ready + not permanently deleted (INCLUDING soft-deleted, the client splits Trash) |
| `/screenshot-update` | `{ screenshotId, screenshotData, expectedVersion? }`; md5 no-op short-circuit (does not touch `updated_at`); CAS → `{ cloudVersion: null }` on conflict |
| `/screenshot-rename` | editor access |
| `/screenshot-delete` / `/screenshot-restore` | owner; restore gated by `entitlements.canRestore` |
| `/screenshot-share` | owner; `canShare` required unless going `private` |
| `/screenshot-update-thumbnail` | multipart ≤ 500 KB webp; key under `created_by` |
| `/screenshot-render-upload` | multipart `{ screenshotId, cloudVersion, file }` ≤ 25 MB; 409 `version_mismatch` if `cloudVersion` isn't current (checked before the put and again as a CAS); deletes the previous render best-effort |
| `/shared-screenshot-get` | `optionalUser`, 60/min; public → anyone; `workspace` → member (403 `auth_required` when signed out); else 404; returns `{ name, userName, widthPx, heightPx, imageUrl (presigned render or null), stale }` |

Access helpers: `server/src/services/screenshotAccess.ts` — `canEditScreenshot` (owner, or
non-viewer member when shared with `workspace_access = 'edit'`), `canViewScreenshot`,
`screenshotStoragePrefix`. Entitlements: `server/src/services/entitlements.ts` (`screenshotCap`:
20 on free, null on trial/pro). Purge: `server/src/jobs/screenshotsPurgeDeleted.ts`
(`screenshots.purge-deleted`, daily, 30 days, deletes the storage prefix then flips
`permanently_deleted`). Log keys `screenshot.*` are in the `DomainLogFields` catalog
(`server/src/logging.ts`) — add new ones there or TypeScript fails.

Tests: `server/test/screenshots/*.test.ts`, `server/test/sharedScreenshotGet.test.ts`,
`server/test/jobs/screenshotsPurgeDeleted.test.ts`; seed helper `seedScreenshot()` in
`server/test/helpers/db.ts`. They need the local Postgres (`describe.runIf(hasTestDb())`).

## 4. Extension

- **Popup** — `MultiToggle` video/image in `popup/PopupApp.tsx` (mode persisted through
  `popup/prefs.ts`); `popup/ImageCaptureView.tsx` has the three capture rows and the
  in-progress view (progress + Cancel) fed by `STORAGE_KEYS.SCREENSHOT_STATE`. Capturable-tab check:
  `popup/activeTab.ts`. Messages/types: `shared/messageTypes.ts` (`POPUP_CAPTURE_SCREENSHOT`,
  `BACKGROUND_CONTENT_*`, `CONTENT_REGION_*`, `ScreenshotState`, …).
- **Background** — `background/screenshotCapture.ts` owns the session: `startScreenshot(mode)`,
  throttled `captureVisibleTab` (≥ 510 ms apart — Chrome allows 2/s), crop with `OffscreenCanvas`
  inside the service worker, badge `%` progress, cancel via popup / tab close / Esc, errors → badge
  `!` + `SCREENSHOT_ERROR`. `persistAndOpen` saves `RawScreenshot` + blob `shot-<id>-image` in the
  existing IndexedDB stores (`storage/projectStorage.ts`) and opens
  `buildImportUrl(id, extId, 'screenshot')`. `background.ts` branches the handoff on `isRawScreenshot`
  and streams `ChunkPayload.source = 'image'`.
- **Full page** (design: `plans/full-page-capture-oneshot.md`) — captured as **strips**: the window,
  then up to 3 inner scrollers (Gmail's thread list, Reddit's rails), then a footer pass for
  bottom-anchored fixed elements. Pure planning in `shared/fullPagePlan.ts` (tile targets with
  `ceil(dpr)` overlap, fixed-header band clip, canvas layout with strip-owned regions + fills, draw
  ops; unit-tested) and `background/fullPageStitcher.ts` (OffscreenCanvas, even-odd clip-outs,
  copy-grow, `MAX_DIM 32767` / `MAX_PIXELS 80e6`). Page side `content/fullPageCapture.ts` +
  `content/fullPage/*`: sticky → `position: relative` for the session, fixed elements classified
  (header / bottom / other / skip) and hidden with `opacity: 0` only (never `visibility` — pages
  override it), per-tile re-walk through open shadow roots, scroller finder, DOM-sampled fill colours.
  Height adopted after tiles 1–2 then frozen; `MAX_TILES = 50` across strips.
- **Content scripts** (vanilla DOM, no React) — `content/regionSelectOverlay.ts` (SVG evenodd mask,
  Esc/Enter, removed + `afterRepaint()` before capture so it never appears in the PNG),
  `content/captureToast.ts` (hidden with `display: none` before every capture),
  `content/fullPage/captureTiming.ts`. Wiring in `content/content.ts`.

## 5. Webapp

### Routes — `webapp/src/App.tsx` + `webapp/src/lib/screenshotUrls.ts`
`/screenshot/{slug}/edit` → `pages/ScreenshotEditorPage.tsx`; `/screenshot/{slug}` →
`pages/ScreenshotViewPage.tsx`. Both ungated (the editor prompts for auth itself; 403 on the
editor redirects to the view page). Helpers: `screenshotEditPath`, `screenshotViewPath`,
`screenshotUrl` (absolute, for copy link), `SCREENSHOT_EDIT_PATH` regex.

### Import — `pages/import/`
`useExtensionBridge.ts` exposes `kind`, `screenshot`, `image` on the handoff state and reassembles
`'image'` chunks. `ImportPage.tsx` → `performScreenshotUpload` → `ScreenshotService.importScreenshot`
(AWAITS the TUS upload; no pending state in the editor) → `navigate(screenshotEditPath(slug))`.
Cap refusal → `CapRecoveryPanel kind="screenshot"`.

### Module map — `webapp/src/screenshot/`
| File | Role |
|---|---|
| `api/screenshotStorage.ts` | transport: one static method per route; throws; `ScreenshotVersionConflictError` |
| `screenshotService.ts` | orchestration: `importScreenshot` (downscales sides > 16384 px, caches the PNG in `BlobCache`), `loadScreenshot` (migrate doc, row columns override `doc.source`, object URL), `saveScreenshot` (SHA-256 no-op skip, in-flight guard, CAS → `useSyncStatusStore.screenshotConflict`), `forceSave`, `saveThumbnail` (content-hash dedupe), `publishRender` (409 → null), list/thumbnails/rename/delete/restore/share; `ScreenshotShareMeta`, `ScreenshotListItem`, `readScreenshotCapError` |
| `core/createScreenshotDoc.ts`, `core/migrateScreenshotDoc.ts` | doc factory, defaults, `fitSourceImage`, migrations |
| `store/useScreenshotStore.ts` | zustand + zundo (`partialize { doc }`, JSON equality, limit 50); `addAnnotation`, `updateAnnotation`, `removeAnnotation`, `moveAnnotation` (z-order), `setCrop`, `updateDefaults`; `replaceScreenshotDoc` (load without history); 2 s debounced autosave subscription; `flushScreenshotSave` on unmount; `useScreenshotHistoryBatcher` |
| `store/useScreenshotUIStore.ts` | `tool`, `selectedId`, `isEditingText`, `cropDraft` |
| `store/useScreenshotMetaStore.ts` | row metadata for share/publish (outside history) |
| `geometry.ts` (+ test) | hit-testing (topmost first, arrow tolerance, ellipse), bounds, `centerItemAt`, `fitScale`, `thumbnailRect` (top 16:9 band), `effectiveCrop`, `screenshotScales` |
| `render/renderScreenshot.ts` | **the single renderer**: source view + `drawOverlayItem` per annotation; `renderToCanvas`, `renderToPngBlob`, `renderThumbnail`, `supportsCanvasFilter` |
| `actions.ts` | `chooseTool`, `startCrop` / `applyCrop` / `resetCrop` / `cancelCrop`, `deleteSelected` |
| `useScreenshotShortcuts.ts` | V T A L R O B C, Delete, Esc, Enter (apply crop), ⌘Z / ⇧⌘Z |
| `publish.ts` | `publishRenderIfNeeded(image, doc)`: skip when private or already current; render → upload; one retry on 409; updates meta |
| `export/exportScreenshot.ts` | clipboard (`ClipboardItem` with a Blob promise — keeps Safari's gesture), PNG download, PDF via lazy `import('jspdf')` (px units, bands of ≤ 19200 px) |
| `ScreenshotEditor.tsx` | bootstrap (auth wait, load, decode image), layout, thumbnail on load when the row has none + after every save, re-publish after saves while shared |
| `components/ScreenshotCanvas.tsx` | canvas at crop resolution scaled to fit width; rAF-coalesced redraws; `previewItemRef` whose setter schedules a redraw; pointer handling for select / drag-to-create; provides the `DisplayMapper` |
| `components/AnnotationLayer.tsx` | shared `OverlayItemEditor` for the selection, `constraintBounds` = crop |
| `components/CropLayer.tsx` | `DimmedOverlay` + `BoundingBox` over the full source |
| `components/ScreenshotToolbar.tsx`, `ScreenshotInspector.tsx`, `ScreenshotHeader.tsx` | tool rail; crop panel / item settings (+ Blur·Pixelate, Rect·Ellipse, Arrow·Line toggles, z-order, delete) / info; header with undo/redo, `SaveStatusBadge`, name field, action slot, user menu |
| `components/ScreenshotExportActions.tsx`, `ScreenshotShareButton.tsx`, `ScreenshotShareModal.tsx`, `ScreenshotConflictModal.tsx` | header actions, share (gated by `entitlements.canShare`), conflict resolution |

Dashboard: `pages/dashboard/ScreenshotsView.tsx` (grid of `ProjectCard`s with an image badge),
`DashboardSidebar.tsx` ("Screenshots" item + `UsageMeter` per cap), `DashboardPage.tsx` (loads
`screenshot-list`, handlers, merged Trash, share modal without an image).

### Coordinate systems and scales (the part that bites)
- Annotation coords = uncropped source px. The canvas shows `view = doc.cropPx ?? full source`
  (full source while the crop tool is active). The renderer draws the view at 1:1 and runs the
  painter with `translate(-view.x, -view.y)` and `viewport = view`, so `drawOverlayItem` works
  unchanged (blur/pixelate project through `viewport` themselves).
- The canvas provides `DisplayMapper(sourceSize, sourceSize × scale)` and offsets the layer
  wrapper by `-crop × scale`, so `BoundingBox`, arrow handles and the inline text editor (all
  `useDisplayMapper` consumers) work without knowing about the crop.
- `effectScale = textScale = view.width / 1920` (`screenshotScales`), width-based so tall pages
  don't inflate shadows/padding. The inline text editor gets the same `textScale` as the painter.
- A selected text item is skipped by the canvas painter (rendered as HTML by the inline editor),
  same as the video editor.
- New blur items default to `pixelate` where `ctx.filter` is unsupported (Safari < 18).

### Seams shared with the video editor (Step 7 — keep them behaviour-neutral)
- `editor/hooks/useDisplayMapper.ts` — `DisplayMapperProvider`; the hook returns the provided
  mapper or the store-derived one.
- `editor/hooks/useHistoryBatcher.ts` — `createHistoryBatcher(getTemporal)`; the video hook is
  `createHistoryBatcher(() => useProjectStore.temporal)`.
- `editor/components/canvas/overlay-item/` — `OverlayItemEditor`, `ArrowPointHandles`,
  `InlineTextEditor` with explicit props (`item, updateItem, batcher, previewItemRef, textScale,
  constraintBounds?, isEditing, onEnterEdit, onExitEdit`); no store reads. `CanvasOverlayEditor.tsx`
  is the thin video wrapper.
- `editor/overlay/defaultItems.ts` — `createDefaultItemInRect(type, area, defaults)`;
  `createDefaultItem` wraps it (still re-exported from `OverlayInspector.tsx`).
- `OverlayInspector.tsx` exports `OverlayItemSettings`; `header/ProjectNameField.tsx` accepts
  `value/onCommit/placeholder/ariaLabel/inputId`; `dashboard/ProjectCard.tsx` accepts
  `shareUrl/badge/showDuration`; `share/SharePolicyControls.tsx` holds the policy/access rows,
  `ShareCreatorRow`, `OwnerOnlyNote` used by both share modals.

### Sync status
`storage/syncStatusStore.ts`: `status` drives the header badge (Saving… / Saved / Save failed);
`screenshotConflict` (separate from the project `conflict` slot) drives `ScreenshotConflictModal`.
`lastSyncedAt` changes trigger thumbnail + re-publish in `ScreenshotEditor`.

### Analytics — `webapp/src/analytics/index.ts`
`screenshot_created`, `screenshot_editor_loaded`, `screenshot_exported` (format png/pdf/copy),
`screenshot_shared`, `screenshot_view_page_loaded`; extension: `trackScreenshotCaptured`,
`trackScreenshotError` in `extension/src/utils/mixpanel.ts`.

## 6. Tests and how to run them
- Unit: `npx vitest run webapp/src/screenshot shared` (geometry, painter parity + variants).
- Server: `server/test/screenshots/**` against the local `supabase start` Postgres.
- E2E: `e2e/tests/screenshot.spec.ts` (editor load, tool + autosave, share → public page in a
  signed-out context, dashboard section, extension handoff). Fixtures: `e2e/fixtures/screenshot.ts`
  (`seedScreenshot` — seeds into the user's DEFAULT workspace via `workspace-get-default`),
  `e2e/fixtures/assets/screenshot.png` (generated 640×360), `installExtensionMock(page, { kind: 'screenshot' })`.
  If the running dev API predates the routes, run a second stack:
  `PORT=8081 npx tsx --env-file=.env.local src/server.ts` (in `server/`) and
  `VITE_API_URL=http://localhost:8081 npx vite --port 3002` (in `webapp/`), then
  `E2E_WEBAPP_PORT=3002 E2E_API_URL=http://localhost:8081 npm run test:e2e -- screenshot.spec.ts`.

## 7. Conventions when extending
- Never name anything screenshot-related "project"; routes are `screenshot-*`, ids are
  `screenshotId`, storage lives under `…/screenshots/…`.
- Adding a doc field: bump `SCREENSHOT_SCHEMA_VERSION`, add a `version < N` block or a
  version-independent backfill in `migrateScreenshotDoc.ts`.
- Adding a route: schema in `shared/api/screenshots.ts`, entry in `ApiRoutes`, log keys in
  `server/src/logging.ts`, route file + registration in `server/src/app.ts`, test under
  `server/test/screenshots/`.
- Anything that paints must go through `renderScreenshot` so canvas, thumbnail, export and the
  published render stay pixel-identical.
- UI follows `.claude/skills/ui-guidelines` (semantic tokens, `Button`/`Dropdown`/`MultiToggle`,
  `lu` icons with `tb` fallback for `TbBlur`, aria-labels on icon buttons).

## 8. Not in v1 (follow-ups)
Per-user editor grants (`screenshot_editors`), capture keyboard shortcut, screen/window image
capture via `desktopCapture`, horizontal tiling and inner-scroller full page, beautify
(background/padding/shadow), pen/highlighter/numbered markers, editor zoom (the `DisplayMapper`
seam makes it a later multiplier), OG meta on the share page.

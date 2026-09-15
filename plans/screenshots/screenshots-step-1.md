# Screenshots — Step 1: DB + shared contracts

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
Land everything the server, webapp and extension steps build on, without changing any runtime
behaviour of the video product: the `screenshots` table, the shared types and API schemas, the
overlay painter's per-item entry point (+ line / ellipse / pixelate variants), the `screenshotCap`
entitlement field, and the bridge payload shape for screenshot handoff.

## Changes

### DB
- `supabase/migrations/20260914201211_screenshots_create.sql` — table per the tiered plan, partial
  index on `workspace_id`, RLS enabled with no policies (current practice: server-only access).
- `supabase/sql/tables/screenshots.sql` — reference snapshot in the dump format.
- `server/test/helpers/db.ts` — `seedScreenshot()` / `deleteScreenshots()` mirroring `seedProject`.

### Shared types
- `shared/types/screenshot.ts` — `ScreenshotCaptureMode`, `RawScreenshot`, `RawCaptureItem`,
  `isRawScreenshot`, `ScreenshotDoc`, `ScreenshotSource`, `AnnotationDefaults`. Exported from
  `shared/types/index.ts`.
- `shared/types/overlay.ts` — optional `headStyle` (arrow), `shape` (border), `mode` (blur).

### Painter
- `shared/painters/overlayPainter.ts` — export `OverlayPaintContext` + `drawOverlayItem(ctx, item,
  paint)`; `drawOverlays` unchanged in signature and output (builds the same scales it used to).
  `drawText` takes `textScale`; `drawArrow` honours `headStyle: 'none'`; `drawBorder` honours
  `shape: 'ellipse'`; `drawBlur` delegates to `drawPixelate` for `mode: 'pixelate'`. `wrapLines`
  exported (screenshot hit-testing needs text height).
- `shared/painters/overlayPainter.test.ts` — recording-stub ctx: legacy items produce the same call
  sequence via `drawOverlays` as via `drawOverlayItem` with video scales; `headStyle:'none'` never
  fills; `shape:'ellipse'` calls `ellipse`; `mode:'pixelate'` disables smoothing.

### API contract
- `shared/api/screenshots.ts` — request/response schemas for every `screenshot-*` route +
  `CloudScreenshot`, `CloudScreenshotSummary` wire interfaces.
- `shared/api/index.ts` — `ApiRoutes` entries for the JSON routes (multipart routes stay unmapped,
  like `project-update-thumbnail`).
- `shared/api/entitlements.ts` + `server/src/services/entitlements.ts` — `screenshotCap`
  (`FREE_SCREENSHOT_CAP = 20`, null when paid). Tests asserting the full entitlements object updated.

### Bridge
- `shared/types/bridge.ts` — `ChunkPayload.source` += `'image'`; `HandoffMetadataResponse` becomes a
  union (`kind?: 'recording'` legacy | `kind: 'screenshot'`); `buildImportUrl(id, extId, kind?)`.
- `webapp/src/pages/import/useExtensionBridge.ts` and `extension/src/background/background.ts` —
  minimal type narrowing so both still compile (behaviour unchanged; real handling is Steps 3 and 6).

## Verification
- `npx vitest run shared/painters server/test/entitlements.test.ts` green.
- `npx tsc --noEmit -p server`, `-p webapp`, `-p extension` green.
- `supabase db reset` applies the migration (when a local stack is running).

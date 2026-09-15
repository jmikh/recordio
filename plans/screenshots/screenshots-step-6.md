# Screenshots — Step 6: Webapp persistence + import + routing

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
The webapp can receive a screenshot from the extension, create the row, upload the PNG, and open a
`/screenshot/{slug}/edit` shell that loads the document and shows the image. Everything the editor
(Step 8), export (9), share (10) and dashboard (11) need from the persistence layer exists here.

## Files
- `webapp/src/lib/screenshotUrls.ts` — `screenshotEditPath`, `screenshotViewPath`, `screenshotUrl`.
- `webapp/src/storage/dataHash.ts` — SHA-256 of a JSON-serialisable value; `CloudProjectService`
  now uses it too (behaviour unchanged).
- `webapp/src/screenshot/core/createScreenshotDoc.ts` (+ `SCREENSHOT_SCHEMA_VERSION = 1`, the
  annotation defaults, the 16384 px side guard) and `core/migrateScreenshotDoc.ts`.
- `webapp/src/screenshot/api/screenshotStorage.ts` — transport over the `screenshot-*` routes.
- `webapp/src/screenshot/screenshotService.ts` — import / load / save (hash skip, in-flight guard,
  CAS → conflict) / thumbnail / publish / list / delete / restore / rename / share.
- `webapp/src/screenshot/store/useScreenshotMetaStore.ts` — share meta outside undo history.
- `webapp/src/screenshot/ScreenshotEditor.tsx` (shell) + `webapp/src/pages/ScreenshotEditorPage.tsx`
  + the `/screenshot/{slug}/edit` route in `App.tsx`.
- `webapp/src/pages/import/useExtensionBridge.ts` — `'image'` chunks, `kind`/`screenshot`/`image`
  on the handoff state.
- `webapp/src/pages/import/ImportPage.tsx` — screenshot branch (awaits the upload, cap copy),
  `CapRecoveryPanel` gets a `kind` prop and lists/deletes screenshots when relevant.
- `webapp/src/analytics/index.ts` — `trackScreenshotCreated`, `trackScreenshotEditorLoaded`.

## Decisions
- The screenshot id is the extension's capture id (like recordings), so `HANDOFF_COMPLETE` matches.
- The import page AWAITS the TUS upload before navigating (no pending-state handling in the editor).
- Conflicts set a new `useSyncStatusStore.screenshotConflict` slot (the video `conflict` slot is
  read by the project `ConflictModal`); the screenshot editor gets its own small conflict modal in
  Step 8.

## Outcome (2026-09-15)
- `npx tsc -b` in `webapp/` clean; new files lint-clean; `ImportPage.tsx` keeps only its three
  pre-existing lint errors. Browser walkthrough (capture → /import → editor shell) is pending a
  manual run with the dev extension.

## Verification
- `npx tsc -b` in `webapp/` clean; capture a screenshot with the dev extension → `/import` shows
  "Receiving screenshot" → "Saving screenshot…" → lands on `/screenshot/{slug}/edit` showing the image.

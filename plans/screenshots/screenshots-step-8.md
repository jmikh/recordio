# Screenshots — Step 8: Screenshot editor

Parent: [screenshots-tiered-plan.md](./screenshots-tiered-plan.md)

## Goal
`/screenshot/{slug}/edit` is a working annotation editor: drag-to-create text / arrow / line /
rect / ellipse / blur, move / resize / edit via the shared overlay-item kit, non-destructive crop,
undo/redo, autosave with a "Saved" badge, thumbnail after saves, conflict modal.

## Files (`webapp/src/screenshot/`)
- `store/useScreenshotStore.ts` — zustand + zundo (`partialize { doc }`, JSON equality, limit 50);
  `loadDoc`, `setName`, `addAnnotation`, `updateAnnotation`, `removeAnnotation`, `moveAnnotation`
  (z-order), `setCrop`, `updateDefaults`; `useScreenshotHistory`, `useScreenshotHistoryBatcher`
  (`createHistoryBatcher` over the temporal store); 2 s debounced autosave subscription →
  `ScreenshotService.saveScreenshot`; `flushScreenshotSave()` for unmount.
- `store/useScreenshotUIStore.ts` — `tool`, `selectedId`, `isEditingText`, `cropDraft`.
- `geometry.ts` (+ `geometry.test.ts`) — `normalizeRect`, `clampRectToBounds`, `distanceToSegment`,
  `pointInEllipse`, `annotationBounds`, `hitTestAnnotations` (topmost first), `translateItem`,
  `fitScale`, `thumbnailRect` (top 16:9), `effectiveCrop`, `screenshotScales` (`width / 1920`).
- `render/renderScreenshot.ts` — pure: cropped source + `drawOverlayItem` per annotation with
  `{ outputSize: view, viewport: view, effectScale, textScale }` after `translate(-view.x, -view.y)`;
  `skipItemId` (text being edited), `overrideItem` (drag preview), `extraItem` (create draft);
  `renderToCanvas`, `renderThumbnail` (480 px webp of the top 16:9 region), `supportsCanvasFilter`.
- `components/ScreenshotCanvas.tsx` — fit-to-width canvas at crop resolution, rAF redraws, a
  `previewItemRef` whose setter schedules a redraw, pointer handling for select / drag-to-create,
  `DisplayMapper(sourceSize, sourceSize × scale)` provided to the layers; the layer wrapper is offset
  by `-crop × scale` so uncropped item coordinates line up.
- `components/AnnotationLayer.tsx` — `OverlayItemEditor` for the selection (`constraintBounds` = crop).
- `components/CropLayer.tsx` — `DimmedOverlay` + `BoundingBox` over the full source while cropping.
- `components/ScreenshotToolbar.tsx` — V T A L R O B C.
- `components/ScreenshotInspector.tsx` — crop actions / `OverlayItemSettings` + variant toggles +
  z-order + delete / image info.
- `components/ScreenshotHeader.tsx` — logo, undo/redo, `SaveStatusBadge`, `ProjectNameField`
  (`value`/`onCommit` → rename), action slots for Steps 9–10, `UserMenu`.
- `components/ScreenshotConflictModal.tsx` — load cloud / overwrite via `ScreenshotService`.
- `useScreenshotShortcuts.ts` — tools, Delete, Escape, Enter (apply crop), ⌘Z / ⇧⌘Z.
- `ScreenshotEditor.tsx` — bootstrap (auth, load, image decode), layout, thumbnail on load
  (when the row has none) and after each successful save.

## Decisions
- Annotations stay in uncropped source px; the crop is only a view (`cropPx`). Items are
  constrained to the crop while dragging; items outside are hidden, not deleted.
- New blur items default to `pixelate` where `ctx.filter` is unsupported (Safari < 18).
- `effectScale = textScale = viewWidth / 1920` (width-based so tall pages don't inflate).
- Save errors show as a "Save failed" badge (next change retries); no blocking modal.

## Verification
- `geometry.test.ts` green; tsc/eslint clean on new files.
- Manual: each tool by drag and click; move/resize; text edit; crop apply/reset; undo/redo one step
  per drag; "Saved" after 2 s; dashboard thumbnail after a save (Step 11 shows it).

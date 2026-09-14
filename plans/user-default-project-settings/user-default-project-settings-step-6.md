# Step 6 — Review round 1 (Personal Settings trims + previews)

**Parent:** [`user-default-project-settings-tiered-plan.md`](user-default-project-settings-tiered-plan.md) §3.6–3.8
**Started:** 2026-09-14

## Goal

Apply the first review of the Personal Settings page: fewer per-recording controls on the
defaults page, effect demos aimed at the sample's top-left card, an auto-shrink preview, and
the drag effect retired from the UI.

## Work

1. **Auto-shrink preview** — `DemoKind` gains `'shrink'`; it plays the zoom clip (the camera
   animator shrinks the bubble while a zoom is active). `CameraSettings` shows a Preview
   button next to *Auto Shrink* in template mode.
2. **Demo target** — `SAMPLE_CARD_RECT` / `SAMPLE_CARD_RADIUS_PX` in `sampleMedia.ts`
   (the top-left card of the sample screen, measured from the placeholder). The click and
   the zoom centre on it; the spotlight frames it.
3. **Camera tab (defaults page)** — no Position corner picker, no Crop Zoom, no Mirror
   (all per recording). The Size slider stays. `cameraCorner.ts` keeps only what the slider
   needs.
4. **Motion tab** — Camera move and Overlays cards removed. Cards are now *Zoom* (toggle
   *Auto-zoom*) and *Spotlight* (toggle *Auto-spotlight*).
5. **Audio tab** — removed from the defaults page; `AudioSettings.tsx` is back to HEAD.
6. **"Playing …" badge** — lives in a fixed-height row (28 px) right above the canvas,
   centred; the row is always in the layout, so showing the badge never moves the canvas
   (`DefaultsPreview.tsx`).
7. **Drag effect** — `mouseDragEnabled` defaults to `false` (`createDefaultSettings`, the
   store's legacy-settings backfill, the panel fallback) and the *Drag Effect* toggle is gone
   from `EffectsSettings` in both the editor and the defaults page. The renderer still honours
   the flag, so projects saved with `true` keep drawing drags — see the open question below.
8. **Page header** — aspect-ratio dropdown and undo/redo removed. `Header.tsx` is back to
   HEAD plus the *Use as my default settings* button (the `aspectRatioOptions.tsx` extraction
   is gone).

## Open question

Existing projects with `mouse.mouseDragEnabled: true` have no UI to turn it off. Options:
a schema migration (v7) that forces it to `false`, or leave stored projects as they are.
Not done in this step — the user's call.

## Verification

- webapp `tsc -b` clean; eslint findings on touched files equal to or fewer than HEAD.
- `npx vitest run webapp/src/core` 34/34 (`effectDemos.test.ts` +1: shrink = zoom clip;
  spotlight rect = `SAMPLE_CARD_RECT`).
- Playwright `personal-settings.spec.ts` 3/3 against the running local stack (server 8080 now
  serves the defaults routes): tab list without Audio, no Undo / aspect-ratio / Drag Effect /
  Mirror controls, click + auto-zoom + auto-shrink previews play and the still returns,
  round-trip now flips *Auto-zoom* instead of the aspect ratio.
- Browser screenshots: canvas bounding box identical before and during a demo (badge row).

## Files changed

- `webapp/src/core/sampleMedia.ts` (card rect + radius; click point = card centre), `effectDemos.ts` (`'shrink'`, card-targeted spotlight), `effectDemos.test.ts`
- `webapp/src/core/Project.ts`, `webapp/src/editor/stores/useProjectStore.ts` — `mouseDragEnabled: false`
- `webapp/src/editor/components/settings/CameraSettings.tsx`, `cameraCorner.ts`, `EffectsSettings.tsx`
- `webapp/src/editor/components/settings/AudioSettings.tsx` — reverted to HEAD
- `webapp/src/editor/components/header/Header.tsx` — reverted to HEAD + `SetAsDefaultsButton`; `aspectRatioOptions.tsx` deleted
- `webapp/src/pages/settings/personal/MotionDefaultsSettings.tsx`, `DefaultsSettingsPanel.tsx`, `PersonalSettingsPage.tsx`, `DefaultsPreview.tsx`
- `e2e/tests/personal-settings.spec.ts`

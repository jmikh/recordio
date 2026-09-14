# Step 7 — Review round 2 (schema v7, auto-generate flags, Motion tab in the editor)

**Parent:** [`user-default-project-settings-tiered-plan.md`](user-default-project-settings-tiered-plan.md) §3.6–3.8
**Started:** 2026-09-14

## Goal

Three follow-ups from the second review: retire the drag effect for stored projects too,
make "Auto-zoom" mean generation only (never the track), and bring the Motion settings into
the editor with one "apply to all" per inspector.

## Work

1. **Schema v7** (`CURRENT_SCHEMA_VERSION = 7`, `migrateProject.ts`): forces
   `mouse.mouseDragEnabled = false` and backfills `zoom.autoGenerate` /
   `spotlight.autoGenerate = true` where missing. Stored personal defaults ride the same
   migration. Tests: `migrateProject.test.ts` (+2).
2. **`autoGenerate` flags** (`shared/types/settings.ts`, optional, default true): gate only
   the first-open generation in `useProjectStore.loadProject`. The existing `enabled` flags
   stay the timeline track toggles (renderer, tracks, header eye icon untouched).
   `stripRecordingSpecificSettings` now forces every `enabled` (zoom, spotlight, camera move,
   overlay) to `true`, so a default can never disable a track.
3. **Motion tab in the editor** — `editor/components/settings/MotionSettings.tsx` replaces
   `pages/settings/personal/MotionDefaultsSettings.tsx`; `'motion'` joins `SettingsPanelTab`
   and `SETTINGS_NAV_ITEMS` (after Effects), so the Personal Settings page inherits it.
   - Editor: Transition / Easing / Enlarge / Dim go through the new store actions
     `applyZoomSettingsToAll` / `applySpotlightSettingsToAll` — one undo step that updates
     the project default and every existing segment. Max zoom is a default only (used on
     regenerate; the hint says so). *Regenerate Auto Zooms / Spotlights* and *Delete All*
     moved here from the inspectors.
   - Personal Settings: the same cards plus the *Auto-zoom* / *Auto-spotlight* toggles
     (bound to `autoGenerate`) and the Preview buttons. No Regenerate / Delete All there.
   - Collapsed state persists via `showCollapsibleZoom` / `showCollapsibleSpotlight` in
     `useUIStore`.
4. **Inspectors** (`ZoomInspector.tsx`, `SpotlightInspector.tsx`): one *Apply to all*
   checkbox (unchecked on mount) instead of one per setting. Checking it arms later edits —
   it does not push the selected segment's current values to the others. Enlarge is now
   covered by apply-to-all as well. *Delete This* stays; a one-line hint points to the
   Motion tab for the bulk actions. `easingOptions.ts` holds the shared easing list.

## Verification

- webapp `tsc -b` clean; eslint findings on touched files equal to or fewer than HEAD; the
  new files lint clean.
- `npx vitest run webapp/src/core` 36/36 (`projectDefaults.test.ts` updated: a stored
  `cameraMove.enabled: false` now resolves to `true`).
- Playwright `personal-settings.spec.ts` 3/3 (the round-trip flips *Auto-zoom*, which is
  now `zoom.autoGenerate`).
- Browser screenshots of the editor Motion tab and the zoom inspector.

## Files changed

- `shared/types/settings.ts` — `autoGenerate?` on `ZoomSettings` / `SpotlightSettings`
- `webapp/src/core/Project.ts` (v7, factory flags), `migrateProject.ts` (+ v7), `migrateProject.test.ts`, `projectDefaults.ts` (track toggles forced on), `projectDefaults.test.ts`
- `webapp/src/editor/stores/useProjectStore.ts` (legacy backfill, first-open gating), `useUIStore.ts` (`'motion'` tab, two collapsible keys), `slices/zoomActionSlice.ts`, `slices/spotlightSlice.ts` (apply-to-all actions)
- `webapp/src/editor/components/settings/MotionSettings.tsx` (new), `easingOptions.ts` (new), `settingsNavItems.ts`, `SettingsPanel.tsx`, `ZoomInspector.tsx`, `SpotlightInspector.tsx`
- `webapp/src/pages/settings/personal/DefaultsSettingsPanel.tsx`; `MotionDefaultsSettings.tsx` deleted

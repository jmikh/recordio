# Step 3 — Editor "Use as my default settings"

**Parent:** [`user-default-project-settings-tiered-plan.md`](user-default-project-settings-tiered-plan.md) §3.9
**Started:** 2026-09-13

## Goal

First end-to-end value: from any open project, promote its look to the user's personal
defaults with one confirmed click. Next import (Step 2) builds from it.

## Work

1. `webapp/src/editor/components/header/SetAsDefaultsButton.tsx` (new) — ghost icon
   `Button` (`LuBookmarkPlus`, `aria-label="Use as my default settings"`, `Tooltip`),
   hidden when signed out; confirm `Modal` (`ariaLabel="Use as default settings"`) with
   the copy from §3.9; on confirm → `UserDefaultsService.save(project.settings)` (strips
   crop / face anchor / transcription source, stamps the schema version) → success toast
   → `trackPersonalDefaultsSaved({ source: 'editor' })`; error toast on failure. Busy state
   disables the confirm button.
2. `Header.tsx` — mounts the component in the left control cluster after undo/redo,
   separated by the existing divider style.
3. `webapp/src/analytics/index.ts` — `trackPersonalSettingsPageLoaded`,
   `trackPersonalDefaultsSaved`, `trackPersonalDefaultsReset`.

## Verification

- webapp `tsc -b`, eslint on the new/changed files.
- Manual (local): open a project → click the bookmark icon → confirm → toast; DB row
  `user_profiles.project_defaults` now holds the blob (no `crop` / `faceCenter` /
  `transcriptionSource`); import a new recording → editor opens with that look.
  Signed-out editor (shared/legacy URL) shows no button.

## Files changed

- `webapp/src/editor/components/header/SetAsDefaultsButton.tsx` (new)
- `webapp/src/editor/components/header/Header.tsx` (import + mount after undo/redo)
- `webapp/src/analytics/index.ts` (`trackPersonalSettingsPageLoaded`, `trackPersonalDefaultsSaved`, `trackPersonalDefaultsReset`)

**Completed 2026-09-13.** webapp `tsc -b` clean; eslint findings on `Header.tsx` identical to HEAD (pre-existing), none in the new component. Browser smoke deferred to the Step 4 pass (the running dev server on 8080 predates the new routes and is restarted then).

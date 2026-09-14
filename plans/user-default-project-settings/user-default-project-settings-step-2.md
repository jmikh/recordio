# Step 2 — Core logic + apply on import

**Parent:** [`user-default-project-settings-tiered-plan.md`](user-default-project-settings-tiered-plan.md) §3.3–3.4
**Started:** 2026-09-13

## Goal

Turn a stored blob into a complete `ProjectSettings`, strip recording-specific fields
before storing, and make the import flow build new projects from the user's resolved
defaults. Inert until someone has stored defaults (Step 3 / Step 4 provide the UI).

## Work

1. `webapp/src/core/Project.ts` — export `createDefaultSettings`, `createDefaultTimeline`,
   `EMPTY_USER_EVENTS`, `createPlaceholderSource`, `DEFAULT_DISPLAY_SETTINGS`;
   `createFromSource(..., settings = createDefaultSettings())`.
2. `shared/utils/cameraShape.ts` (new) — `applyCameraShape`, `fitCameraToSource`,
   `clampCameraToOutput`; `CameraSettings.tsx` `handleShapeChange` now delegates to it
   (same math, one source of truth).
3. `webapp/src/core/projectDefaults.ts` (new, pure) — `stripRecordingSpecificSettings`,
   `toStoredProjectDefaults`, `mergeSettingsOntoDefaults`, `resolveProjectDefaults`
   (synthetic project → `migrateProject` → merge onto factory → strip → clamp),
   `adaptDefaultsToSources`. Tests in `projectDefaults.test.ts`.
4. `webapp/src/storage/userDefaultsService.ts` (new) — `fetch()` / `save(settings)` /
   `clear()` over `invokeFunction`; fetch errors → `null` + `captureError`.
5. `cloudProjectService.importRecordingLocalV2(…, opts?: { defaultSettings })` →
   `adaptDefaultsToSources` → `createFromSource(…, settings)`.
6. `ImportPage.tsx` — prefetch on mount (signed-in), `Promise.race` with a 3 s timeout in
   `performUpload`, never blocks import; `used_personal_defaults` on `project_created`.

## Verification

```bash
npx vitest run webapp/src/core                     # projectDefaults + migrateProject
(cd webapp && npx tsc -b)                          # webapp typecheck
npx eslint <changed files>
```
Manual: with a blob set via the route (curl or Step 3's button), import a recording →
the editor opens with those settings; with NULL → factory; with the API unreachable →
import still completes.

## Files changed

- `webapp/src/core/Project.ts` — exported `DEFAULT_DISPLAY_SETTINGS`, `EMPTY_USER_EVENTS`, `createPlaceholderSource`, `createDefaultSettings`, `createDefaultTimeline`; `createFromSource(..., settings = createDefaultSettings())`
- `shared/utils/cameraShape.ts` (new) — `clampCameraToOutput`, `fitCameraToSource`, `applyCameraShape`
- `webapp/src/editor/components/settings/CameraSettings.tsx` — `handleShapeChange` delegates to `applyCameraShape` (behavior unchanged)
- `webapp/src/core/projectDefaults.ts` (new) + `projectDefaults.test.ts` (new, 10 tests)
- `webapp/src/storage/userDefaultsService.ts` (new) — `fetch` (throws), `fetchOrNull` (import path), `save`, `clear`
- `webapp/src/storage/cloudProjectService.ts` — `importRecordingLocalV2(..., opts?: { defaultSettings })`
- `webapp/src/pages/import/ImportPage.tsx` — prefetch on sign-in, `resolveDefaultsForImport()` with a 3 s race, pass-through, `used_personal_defaults` analytics
- `webapp/src/analytics/index.ts` — `ProjectCreatedParams.used_personal_defaults`

**Completed 2026-09-13.** `npx vitest run webapp/src/core` 27/27, webapp `tsc -b` clean, eslint findings on touched files identical to HEAD (all pre-existing). Deviation from the plan: no Sentry breadcrumb on the 3 s timeout (kept the page lean; `fetchOrNull` already reports real failures).

# Step 5 — Template-mode polish

**Parent:** [`user-default-project-settings-tiered-plan.md`](user-default-project-settings-tiered-plan.md) §3.6–3.8
**Started:** 2026-09-13

## Goal

Make the editor's panels behave as *defaults* editors when the store holds the defaults
template, expose the settings that only inspectors could reach (Motion tab), and put the
effect Preview buttons in place. Feature complete after this step.

## Work

1. **Template-mode adaptations** (`useProjectStore(s => s.templateMode)`)
   - `ScreenSettings.tsx` — no Crop button.
   - `CameraSettings.tsx` — no "Center Face" / `FaceAnchorModal`; template-only **Position**
     (four corners) and **Size** (fraction of output height) controls, via
     `shared/utils/cameraShape.ts` + a small `cameraCorner.ts` helper.
   - `CaptionsSettings.tsx` — no A.I. transcription card; Word Highlight enabled without
     an OpenAI transcription; a note that captions are generated per recording.
   - `EffectsSettings.tsx` — `PreviewEffectButton` beside "Click Effect" and "Hotkeys
     Enabled" (disabled when the effect is off).
   - `AudioSettings.tsx` — note that audio defaults apply to recordings with the matching track.
2. **Motion tab** — `pages/settings/personal/MotionDefaultsSettings.tsx`: Auto-zoom
   (enabled, max zoom, transition, easing, Preview), Spotlight (enabled, enlarge, dim,
   transition, easing, Preview), Camera move (enabled, transition, easing), Overlays
   (enabled, default duration). Ranges mirror the inspectors. Added to
   `DefaultsSettingsPanel` as a seventh tab.
3. **Preview plumbing** — `useDefaultsPreviewStore` moved to `editor/stores/` (editor panels
   import it); `editor/components/settings/PreviewEffectButton.tsx` (play ↔ stop).
4. **Dirty-navigation guard** — `DashboardPage.handleViewChange` asks "Discard unsaved
   defaults?" when leaving the personal page with unsaved changes (sidebar nav only; the
   `beforeunload` prompt covers tab close / reload).
5. **Tests** — `webapp/src/core/effectDemos.test.ts`; the e2e spec from Step 4 extended
   with a Preview-button click.

## Verification

- webapp `tsc -b`, eslint on changed files, `npx vitest run webapp/src/core`.
- Playwright `e2e/tests/personal-settings.spec.ts` (local stack; server on 8081).
- Browser: each Preview button plays and the still returns; Motion tab edits mark the page
  dirty and survive save/reload; the editor itself is unchanged (crop, face anchor, A.I. card
  still present in a real project).

## Files changed

- `webapp/src/editor/components/settings/cameraCorner.ts` (new), `PreviewEffectButton.tsx` (new)
- `webapp/src/editor/stores/useDefaultsPreviewStore.ts` (moved here from `pages/settings/personal/`)
- `webapp/src/editor/components/settings/ScreenSettings.tsx`, `CameraSettings.tsx`, `CaptionsSettings.tsx`, `EffectsSettings.tsx`, `AudioSettings.tsx` — template-mode branches only; editor behavior unchanged
- `webapp/src/pages/settings/personal/MotionDefaultsSettings.tsx` (new), `DefaultsSettingsPanel.tsx` (Motion tab)
- `webapp/src/pages/dashboard/DashboardPage.tsx` — "Discard unsaved defaults?" guard on sidebar navigation
- `webapp/src/core/effectDemos.test.ts` (new, 6 tests); `e2e/tests/personal-settings.spec.ts` (Preview clicks)

**Completed 2026-09-13.** webapp `tsc -b` clean; eslint findings on touched files identical to HEAD; `npx vitest run webapp/src/core` 33/33; `npx vitest run webapp/src shared` 259/260 — the one failure (`cloudProjectService.test.ts › saveProject › passes expected version`) is the known pre-existing one noted in `plans/shared-api-contract.md`; Playwright `personal-settings.spec.ts` 3/3 (click + auto-zoom previews play and the still returns). Deviations: Preview buttons sit next to the enable toggles rather than in the card header (`CollapsibleCard.headerAction` renders inside the header `<button>`, which would nest buttons); the preview store lives in `editor/stores/` because editor panels import it; the dirty guard covers sidebar navigation (other in-app links bypass it; `beforeunload` covers reload/close).

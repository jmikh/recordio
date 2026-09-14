# Step 4 — Personal Settings page

**Parent:** [`user-default-project-settings-tiered-plan.md`](user-default-project-settings-tiered-plan.md) §3.5–3.8
**Started:** 2026-09-13

## Goal

The dashboard page where a user edits their defaults with the editor's own settings
panels, sees them on a sample recording, previews time-based effects on demand, and
saves explicitly. Ships with the six existing panels as they are; template-mode
adaptations and the Motion tab follow in Step 5.

## Work

1. **Template project + store mode**
   - `webapp/src/core/sampleMedia.ts` — sample URLs (`/samples` in dev, CDN in prod),
     sizes, the sample click point, sentinel storage paths.
   - `webapp/vite.config.ts` — dev-only middleware serving `cdn/samples/` at `/samples/`.
   - `webapp/src/core/defaultsTemplate.ts` — `buildDefaultsTemplateProject(settings)`,
     `SAMPLE_USER_EVENTS` (URL change only), `STILL_TIME_MS`.
   - `useProjectStore.ts` — `templateMode`, `loadDefaultsTemplate`, `unloadDefaultsTemplate`,
     auto-save guard (skip in template mode / placeholder; re-check project identity in the
     debounce).
2. **Effect demos** (pulled into this step — they are the preview renderer's core loop)
   - `webapp/src/core/effectDemos.ts` — `DemoKind`, `DemoClip`, `buildEffectDemo(kind, project)`
     for click / keyboard / zoom / spotlight from the *current* settings; unit tests in Step 5.
   - `pages/settings/personal/useDefaultsPreviewStore.ts` — `play(kind)` / `playing` / `stop()`.
3. **Routing + nav** — `App.tsx` (`/settings/personal`), `DashboardPage` (`settingsPage`
   prop replaces `showSettings`), `DashboardSidebar` (Manage group for all roles,
   "Personal Settings" item, `DashboardView` `'personal'`).
4. **Page** — `pages/settings/personal/PersonalSettingsPage.tsx` (header bar with status
   chip, aspect ratio, undo/redo, Reset / Discard / Save; load → template; dirty tracking
   via `usePersonalDefaultsStore`; `beforeunload`), `DefaultsSettingsPanel.tsx` (nav +
   panels, no logo/inspectors), `settingsNavItems.ts` (shared with the editor panel),
   `DefaultsPreview.tsx` + `useDefaultsPreviewRenderer.ts` (still frame + demo loop),
   `aspectRatioOptions.tsx` extracted from `Header.tsx`.

## Verification

- webapp `tsc -b`, eslint on new/changed files, `npx vitest run webapp/src/core`.
- Browser (local, signed in): sidebar → Personal Settings → page loads "Using Recordio
  defaults", preview shows the sample frame; change background / padding / aspect ratio →
  redraw; undo/redo; Save → toast + DB row; reload keeps values; Reset → NULL; no
  `project-update` requests during the whole session.

## Files changed

- `webapp/src/core/sampleMedia.ts`, `webapp/src/core/defaultsTemplate.ts`, `webapp/src/core/effectDemos.ts` (new)
- `webapp/vite.config.ts` — dev-only `/samples` middleware over `cdn/samples/`
- `webapp/src/editor/stores/useProjectStore.ts` — `templateMode`, `loadDefaultsTemplate` (flushes a pending real-project save first), `unloadDefaultsTemplate`, auto-save guard + project-identity re-check
- `webapp/src/App.tsx` (`/settings/personal`), `webapp/src/pages/dashboard/DashboardPage.tsx` (`settingsPage` prop), `webapp/src/pages/dashboard/DashboardSidebar.tsx` (Manage group for all roles, Personal Settings item)
- `webapp/src/editor/components/settings/settingsNavItems.ts` (new) + `SettingsPanel.tsx` uses it; `webapp/src/editor/components/header/aspectRatioOptions.tsx` (new) + `Header.tsx` uses it
- `webapp/src/pages/settings/personal/` (new): `PersonalSettingsPage.tsx`, `DefaultsSettingsPanel.tsx`, `DefaultsPreview.tsx`, `useDefaultsPreviewRenderer.ts`, `useDefaultsPreviewStore.ts`, `usePersonalDefaultsStore.ts`
- `e2e/tests/personal-settings.spec.ts` (new; pulled forward from Step 5)
- `plans/user-default-project-settings/user-default-project-settings-agent-suggestions.md` (new)

**Completed 2026-09-13.** webapp `tsc -b` clean; eslint findings on touched files identical to HEAD (one `any` fewer in the store); `npx vitest run webapp/src/core` 27/27; Playwright `personal-settings.spec.ts` 3/3 against the local stack (second Fastify instance on **8081** started for the new routes — the pre-existing dev server on 8080 runs without watch; `webapp/.env.development.local` `VITE_API_URL` was pointed at 8081 for the run). Design notes: effect-demo builders landed here (the renderer's core loop) rather than Step 5; the preview fits its canvas with a ResizeObserver instead of CSS aspect-ratio tricks.

# User Default Project Settings — Tiered Plan

**Status:** planned 2026-09-13, implementation started 2026-09-13. Steps 1–5 below;
step docs are created when each step starts (`user-default-project-settings-step-N.md`).

---

## 0. Constraints for this implementation run (user, 2026-09-13)

- **Local only.** Migrations are applied to the local Supabase (`supabase migration up`),
  the Fastify server and webapp run locally. **No `supabase db push`, no prod deploy,
  no `git push`.** Nothing is committed unless the user asks.
- **Reviewed part by part.** Each step doc ends with a "Files changed" list so the user
  can review the working tree step by step.
- **Placeholder sample media lives in the repo.** `cdn/samples/defaults-preview-screen-v1.avif`
  and `cdn/samples/defaults-preview-camera-v1.avif` are ImageMagick-generated placeholders
  (neutral app UI, neutral silhouette). The user uploads them to the CDN later; until then
  the webapp dev server serves `cdn/samples/` at `/samples/` (Vite middleware, dev only).
- Skill/CLAUDE.md edits (§3.10) are suggestions only — never applied without permission.

---

## 1. Context

Every new project is built from one hardcoded factory, `createDefaultSettings()` in
`webapp/src/core/Project.ts`, so a user who always wants (say) a 9:16 canvas, a specific
gradient, a square camera in the bottom-right and no hotkey overlay has to redo that in
every project. The ask:

- A per-user set of **default project settings** applied to every **new** project.
- A **Personal Settings** entry in the dashboard sidebar (next to Workspace Settings)
  that opens a page where the user edits those defaults. It should feel like the
  editor's settings side (same panels, a live preview of what the defaults look like)
  but read unmistakably as "defaults", not as a project.
- A place to store them in the DB and the endpoints to read/write them.
- **No seeding.** Users who never saved defaults get the shipped factory defaults;
  nothing is written to the DB for them.
- (Added 2026-09-13) The page has no timeline, so time-based effects need a **Preview**
  button in the settings panels that plays the effect on the preview canvas: click
  effect, keyboard hotkeys, auto-zoom (and spotlight, same mechanism).

Decisions taken during planning (2026-09-13):

| Decision | Choice |
|---|---|
| Plan type | Tiered |
| Scope | Per **user** (not per workspace) — "personal" settings; a user's defaults follow them into every workspace |
| Save model on the page | **Explicit Save** with dirty state, Discard, and "Reset to Recordio defaults" |
| Editor action | Yes — "Use as my default settings" in the editor header |
| Preview media | Two sample images on the CDN (`samples/`), placeholders generated locally for now |
| Empty state | `NULL` in the DB → shipped defaults; Reset clears back to `NULL` (never snapshots today's factory values) |
| Effect previews | Ephemeral demos built from current settings at play time; click, keyboard, auto-zoom, spotlight. Click demo is click-only (drag demo optional later) |

### Reality check on the data-access rule

`.claude/CLAUDE.md` says DB access goes through "RPC or edge functions". Both are
decommissioned (`supabase/functions/` is empty, zero `.rpc(` calls; see
`supabase/sql/graveyard.sql`). The live pattern is **webapp `invokeFunction()` →
Fastify route in `server/src/routes/**` → SQL over `pg.Pool`**, with the client↔server
contract in `shared/api/`. This plan follows that. A CLAUDE.md wording fix is listed in
§3.10 (needs the user's go-ahead before editing).

---

## 2. Architecture overview

```
 user_profiles.project_defaults (jsonb, NULL = use shipped defaults)
        ▲                                   │
        │ set / clear                       │ get
        │                                   ▼
 Fastify routes  ──── shared/api/session.ts contract ────  webapp invokeFunction()
        ▲                                                       │
        │                                                       ▼
 Editor header "Use as my defaults"            UserDefaultsService (webapp/src/storage/)
                                                                │
                              ┌─────────────────────────────────┼───────────────────────┐
                              ▼                                 ▼                       ▼
                    Personal Settings page            ImportPage prefetch        resolveProjectDefaults()
                    (template project in the          → importRecordingLocalV2   migrate + deep-merge onto
                     global project store,             → createFromSource(...,   createDefaultSettings()
                     explicit Save/Reset)                settings)               (webapp/src/core/projectDefaults.ts)
```

Key idea for the page: the editor's six settings panels already read/write the global
`useProjectStore`. Instead of refactoring them to value/onChange props, the page loads a
**synthetic "defaults template" project** into that store with a `templateMode` flag
that (a) silences auto-save and (b) lets the panels hide recording-specific controls.
Undo/redo comes free from zundo. The editor is never mounted at the same time, so the
singleton store is available.

---

## 3. Design

### 3.1 Data model

Migration (`supabase/migrations/<date -u '+%Y%m%d%H%M%S'>_user_profiles_project_defaults.sql`
— real timestamp, must sort last, one concern, `IF NOT EXISTS`, comment explaining why —
mirror `20260901212020_user_profile_reviewed.sql`):

```sql
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS project_defaults JSONB;
```

- Column, not a new table: exactly one blob per user; precedent is
  `default_workspace_id` / `reviewed_at` on the same row; no RLS policy work (RLS is
  enabled with zero policies; the server connects as `postgres`).
- Stored shape: `{ schemaVersion: number, settings: ProjectSettings }` where
  `schemaVersion = CURRENT_SCHEMA_VERSION` at save time. Settings are a sub-tree of the
  project schema, so **project migrations are the only migration system** (§3.3).
- `updated_at` is set explicitly in SQL (no trigger exists — see
  `server/src/routes/workspaces/workspaceSetDefault.ts`).
- `/user-profile-get` does **not** return the blob.
- Refresh the DDL snapshot `supabase/sql/tables/user_profiles.sql` (hand-edit; the dump
  script targets the linked remote and this run is local-only).

### 3.2 API — three routes (adding a route = 4 edits, see `plans/shared-api-contract.md`)

`shared/api/session.ts` (types) + `shared/api/index.ts` (`ApiRoutes` entries):

| Route | Request | Response | Notes |
|---|---|---|---|
| `POST /user-project-defaults-get` | `{}` (`EmptyRequest`) | `StoredProjectDefaults \| null` | No response schema (arbitrary jsonb — `fast-json-stringify` would strip fields; same reason `project-get` has none). Mirrors `userProfileGet.ts`. Sends `null` when no row or NULL. |
| `POST /user-project-defaults-set` | `{ schemaVersion: Integer ≥ 1, settings: Object(additionalProperties: true) }` | `{ saved: true }` | `bodyLimit: 64 * 1024` on the route. `INSERT … ON CONFLICT (user_id) DO UPDATE SET project_defaults = EXCLUDED.project_defaults, updated_at = now()` (upsert covers the no-profile-row edge exactly like `userReviewSet.ts`). Server does not validate the settings tree (precedent: `project-create-v2` passes `project_data` through). |
| `POST /user-project-defaults-clear` | `{}` | `{ cleared: true }` | `UPDATE user_profiles SET project_defaults = NULL, updated_at = now() WHERE user_id = $1`. Idempotent. |

Server files: `server/src/routes/userProjectDefaultsGet.ts`, `…Set.ts`, `…Clear.ts`
(same folder and style as `userProfileGet.ts` / `userReviewSet.ts`), registered in
`server/src/app.ts` beside `userReviewSetRoutes`.

Tests: `server/test/userProjectDefaults.test.ts`, cloned from
`server/test/userReviewSet.test.ts`:
- get for a fresh user → `null` (proves no seeding);
- set → get round-trips the exact blob; second set replaces;
- clear → get `null`; clear on a user with nothing → 200;
- 400 on `schemaVersion: "6"` / missing `settings`; 413 on a >64 KB body;
- set creates the profile row when the signup trigger left none (`withProfile: false`).

Deploy order (when the user deploys): migration → server → webapp (additive).

### 3.3 Client core: resolve, strip, adapt — `webapp/src/core/projectDefaults.ts`

Pure functions, unit-tested in `webapp/src/core/projectDefaults.test.ts`:

- `stripRecordingSpecificSettings(s)` — drops `screen.crop`, `screen.outputCrop` (dead
  field), `camera.faceCenter`, `captions.transcriptionSource`; forces
  `autoCutApplied: false`. **Keeps** `background.storagePath` and
  `audio.music.storagePath` — user asset library (`user_assets`, user-scoped,
  cross-project), hydrated on project load by `getProjectMediaPaths`
  (`shared/utils/projectMedia.ts`).
- `resolveProjectDefaults(stored | null)` — `null` → `createDefaultSettings()`; else wrap
  in a synthetic project, run `migrateProject()` (`webapp/src/core/migrateProject.ts`),
  take `.settings`, then `mergeSettingsOntoDefaults(createDefaultSettings(), migrated)`
  (plain objects recurse; arrays and primitives from the stored blob win; `undefined`
  skipped; stored keys absent from the factory are kept, e.g. `background.storagePath`).
  Finish with `stripRecordingSpecificSettings` and clamp `camera.xPx/yPx` inside
  `outputSize`.
- `adaptDefaultsToSources(s, screenSource, cameraSource?)` — when
  `camera.shape === 'rect'` and a camera exists, recompute `widthPx` from the real
  camera aspect and re-clamp. Extract the math from `CameraSettings.tsx:37-62` into
  `shared/utils/cameraShape.ts` (`applyCameraShape`) and use it in both places.

### 3.4 Apply on import (the only creation path)

- `ProjectImpl.createFromSource(…, settings?: ProjectSettings)` — `settings ?? createDefaultSettings()`.
- `CloudProjectService.importRecordingLocalV2(…, opts?: { defaultSettings?: ProjectSettings })`
  → `adaptDefaultsToSources` then `createFromSource(…, settings)`.
- `webapp/src/storage/userDefaultsService.ts`: `fetch()` (errors → `null` +
  `captureError(err, { flow: 'user_defaults', phase: 'fetch' })`), `save(settings)`
  (strips, stamps `CURRENT_SCHEMA_VERSION`), `clear()`.
- `ImportPage.tsx`: start `fetch()` on mount into a ref; in `performUpload` race it
  against a 3 s timeout → `resolveProjectDefaults(result ?? null)`. **Import never fails
  or waits >3 s because of defaults.** Add `used_personal_defaults: boolean` to
  `trackProjectCreated`.
- Never applies to existing projects.

### 3.5 Project store: template mode — `webapp/src/editor/stores/useProjectStore.ts`

- State `templateMode: boolean` (default `false`; **not** in zundo's `partialize`).
- `loadDefaultsTemplate(settings)`: `set({ project: buildDefaultsTemplateProject(settings)
  (without userEvents), userEvents: SAMPLE_USER_EVENTS, projectName: 'Sample recording',
  templateMode: true })` then `temporal.getState().clear()`.
- `unloadDefaultsTemplate()`: placeholder project, empty events, `templateMode: false`,
  `temporal.clear()`.
- **Auto-save guard**: skip scheduling when `templateMode` or `!project.id`; inside the
  timeout re-check `getState().templateMode === false && getState().project.id === project.id`.
- `webapp/src/core/defaultsTemplate.ts` — `buildDefaultsTemplateProject(settings)`:
  `id: 'defaults-template'`, `autoEffectsGenerated: true`, `screenSource { storagePath:
  SAMPLE_SCREEN_PATH, durationMs: 10000, hasAudio: true, size: 1920×1080,
  trackableContentRect: full frame }`, `cameraSource { storagePath: SAMPLE_CAMERA_PATH,
  size: 1280×720 }`, `microphoneSource { storagePath: SAMPLE_MIC_PATH, durationMs: 10000 }`,
  one output window `[0, 10000]`, one caption segment over the whole window ("Your
  captions will look like this", timed so one word is highlighted at `STILL_TIME_MS`), all
  other segment arrays empty. `SAMPLE_USER_EVENTS` = **only** one `urlChanges` entry
  (`https://recordio.io/…`, timestamp 0) so the toolbar shows a URL. **The still frame is
  clean** (`STILL_TIME_MS = 0`) — clicks, keystrokes and zooms are shown by the effect
  demos (§3.8), never baked into the template.
- Sample media URLs come from `webapp/src/core/sampleMedia.ts`:
  `import.meta.env.DEV ? '/samples' : `${CDN_ORIGIN}/samples`` +
  `/defaults-preview-screen-v1.avif` / `/defaults-preview-camera-v1.avif`. Dev serving:
  a `configureServer` middleware in `webapp/vite.config.ts` maps `/samples/*` to
  `../cdn/samples` (the repo folder mirrored to the CDN).

### 3.6 Personal Settings page (dashboard)

**Routing / nav**
- `App.tsx`: `path.startsWith('/settings/personal')` → `<DashboardPage settingsPage="personal" />`;
  refactor the existing `showSettings` boolean into `settingsPage?: 'workspace' | 'personal'`.
- `DashboardSidebar.tsx`: the "Manage" group renders for **every role**; `Workspace
  Settings` keeps its admin gate; new `Personal Settings` item (`LuUserCog`) always shown.
  `DashboardView` gains `'personal'`; `handleViewChange('personal')` → `navigate('/settings/personal')`.
- `DashboardPage.tsx`: for `'personal'` render
  `<main className="flex-1 min-w-0 flex flex-col overflow-hidden p-8"><PersonalSettingsPage /></main>`.

**Page — `webapp/src/pages/settings/personal/PersonalSettingsPage.tsx`**

```
┌ Personal settings                                  [Using Recordio defaults] ┐
│ Defaults for every new project you create. Existing projects aren't affected.│
│                    [16:9 ▾] [↶][↷]  [Reset to Recordio defaults] [Discard] [Save defaults] │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌ card: bg-surface border-border rounded-[var(--radius-lg)] overflow-hidden ┐ │
│ │ nav w-44 │ settings w-80 (scrolls) │  PREVIEW · SAMPLE RECORDING           │ │
│ │ Background│ (BackgroundSettings…)  │  ┌──────────────────────────┐        │ │
│ │ Screen    │   [▶ Preview] buttons  │  │   canvas at outputSize   │        │ │
│ │ Effects   │   on click / keyboard  │  │   still, or a demo       │        │ │
│ │ Camera    │                        │  └──────────────────────────┘        │ │
│ │ Captions  │                        │  Use Preview on an effect to see it   │ │
│ │ Audio     │                        │  play here.                           │ │
│ │ Motion    │   [▶ Preview] zoom /   │                                       │ │
│ │           │   spotlight            │                                       │ │
│ └───────────┴────────────────────────┴──────────────────────────────────────┘ │
```

- Header: `h1.heading-2` "Personal settings"; subtitle `text-sm text-text-muted`. Status
  chip (`text-badge`): "Using Recordio defaults" / "Custom defaults" / "Unsaved changes".
  Right controls: aspect-ratio `Dropdown` from `ASPECT_RATIO_PRESETS` + `findPreset`
  (extract `aspectRatioOptions` out of `Header.tsx:26` into a shared module) →
  `updateSettings({ outputSize })`; undo/redo via `useProjectHistory`; `Reset to Recordio
  defaults` (ghost; disabled when stored is `null` and clean; confirm `Modal`); `Discard`
  (only when dirty); `Save defaults` (primary; disabled unless dirty).
- Lifecycle: mount → "Loading defaults…" → `UserDefaultsService.fetch()` →
  `resolveProjectDefaults(stored)` → `loadDefaultsTemplate(resolved)`; baseline =
  `JSON.stringify(strip(resolved))`; `hasStored = stored !== null`; `isDirty` compares
  `strip(project.settings)` to baseline. Unmount → `unloadDefaultsTemplate()` +
  `useMediaUrlStore.getState().revokeAll()`. Load failure → "Could not load your
  defaults." + Retry.
- Save → `save(project.settings)` → toast (`role="status"`) "Defaults saved — new projects
  will use them", new baseline, `hasStored = true`.
- Reset → confirm → `clear()` → `loadDefaultsTemplate(createDefaultSettings())`,
  `hasStored = false`, toast "Back to Recordio defaults".
- Discard → `loadDefaultsTemplate(resolveProjectDefaults(lastStored))`.
- Unsaved guard: `beforeunload` while dirty; in-app, `usePersonalDefaultsStore { isDirty }`
  consulted by `DashboardPage.handleViewChange` → `Modal` "Discard unsaved defaults?".
- Analytics: `trackPersonalSettingsPageLoaded()`, `trackPersonalDefaultsSaved({ source })`,
  `trackPersonalDefaultsReset()`.

**`DefaultsSettingsPanel.tsx`**: slim sibling of `SettingsPanel.tsx:149-226` — `w-44`
`SidebarNav` + `w-80` content with `Scrollbar`, local `activeTab`, device-frame preload —
minus the logo/back button, the selection/inspector branch, and the disabled-camera
tooltip. Nav items shared via `settingsNavItems.ts`; the defaults panel appends **Motion**.

**Template-mode adaptations inside the existing section components**
(`useProjectStore(s => s.templateMode)`):

| Component | In template mode |
|---|---|
| `ScreenSettings.tsx` | Hide the Crop control. Toolbar card shows because the template has a `trackableContentRect`. |
| `CameraSettings.tsx` | Hide the face-anchor entry. Add a template-only **Position** picker (4 corners) and **Size** slider (`heightPx` as a fraction of `outputSize.height`, width per shape via `applyCameraShape`). |
| `CaptionsSettings.tsx` | Only the style card; gate `settings.transcriptionSource \|\| templateMode`; no OpenAI restriction on `wordHighlight`. |
| `EffectsSettings.tsx` | **Preview** play buttons beside "Click Effect" and "Show hotkeys" (§3.8), shared `Button` ghost + icon + aria-label (the existing raw "Preview sound" `<button>` is a pre-existing guideline violation — log in agent-suggestions). |
| `AudioSettings.tsx` | `text-label` note "Applies to new recordings that have the matching track." |
| `BackgroundSettings.tsx` | No change. |

### 3.7 Motion tab — `MotionDefaultsSettings.tsx`

Template-only tab exposing `zoom`, `spotlight`, `cameraMove`, `overlay` defaults with the
inspectors' controls/ranges (`ZoomInspector.tsx`, `SpotlightInspector.tsx`,
`CameraMoveInspector.tsx`, `OverlayInspector.tsx`), built from `CollapsibleCard`,
`Slider`, `Toggle`, `Dropdown`, `updateSettings` + `useHistoryBatcher` (those groups are
shallow-replaced by `updateSettings` — always spread the full sub-object). The Auto-zoom
and Spotlight enable toggles each carry a **Preview** button (§3.8).

### 3.8 Preview — `DefaultsPreview.tsx` + `useDefaultsPreviewRenderer.ts`

**Still frame** (default state):
- `<canvas width=outputSize.width height=outputSize.height>` CSS-scaled to fit
  (inline style only for the computed aspect ratio), `rounded-[var(--radius-md)] shadow-sm`,
  eyebrow "Preview · sample recording", `text-label` footnote.
- Resources mirror `CanvasContainer.tsx:365-369, 431-435`: hidden `<img>`s for the sample
  screen and camera (`crossOrigin="anonymous"`), the background image (`bgUrl =
  (bg.storagePath && mediaUrls[bg.storagePath]) || bg.imageUrl`), the device frame
  (`getDeviceFrame(id).imageUrl` when `screen.mode === 'device'`); `onLoad` schedules a render.
- Render = `drawBackground(…)` (copy the blur argument from `CanvasContainer` ~193-202)
  then `PlaybackRenderer.render(resources, state)` (`shared/export/PlaybackRenderer.ts:52`)
  with `videoRefs: { [SAMPLE_SCREEN_PATH]: screenImg, [SAMPLE_CAMERA_PATH]: cameraImg }`,
  `sourceCanvas: canvas`, `projectName: 'recordio.io'`, `currentTimeMs: STILL_TIME_MS`,
  `timeMapper: new TimeMapper(outputWindows)`. Coalesced via one `requestAnimationFrame`
  per change; no loop.
- Missing sample image → the layer is skipped; small `text-label` "Sample media unavailable".

**Effect demos** (added 2026-09-13):
- `webapp/src/core/effectDemos.ts` — pure, unit-tested
  `buildEffectDemo(kind, project): { userEvents, zoomSegments, spotlightSegments, durationMs }`
  built from the **current** settings at play time. Nothing is written to the store, so
  demos never dirty the defaults and always reflect the latest values.
  - `click`: one `mouseClicks` event at t=0 at the sample button
    (`SAMPLE_CLICK_POINT`, source px 1700×920 on the placeholder screen); painter animates
    `CLICK_DURATION` 500 ms → demo 800 ms.
  - `keyboard`: one `KeyboardEvent` (⌘K: `metaKey: true, key: 'k'`) at t=0; painter shows
    1500 ms with fade from 1000 ms → demo 1800 ms.
  - `zoom`: the click plus one `ZoomSegment` (`type: 'auto'`, `transitionDurationMs` /
    `easing` from `settings.zoom`, `rectPx` = `outputSize / maxZoom` centred on the click
    point mapped to output px and clamped) from 300 ms to 300 + T + 1200 ms; output times
    stamped with `recomputeOutputTimes` against the template's single window; demo ends
    after the gap zoom-out (300 + 2T + 1200 + 200 ms).
  - `spotlight`: one `SpotlightSegment` around the sample button (`sourceRect` in source
    px, `dimOpacity`/`scale`/`transitionDurationMs` from `settings.spotlight`), same timing
    envelope as zoom.
- `webapp/src/editor/stores/useDefaultsPreviewStore.ts` (tiny zustand): `requested`,
  `playing: DemoKind | null`, `play(kind)`, `stop()`. Buttons in the settings column call
  `play`; the preview subscribes. Lives in the editor layer because the editor panels import it.
- Renderer `playDemo(kind)`: rAF loop from 0 to `durationMs` (clock = `performance.now()`),
  each frame renders `PlaybackRenderer.render` with a shallow project copy carrying the demo
  segments and the demo `userEvents`; **re-reads settings from the store every frame** so
  slider changes show live. On finish (or when another demo starts, or on unmount) it
  redraws the still and clears `playing`.
- Buttons (template mode only): `PreviewEffectButton` (shared `Button`, ghost, play icon,
  aria-label) beside "Click Effect" and "Hotkeys Enabled" in Effects, and beside the
  Auto-zoom / Spotlight enable toggles in Motion (next to the toggle, not in the card header —
  `CollapsibleCard.headerAction` renders inside the header `<button>`). Disabled when the
  effect is off; becomes a stop button while its demo plays; starting another demo cancels
  the current one.

**Sample media (placeholders now in `cdn/samples/`, user uploads to CDN later):**
- `defaults-preview-screen-v1.avif` — 1920×1080 neutral app UI without browser chrome
  (the toolbar painter draws its own); primary button centred at (1700, 920).
- `defaults-preview-camera-v1.avif` — 1280×720 gradient + neutral silhouette.
Immutable per the `cdn` skill (`-v1` suffix; add `-v2` files rather than overwriting).
Note: `shared/urls.ts` has `CDN_ORIGIN = https://cdn.recordio.io` while `cdn/CLAUDE.md`
and the `cdn` skill say `cdn.recordio.cc` — logged in agent-suggestions.

### 3.9 Editor action — "Use as my default settings"

`webapp/src/editor/components/header/Header.tsx`: ghost icon `Button`
(`aria-label="Use as my default settings"`, `Tooltip`) → `Modal` (`role="dialog"`)
"Make this project's look the default for new projects? This replaces your personal
defaults. Recording-specific items (crop, face anchor, caption text) aren't included."
[Cancel] [Set as defaults] → `UserDefaultsService.save(project.settings)` → toast
"Defaults updated" → `trackPersonalDefaultsSaved({ source: 'editor' })`. Signed-in only.

### 3.10 Stale docs to fix (ask before editing)

- `.claude/CLAUDE.md` § Data Access: replace "RPC (DB functions) or edge functions" with
  the Fastify-route + `shared/api` contract rule.
- `.claude/skills/project-model/SKILL.md` §1: `importRecordingLocalV2` injects the user's
  resolved defaults into `createFromSource`; `createDefaultSettings()` is the fallback
  when `user_profiles.project_defaults` is NULL. Also "metadata via edge functions" and
  the `cloudStorage.ts` "edge functions" list are stale (Fastify routes now).
- `.claude/skills/cdn/SKILL.md` + `cdn/CLAUDE.md`: CDN origin `.cc` vs code `.io`.
- `webapp/src/storage/cloudStorage.ts` class doc ("through the Supabase client with RLS")
  is stale — agent-suggestions.

---

## 4. Steps

| # | Step | Ships |
|---|---|---|
| 1 | **Backend + contract** — migration (local apply), `shared/api` types + `ApiRoutes`, three routes, `app.ts` registration, `server/test/userProjectDefaults.test.ts` | Deployable alone (NULL everywhere, no behavior change) |
| 2 | **Core + apply on import** — `projectDefaults.ts` (+ tests), `shared/utils/cameraShape.ts` extraction, `createFromSource(settings?)`, `importRecordingLocalV2` option, `ImportPage` prefetch with 3 s race, `UserDefaultsService`, analytics param | Inert until someone has stored defaults |
| 3 | **Editor "Use as my defaults"** — Header button + confirm Modal + toast + analytics | First end-to-end value |
| 4 | **Personal Settings page** — store `templateMode` + load/unload + auto-save guard, `defaultsTemplate.ts`, `sampleMedia.ts` + Vite dev middleware, route/sidebar/`DashboardPage` wiring, `PersonalSettingsPage` (header bar, Save/Discard/Reset, loading/error), `DefaultsSettingsPanel`, `DefaultsPreview` still renderer **with the `playDemo` loop and `useDefaultsPreviewStore`** | The page with the six existing panels |
| 5 | **Template-mode polish** — §3.6 table adaptations, Motion tab (§3.7), `effectDemos.ts` builders + tests + the Preview buttons (§3.8), dirty-navigation guard, page analytics, e2e smoke test, doc-fix suggestions (§3.10) | Feature complete |

Steps 1→2→3 are sequential; 4 depends on 2; 5 depends on 4.

---

## 5. Verification

**Automated**
- Server: local Supabase running, `supabase migration up`, `supabase/sql/deploy.sh` if
  needed, then root `npx vitest run server/test/userProjectDefaults.test.ts` (root vitest
  loads `.env.test` → real-Postgres tier); `cd server && npm run typecheck`.
- Webapp: `npx vitest run webapp/src/core` green; `cd webapp && npx tsc -b` clean; eslint
  on changed files.
- e2e (`e2e/tests/smoke.spec.ts` style): `/settings/personal` shows "Personal settings"
  and a "Save defaults" button.

**Manual (local stack)**
1. Fresh user: `select project_defaults from user_profiles` is NULL; the page shows
   "Using Recordio defaults"; Save is disabled until a change.
2. Change background, padding, camera corner, aspect ratio → preview redraws; undo/redo
   works; DevTools Network shows **no** `project-update` calls while editing.
3. Each Preview button plays its effect on the canvas and the still returns afterwards;
   changing a slider mid-demo updates live; still no `project-update` calls.
4. Save → toast; reload → same values; DB row has the blob with
   `schemaVersion = CURRENT_SCHEMA_VERSION` and no `crop`/`faceCenter`/`transcriptionSource`.
5. Import a recording → editor opens with those settings (rect camera sized to the real
   camera aspect; custom background hydrated). An older project is unchanged.
6. Reset → confirm → column back to NULL → next import uses shipped defaults.
7. Editor "Use as my default settings" → Personal Settings page reflects it.
8. Throttle `/user-project-defaults-get` past 3 s → import still succeeds with shipped defaults.
9. Dirty-state guard: edit, click "All recordings" → confirm modal; tab close prompts.

---

## 6. Step log

- Step 1 — completed 2026-09-13 ([step doc](user-default-project-settings-step-1.md)). No design changes. Note: `shared/api/session.ts` now `import type`s `ProjectSettings` from `shared/types/settings` (first such import in `shared/api`); server typecheck under `lib: ES2022` stays clean.
- Step 2 — completed 2026-09-13 ([step doc](user-default-project-settings-step-2.md)). No design changes; the timeout breadcrumb was dropped (real fetch failures are still reported by `fetchOrNull`).
- Step 3 — completed 2026-09-13 ([step doc](user-default-project-settings-step-3.md)). No design changes. Success toast carries a "View" action to `/settings/personal` (Step 4 route).
- Step 4 — completed 2026-09-13 ([step doc](user-default-project-settings-step-4.md)). Design changes: `effectDemos.ts` builders moved from Step 5 into this step; e2e spec pulled forward. Verified in the browser via Playwright (3/3) with a second server instance on 8081.
- Step 5 — completed 2026-09-13 ([step doc](user-default-project-settings-step-5.md)). Design changes propagated: Preview buttons next to the enable toggles (not the card header); `useDefaultsPreviewStore` in `webapp/src/editor/stores/`; dirty guard = sidebar navigation + `beforeunload`. **Feature complete; not committed, not deployed** (per §0).
- Step 6 — review round 1, completed 2026-09-14 ([step doc](user-default-project-settings-step-6.md)). Trims to the defaults page (no Audio tab, no aspect ratio / undo / redo, no camera position / crop zoom / mirror, Motion = Zoom + Spotlight only), auto-shrink preview, demos aimed at the sample's top-left card, badge row above the canvas, drag effect off by default and out of the UI. §3.6–3.8 not yet rewritten to match — proposed edits listed in chat, pending confirmation.
- Step 7 — review round 2, completed 2026-09-14 ([step doc](user-default-project-settings-step-7.md)). Schema v7 (drag effect forced off, `autoGenerate` backfilled); Auto-zoom / Auto-spotlight = `autoGenerate` (first-open generation only, tracks never disabled by a default); Motion tab shared with the editor (apply-to-all store actions, Regenerate / Delete All moved there); inspectors down to one *Apply to all* checkbox.

---

## 7. Open knobs / out of scope

- Per-workspace overrides — out of scope.
- A custom background/music asset deleted from the library while referenced by defaults:
  preview shows the fallback; a new project gets a dangling `storagePath` (same handling
  the editor already has). Follow-up: clear the reference on asset delete.
- Body cap 64 KB and import wait 3 s are starting values.
- Camera drag/resize on the preview canvas, and a drag-effect demo — later.
- Applying defaults to existing projects — explicitly not part of this.

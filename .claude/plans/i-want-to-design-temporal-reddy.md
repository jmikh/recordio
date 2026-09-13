# User Default Project Settings — Tiered Plan

**Status:** planned 2026-09-13. Steps 1–5 below; step docs are created when each step
starts (`user-default-project-settings-step-N.md`).

> **Step 0 (housekeeping):** plan mode only allowed writing to this file. First action
> of implementation is to move this doc, unchanged, to
> `plans/user-default-project-settings/user-default-project-settings-tiered-plan.md`
> (planning-skill convention: one folder per tiered plan, meaningful names) and delete
> this copy.

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
- (Added 2026-09-13) **No seeding.** Users who never saved defaults get the shipped
  factory defaults; nothing is written to the DB for them.

Decisions taken during planning (2026-09-13):

| Decision | Choice |
|---|---|
| Plan type | Tiered |
| Scope | Per **user** (not per workspace) — "personal" settings; a user's defaults follow them into every workspace |
| Save model on the page | **Explicit Save** with dirty state, Discard, and "Reset to Recordio defaults" |
| Editor action | Yes — "Use as my default settings" in the editor header |
| Preview media | Two sample images on the CDN (`samples/`) |
| Empty state | `NULL` in the DB → shipped defaults; Reset clears back to `NULL` (never snapshots today's factory values) |

### Reality check on the data-access rule

`.claude/CLAUDE.md` says DB access goes through "RPC or edge functions". Both are
decommissioned (`supabase/functions/` is empty, zero `.rpc(` calls; see
`supabase/sql/graveyard.sql`). The live pattern is **webapp `invokeFunction()` →
Fastify route in `server/src/routes/**` → SQL over `pg.Pool`**, with the client↔server
contract in `shared/api/`. This plan follows that. A CLAUDE.md wording fix is listed in
§3.9 (needs the user's go-ahead before editing).

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
— fetch the real timestamp, must sort last, one concern, `IF NOT EXISTS`, comment
explaining why — mirror `20260901212020_user_profile_reviewed.sql`):

```sql
-- Personal default project settings (plans/user-default-project-settings).
-- { schemaVersion, settings: ProjectSettings } written by
-- /user-project-defaults-set, cleared by /user-project-defaults-clear.
-- NULL = the user never saved defaults → the webapp uses the shipped
-- factory defaults (createDefaultSettings). Never seeded or backfilled.
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
- `/user-profile-get` does **not** return the blob (keeps that small payload as is).
- Also refresh the DDL snapshot `supabase/sql/tables/user_profiles.sql` via
  `supabase/sql/dump-tables.sh` if that is the team habit after a migration.

### 3.2 API — three routes (adding a route = 4 edits, see `plans/shared-api-contract.md`)

`shared/api/session.ts` (types) + `shared/api/index.ts` (`ApiRoutes` entries):

| Route | Request | Response | Notes |
|---|---|---|---|
| `POST /user-project-defaults-get` | `{}` (`EmptyRequest`) | `StoredProjectDefaults \| null` | No response schema (arbitrary jsonb — `fast-json-stringify` would strip fields; same reason `project-get` has none). Mirrors `userProfileGet.ts`: `SELECT project_defaults FROM user_profiles WHERE user_id = $1`, send `null` when no row or NULL. |
| `POST /user-project-defaults-set` | `{ schemaVersion: Integer ≥ 1, settings: Object(additionalProperties: true) }` | `{ saved: true }` | `bodyLimit: 64 * 1024` on the route. `INSERT … ON CONFLICT (user_id) DO UPDATE SET project_defaults = EXCLUDED.project_defaults, updated_at = now()` (upsert covers the no-profile-row edge exactly like `userReviewSet.ts`). Server does not validate the settings tree (precedent: `project-create-v2` passes `project_data` through). |
| `POST /user-project-defaults-clear` | `{}` | `{ cleared: true }` | `UPDATE user_profiles SET project_defaults = NULL, updated_at = now() WHERE user_id = $1`. Idempotent. |

```ts
// shared/api/session.ts
export interface StoredProjectDefaults { schemaVersion: number; settings: ProjectSettings; }
export const UserProjectDefaultsSetRequestSchema = Type.Object({
    schemaVersion: Type.Integer({ minimum: 1 }),
    settings: Type.Object({}, { additionalProperties: true }),
});
export interface UserProjectDefaultsSetResponse { saved: true }
export interface UserProjectDefaultsClearResponse { cleared: true }
```
(`ProjectSettings` import from `shared/types` — check `shared/api` stays free of
webapp/server imports; `shared/types` is fine.)

Server files: `server/src/routes/userProjectDefaultsGet.ts`, `…Set.ts`, `…Clear.ts`
(same folder and style as `userProfileGet.ts` / `userReviewSet.ts`: header comment with
Request/Response, `preHandler: app.requireUser`, `req.user!.id`), registered in
`server/src/app.ts` beside `userReviewSetRoutes`.

Tests: `server/test/userProjectDefaults.test.ts`, cloned from
`server/test/userReviewSet.test.ts` (two describes: auth/no-db → 401; `runIf(hasTestDb())`
e2e with `seedAuthUser`, `userToken`, `deleteAuthUsers`):
- get for a fresh user → `null` (proves no seeding);
- set → get round-trips the exact blob; second set replaces;
- clear → get `null`; clear on a user with nothing → 200;
- 400 on `schemaVersion: "6"` / missing `settings`; 413 on a >64 KB body;
- set creates the profile row when the signup trigger left none (`withProfile: false`).

Deploy order: migration → server → webapp (additive, safe under skew).

### 3.3 Client core: resolve, strip, adapt — `webapp/src/core/projectDefaults.ts`

Pure functions, unit-tested in `webapp/src/core/projectDefaults.test.ts` (next to
`migrateProject.test.ts`):

- `stripRecordingSpecificSettings(s: ProjectSettings): ProjectSettings` — drops
  `screen.crop`, `screen.outputCrop` (dead field), `camera.faceCenter`,
  `captions.transcriptionSource`; forces `autoCutApplied: false`. **Keeps**
  `background.storagePath` and `audio.music.storagePath` — those point at the user's
  asset library (`user_assets`, user-scoped, cross-project) and are hydrated on project
  load by `getProjectMediaPaths` (`shared/utils/projectMedia.ts`).
- `resolveProjectDefaults(stored: StoredProjectDefaults | null): ProjectSettings`
  - `null` → `createDefaultSettings()` (the shipped defaults; export it from `Project.ts`).
  - else wrap in a synthetic project `{ schemaVersion: stored.schemaVersion, settings,
    timeline: createDefaultTimeline(), userEvents: EMPTY_USER_EVENTS, screenSource:
    createPlaceholderSource(), autoEffectsGenerated: true }`, run `migrateProject()`
    (`webapp/src/core/migrateProject.ts` — reuses the v1→v2 rename and v3→v4 CDN URL
    rewrite for free), take `.settings`, then `mergeSettingsOntoDefaults(createDefaultSettings(), migrated)`.
  - `mergeSettingsOntoDefaults`: recursive merge where plain objects recurse, arrays and
    primitives from the stored blob win, `undefined` is skipped, and **stored keys absent
    from the factory are kept** (e.g. `background.storagePath`). This replaces the
    `if (!settings.X)` backfills that `useProjectStore.loadProject()` does for old
    projects — new fields always get factory values.
  - Finish with `stripRecordingSpecificSettings` (defensive) and clamp `camera.xPx/yPx`
    inside `outputSize`.
- `adaptDefaultsToSources(s, screenSource, cameraSource?)` — when
  `camera.shape === 'rect'` and a camera exists, recompute `widthPx` from the real camera
  aspect (`heightPx * cw/ch`) and re-clamp. Extract that math from
  `CameraSettings.tsx:37-62` (`handleShapeChange`) into `shared/utils/cameraShape.ts`
  (`applyCameraShape(settings, shape, cameraSourceSize | undefined, outputSize)`) and use
  it in both places.

Tests: strip removes exactly those fields; null → equals factory; a `schemaVersion: 3`
blob with an `/assets/backgrounds/…` URL comes back on `CDN_ORIGIN`; a blob missing
`overlay` gets the factory `overlay`; a stored `storagePath` survives the merge; rect
camera adapts to a 4:3 source.

### 3.4 Apply on import (the only creation path)

- `ProjectImpl.createFromSource(projectId, screenSource, userEvents, cameraSource?,
  microphoneSource?, settings?: ProjectSettings)` — `settings ?? createDefaultSettings()`.
  Stays a plain struct builder (project-model skill §1).
- `CloudProjectService.importRecordingLocalV2(…, opts?: { defaultSettings?: ProjectSettings })`
  (`webapp/src/storage/cloudProjectService.ts:133-181`) → calls
  `adaptDefaultsToSources` then `createFromSource(…, settings)`. Server
  (`projectCreateV2.ts`) already passes `project_data` through untouched.
- `webapp/src/storage/userDefaultsService.ts` (mirror of `userAssetService.ts`):
  `fetch()` → `resolveProjectDefaults`-ready blob or `null` (errors → `null` +
  `captureError(err, { flow: 'user_defaults', phase: 'fetch' })`), `save(settings)` (strips,
  stamps `CURRENT_SCHEMA_VERSION`, calls set), `clear()`.
- `ImportPage.tsx`: start `UserDefaultsService.fetch()` on mount (authenticated) into a
  ref; in `performUpload` (line ~152) do `Promise.race([defaultsPromise, 3 s timeout])`
  → `resolveProjectDefaults(result ?? null)` → pass as `defaultSettings`. **Import never
  fails or waits >3 s because of defaults**; on timeout/error use shipped defaults and add
  a Sentry breadcrumb. Add `used_personal_defaults: boolean` to the
  `trackProjectCreated` params.
- Never applies to existing projects (no backfill, no editor prompt).

### 3.5 Project store: template mode — `webapp/src/editor/stores/useProjectStore.ts`

- State `templateMode: boolean` (default `false`; **not** in zundo's `partialize`).
- `loadDefaultsTemplate(settings: ProjectSettings)`: `set({ project:
  buildDefaultsTemplateProject(settings) (without userEvents), userEvents:
  SAMPLE_USER_EVENTS, projectName: 'Sample recording', templateMode: true })` then
  `temporal.getState().clear()` — same shape as `loadProject`.
- `unloadDefaultsTemplate()`: `set({ project: ProjectImpl.create(), userEvents: EMPTY,
  projectName: 'Untitled Project', templateMode: false })` + `temporal.clear()`.
- **Auto-save guard** (subscription at the bottom of the file): skip scheduling when
  `templateMode` or `!project.id`; inside the timeout re-check
  `getState().templateMode === false && getState().project.id === project.id` before
  saving (protects a pending real-project save from picking up the template's
  `userEvents`, and stops the placeholder project from ever being saved).
- `webapp/src/core/defaultsTemplate.ts` — `buildDefaultsTemplateProject(settings)`:
  `id: 'defaults-template'`, `autoEffectsGenerated: true`,
  `screenSource { storagePath: SAMPLE_SCREEN_PATH, durationMs: 10000, hasAudio: true,
  size: 1920×1080, trackableContentRect: full frame }` (a trackable rect makes
  `ScreenSettings` show the toolbar card and lets `screenPainter` draw the toolbar),
  `cameraSource { storagePath: SAMPLE_CAMERA_PATH, size: 1280×720 }`,
  `microphoneSource { storagePath: SAMPLE_MIC_PATH, durationMs: 10000 }`, one output
  window `[0, 10000]`, one caption segment over the whole window with words
  "Your captions will look like this" (timed so one word is highlighted at
  `PREVIEW_TIME_MS`), all other segment arrays empty. `SAMPLE_USER_EVENTS`: one
  `urlChanges` entry (`https://recordio.cc/…`, timestamp 0) so the toolbar shows a URL,
  one mouse click and one keyboard event ("⌘ K") timed to be mid-animation at
  `PREVIEW_TIME_MS = 1500` (confirm the exact event shapes in `shared/types/core.ts` and
  the animation windows in `shared/painters/mouseClickPainter.ts` /
  `keyboardPainter.ts` when implementing). Sample URLs:
  `${CDN_ORIGIN}/samples/defaults-preview-screen-v1.avif` and
  `…/defaults-preview-camera-v1.avif` (§3.8).

### 3.6 Personal Settings page (dashboard)

**Routing / nav**
- `App.tsx`: `path.startsWith('/settings/personal')` → `<DashboardPage settingsPage="personal" />`;
  refactor the existing `showSettings` boolean into `settingsPage?: 'workspace' | 'personal'`
  (`/workspace/settings*` → `'workspace'`). Auth gating is inherited (`isGatedRoute`).
- `DashboardSidebar.tsx:158-173`: the "Manage" group renders for **every role**;
  inside it, `Workspace Settings` keeps its `currentRole === 'admin'` gate and a new
  `Personal Settings` item (`LuUserCog`) is always shown. `DashboardView` gains
  `'personal'`; `DashboardPage.handleViewChange('personal')` → `navigate('/settings/personal')`.
- `DashboardPage.tsx:383-417`: for `'personal'` render
  `<main className="flex-1 min-w-0 flex flex-col overflow-hidden p-8"><PersonalSettingsPage /></main>`
  (bounded height — the settings column scrolls internally, like the editor).

**Page — `webapp/src/pages/settings/personal/PersonalSettingsPage.tsx`**

Layout (the "like the editor, but not quite" cues are: dashboard sidebar stays, the
editor-ish surface is a framed card, and there is an explicit Save bar instead of
auto-save):

```
┌ Personal settings                                  [Using Recordio defaults] ┐
│ Defaults for every new project you create. Existing projects aren't affected.│
│                    [16:9 ▾] [↶][↷]  [Reset to Recordio defaults] [Discard] [Save defaults] │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌ card: bg-surface border-border rounded-[var(--radius-lg)] overflow-hidden ┐ │
│ │ nav w-44 │ settings w-80 (scrolls) │  PREVIEW · SAMPLE RECORDING           │ │
│ │ Background│ (BackgroundSettings…)  │  ┌──────────────────────────┐        │ │
│ │ Screen    │                        │  │   canvas at outputSize   │        │ │
│ │ Effects   │                        │  │   scaled to fit          │        │ │
│ │ Camera    │                        │  └──────────────────────────┘        │ │
│ │ Captions  │                        │  Zoom, spotlight & camera-move timing │ │
│ │ Audio     │                        │  apply to new projects but aren't     │ │
│ │ Motion    │                        │  visible in this still.               │ │
│ └───────────┴────────────────────────┴──────────────────────────────────────┘ │
```

- Header: `h1.heading-2` "Personal settings"; subtitle `text-sm text-text-muted`. Status
  chip (`text-badge` pill): "Using Recordio defaults" (stored `null`, clean) / "Custom
  defaults" / "Unsaved changes". Right controls: aspect-ratio `Dropdown` built from
  `ASPECT_RATIO_PRESETS` + `findPreset` (`shared/utils/aspectRatio.ts`; extract the
  `aspectRatioOptions` const out of `Header.tsx:26` into a shared module) calling
  `updateSettings({ outputSize })`; undo/redo ghost icon buttons via `useProjectHistory`;
  `Reset to Recordio defaults` (ghost; disabled when stored is `null` and clean; confirm
  `Modal`); `Discard` (base; only when dirty); `Save defaults` (primary; disabled unless
  dirty). All `Button`s from `@shared/components`, aria-labels on icon-only ones.
- Lifecycle: mount → "Loading defaults…" (visible text) → `UserDefaultsService.fetch()`
  → `resolved = resolveProjectDefaults(stored)` → `loadDefaultsTemplate(resolved)`;
  `baseline = JSON.stringify(stripRecordingSpecificSettings(resolved))`;
  `hasStored = stored !== null`. `isDirty = JSON.stringify(strip(project.settings)) !== baseline`
  (select `s.project.settings`). Unmount → `unloadDefaultsTemplate()` +
  `useMediaUrlStore.getState().revokeAll()` (same as editor unmount, `editor/App.tsx:106`).
  Load failure → card "Could not load your defaults." + Retry.
- Save → `UserDefaultsService.save(project.settings)` → toast (`role="status"`) "Defaults
  saved — new projects will use them", new baseline, `hasStored = true`. Error → toast
  `role="alert"`.
- Reset → confirm Modal ("Go back to Recordio's defaults? Your saved personal defaults
  will be removed.") → `clear()` → `loadDefaultsTemplate(createDefaultSettings())`,
  baseline = factory, `hasStored = false`, toast "Back to Recordio defaults".
- Discard → `loadDefaultsTemplate(resolveProjectDefaults(lastStored))`.
- Unsaved guard: `beforeunload` while dirty; in-app, a tiny
  `usePersonalDefaultsStore { isDirty }` that `DashboardPage.handleViewChange` consults
  and, if dirty, opens a `Modal` "Discard unsaved defaults?" [Keep editing] [Discard]
  before navigating.
- Analytics (`webapp/src/analytics/index.ts`, `trackXxx` function style):
  `trackPersonalSettingsPageLoaded()`, `trackPersonalDefaultsSaved({ source: 'page' | 'editor' })`,
  `trackPersonalDefaultsReset()`.

**`DefaultsSettingsPanel.tsx`** (same folder): a slim sibling of
`editor/components/settings/SettingsPanel.tsx:149-226` — `w-44` `SidebarNav` +
`w-80` content with `Scrollbar`, local `activeTab` state, device-frame preload — **minus**
the logo/back button, the `useUIStore` selection/inspector branch, and the disabled-camera
tooltip (the template always has a camera). Share the nav item list (label + icon) via a
small `settingsNavItems.ts` module so both panels stay in sync; the defaults panel appends
a seventh item **Motion** (§3.7).

**Template-mode adaptations inside the existing section components** (read
`useProjectStore(s => s.templateMode)`; each is a small conditional, no prop plumbing):

| Component | In template mode |
|---|---|
| `ScreenSettings.tsx` | Hide the Crop control (`setCanvasMode(CropEdit)` at ~line 293). Toolbar card shows because the template has a `trackableContentRect`. |
| `CameraSettings.tsx` | Hide the face-anchor entry (`FaceAnchorModal`). Add a template-only **Position** picker (4 corners → sets `xPx/yPx` with a margin) and a **Size** slider (`heightPx` as a fraction of `outputSize.height`, width per shape via `applyCameraShape`) — in the editor these are set by dragging the bubble on the canvas, which the still preview cannot do. |
| `CaptionsSettings.tsx` | Render only the style card (enabled, size, width, colors, word highlight); skip the transcription card and transcript tools. The style card's gate at ~line 497 becomes `settings.transcriptionSource \|\| templateMode`; drop the "requires OpenAI transcription" restriction on `wordHighlight` in template mode. |
| `AudioSettings.tsx` | No change needed (template sources have `hasAudio` + mic). Add a `text-label` note: "Applies to new recordings that have the matching track." |
| `BackgroundSettings.tsx`, `EffectsSettings.tsx` | No change. Custom uploads go to the user's asset library, so a custom background/music can be a default; `selectBackground` hydrates the blob URL, which the preview reads. |

### 3.7 Motion tab — `MotionDefaultsSettings.tsx`

`zoom`, `spotlight`, `cameraMove` and `overlay` defaults are today only editable through
the per-segment inspectors ("apply to all"), and the template has no segments. A
template-only tab exposes them with the same controls/ranges as the inspectors
(`ZoomInspector.tsx`, `SpotlightInspector.tsx`, `CameraMoveInspector.tsx`,
`OverlayInspector.tsx`): zoom enabled / maxZoom / transitionDurationMs / easing;
spotlight enabled / dimOpacity / enlargeScale / transitionDurationMs; camera move enabled /
transitionDurationMs / easing; overlay defaultDurationMs. Built from `CollapsibleCard`,
`Slider`, `Toggle`, `Dropdown`, using `updateSettings` + `useHistoryBatcher` (remember
those groups are shallow-replaced by `updateSettings` — always spread the full sub-object,
see `settingsSlice.ts:41-73`).

### 3.8 Preview — `DefaultsPreview.tsx` + `useDefaultsPreviewRenderer.ts`

A **still frame**, not a playback loop:

- `<canvas width=outputSize.width height=outputSize.height>` CSS-scaled to fit its box
  (inline style only for the computed aspect ratio), `rounded-[var(--radius-md)] shadow-sm`,
  eyebrow "Preview · sample recording" above, `text-label` footnote below.
- Resources, mirroring `CanvasContainer.tsx:365-369, 431-435`: hidden `<img>`s for the
  sample screen and camera (CDN, `crossOrigin="anonymous"`), the background image
  (`bgUrl = (bg.storagePath && mediaUrls[bg.storagePath]) || bg.imageUrl` when type is
  preset/custom) and the device frame (`getDeviceFrame(screen.deviceFrameId).imageUrl`
  when `screen.mode === 'device'`); `onLoad` schedules a render.
- Render = `drawBackground(ctx, bg, bg.backgroundBlurPx, outputSize, bgImg)` (as
  `CanvasContainer` does before the frame, ~lines 193-202 — copy the exact blur argument)
  then `PlaybackRenderer.render(resources, state)` (`shared/export/PlaybackRenderer.ts:52`)
  with `renderCtx: browserRenderContext`, `videoRefs: { [SAMPLE_SCREEN_PATH]: screenImg,
  [SAMPLE_CAMERA_PATH]: cameraImg }`, `deviceFrameImg`, `sourceCanvas: canvas`,
  `project`, `projectName: 'recordio.cc'`, `userEvents` (sample events),
  `currentTimeMs: PREVIEW_TIME_MS`, `timeMapper: new TimeMapper(project.timeline.outputWindows)`.
  Layers that show: background, padded/bordered/shadowed screen with toolbar + URL,
  click ring, hotkey pill, camera bubble, caption line with word highlight.
- Scheduling: subscribe to `useProjectStore` (`s.project`) + image loads → one
  `requestAnimationFrame`-coalesced render. No rAF loop.
- If a sample image fails to load, `PlaybackRenderer` simply skips that layer; show a
  small `text-label` "Sample media unavailable" over the canvas.

**Sample media (user action, before Step 4):** upload two immutable files to
`https://cdn.recordio.cc/samples/` (per the `cdn` skill: absolute CDN URLs, never
overwrite — hence the `-v1` suffix):
- `defaults-preview-screen-v1.avif` — 1920×1080, a clean app/browser **content**
  screenshot without browser chrome (the toolbar painter draws its own), ideally with a
  button near where the sample click lands.
- `defaults-preview-camera-v1.avif` — 1280×720, a neutral placeholder portrait
  (illustration or stock with rights), not a real team member.
CDN CORS already serves backgrounds with `crossOrigin="anonymous"`, so nothing to
configure.

### 3.9 Editor action — "Use as my default settings"

`webapp/src/editor/components/header/Header.tsx` (controls cluster around lines 128-230):
ghost icon `Button` (`aria-label="Use as my default settings"`, `Tooltip`) → `Modal`
(`role="dialog"`) "Make this project's look the default for new projects? This replaces
your personal defaults. Recording-specific items (crop, face anchor, caption text) aren't
included." [Cancel] [Set as defaults] → `UserDefaultsService.save(project.settings)` →
toast "Defaults updated" (+ "View" link to `/settings/personal` if the toast API supports
an action; otherwise plain) → `trackPersonalDefaultsSaved({ source: 'editor' })`. Signed-in
users only (the header already knows auth state).

### 3.10 Stale docs to fix (ask before editing — CLAUDE.md rule for skills)

- `.claude/CLAUDE.md` § Data Access: replace "RPC (DB functions) or edge functions" with
  the Fastify-route + `shared/api` contract rule.
- `.claude/skills/project-model/SKILL.md` §1: note that `importRecordingLocalV2` injects
  the user's resolved defaults into `createFromSource`, and that `createDefaultSettings()`
  is the fallback when `user_profiles.project_defaults` is NULL.
- `webapp/src/storage/cloudStorage.ts` class doc ("through the Supabase client with RLS")
  is stale — log in the agent-suggestions doc, don't fix inline.

---

## 4. Steps

| # | Step | Ships |
|---|---|---|
| 0 | Move this doc to `plans/user-default-project-settings/…-tiered-plan.md` | — |
| 1 | **Backend + contract** — migration, `shared/api` types + `ApiRoutes`, three routes, `app.ts` registration, `server/test/userProjectDefaults.test.ts` | Deployable alone (NULL everywhere, no behavior change) |
| 2 | **Core + apply on import** — `projectDefaults.ts` (+ tests), `shared/utils/cameraShape.ts` extraction, `createFromSource(settings?)`, `importRecordingLocalV2` option, `ImportPage` prefetch with 3 s race, `UserDefaultsService`, analytics param | Inert until someone has stored defaults |
| 3 | **Editor "Use as my defaults"** — Header button + confirm Modal + toast + analytics | First end-to-end value: set in one project, next import uses it |
| 4 | **Personal Settings page** — store `templateMode` + `loadDefaultsTemplate`/`unload` + auto-save guard, `defaultsTemplate.ts` + sample events, route/sidebar/`DashboardPage` wiring, `PersonalSettingsPage` (header bar, Save/Discard/Reset flows, loading/error), `DefaultsSettingsPanel`, `DefaultsPreview` renderer. **Prereq: sample images on the CDN.** | The page, with the six existing panels as they are |
| 5 | **Template-mode polish** — the §3.6 table adaptations (crop/face-anchor hide, captions style card, camera position/size), Motion tab (§3.7), dirty-navigation guard, page analytics, e2e smoke test, doc fixes (§3.10, with permission) | Feature complete |

Steps 1→2→3 are sequential; 4 depends on 2; 5 depends on 4.

---

## 5. Verification

**Automated**
- Server: `supabase start` (fresh volume or `supabase migration up`), `supabase/sql/deploy.sh`,
  then root `npm test` (loads `.env.test`, enables the real-Postgres tier) — the new
  `userProjectDefaults` suite plus the existing `userProfileGet`/`userReviewSet` suites
  green; `cd server && npm run typecheck`.
- Webapp: `projectDefaults.test.ts`, `migrateProject.test.ts` green; `tsc -b` clean;
  eslint on changed files.
- e2e (`e2e/tests/smoke.spec.ts` style): `/settings/personal` shows "Personal settings"
  and a "Save defaults" button; `/workspace/settings/billing` smoke still passes.

**Manual (local stack)**
1. Fresh user: `select project_defaults from user_profiles` is NULL; the page shows
   "Using Recordio defaults"; Save is disabled until a change.
2. Change background, padding, camera corner, aspect ratio → preview redraws each time;
   undo/redo works; DevTools Network shows **no** `project-update` calls while editing.
3. Save → toast; reload the page → same values; DB row now has the blob with
   `schemaVersion = CURRENT_SCHEMA_VERSION` and no `crop`/`faceCenter`/`transcriptionSource`.
4. Record via the extension → `/import` → editor opens with those settings (rect camera
   sized to the real camera aspect; custom background hydrated). An older project is
   unchanged.
5. Reset → confirm → DB column back to NULL → next import uses shipped defaults.
6. In the editor, "Use as my default settings" → Personal Settings page reflects it.
7. Kill the API (or throttle to make `/user-project-defaults-get` exceed 3 s) → import
   still succeeds within the normal time using shipped defaults.
8. Dirty-state guard: edit, click "All recordings" in the sidebar → confirm modal; tab
   close prompts via `beforeunload`.

---

## 6. Step log

_(append as steps complete: date, and any design change propagated into §3)_

---

## 7. Open knobs / out of scope

- Per-workspace overrides — out of scope; revisit only if teams ask for shared house styles.
- A custom background/music asset deleted from the library while referenced by defaults:
  the preview shows the fallback and a new project gets a dangling `storagePath` (same
  handling the editor already has for missing assets). Follow-up: clear the reference on
  asset delete.
- Body cap 64 KB and import wait 3 s are starting values.
- Camera drag/resize on the preview canvas (instead of the corner picker + size slider)
  — nice-to-have later.
- Applying defaults to existing projects — explicitly not part of this.

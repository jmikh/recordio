# Background activity: global indicator, page-independent renders, resumable pending projects (oneshot)

> On approval, save this as `plans/background-activity-oneshot.md` (planning skill convention) and implement from there. Load `ui-guidelines` before writing any component.

## Context

Two background tasks today are tied to the page they started on:

- **Cloud render** lives entirely in the component-local hook `webapp/src/editor/components/settings/useCloudRender.ts`. Leaving the editor unmounts the Header → the user has no idea it's still rendering. Worse, the `setInterval` poller has no cleanup, so it keeps running invisibly and fires `a.click()` for the download with nobody watching.
- **Media upload** already runs page-independently (`CloudProjectService.startMediaUpload` is fire-and-forget), but it's surfaced by a fixed 320px bottom-right card (`UploadProgressToast`) that the user finds too distracting, plus a "Don't close this tab" nag.
- **Pending projects are fragile**: blobs are cached in the Cache API *before* upload starts, and `tryResumeUpload` can resume from that cache — but only when the editor loads the project. `project-list` filters `upload_status = 'ready'`, so after a browser close the project simply vanishes from the dashboard and the user can't get back to it. Nothing ever cleans up abandoned pending rows.

Decisions made with the user: oneshot plan; indicator mounted in each page's header (no shared header exists); stale pending projects are **soft-deleted** after 30 days (existing `projects.purge-deleted` hard-deletes 30 days later); the `beforeunload` warning is **removed**; surviving a page refresh for *renders* is out of scope; no render cancel (no server route).

## Design

### 1. `useActivityStore` — one global task list (`webapp/src/activity/useActivityStore.ts`)

```ts
type ActivityStatus = 'active' | 'completed' | 'failed';
interface ActivityTaskBase {
    id: string;                    // `render:${projectId}` | `upload:${projectId}` — one per kind per project
    projectId: string; projectName: string; projectSlug: string | null;
    status: ActivityStatus;
    progress: number | null;       // 0..1; null = indeterminate (saving/queued, upload before first byte)
    error: string | null;
    createdAt: number; completedAt: number | null;
    seen: boolean;                 // false from completion until the popover is opened
    retry: (() => void) | null;    // set by the owning service (precedent: mediaUploadError.onRetry)
}
interface RenderTask extends ActivityTaskBase { kind: 'render'; phase: Exclude<CloudRenderPhase,'idle'>; quality: ExportQuality; renderStoragePath: string | null }
interface UploadTask extends ActivityTaskBase { kind: 'upload' }
// actions: upsertTask, patchTask, removeTask, markAllSeen, clearSeenCompleted, setPopoverOpen
// selectors (pure, unit-testable): selectTaskList, selectActive, selectAggregateProgress (mean of active, null-progress counts as 0; null when none active), selectRenderTask(projectId), selectUploadTask(projectId)
```

Indicator state is derived, in priority: any `failed` → error dot · any `active` → ring at aggregate progress (indeterminate spin only when every active task has null progress) · latest `completedAt` < 3s ago → check · any `completed && !seen` → dot · no tasks → hidden. Count badge when `tasks.length > 1`.

Seen/ack: popover open → `markAllSeen()`; popover close → `clearSeenCompleted()` (completed rows vanish; failed rows stay until Retry or ✕).

### 2. `CloudRenderService` (`webapp/src/activity/cloudRenderService.ts`)

Static class, same style as `CloudProjectService`. Port `useCloudRender` logic verbatim, swapping `setPhase/setProgress/onToast` for store writes and dropping toasts (see §4). Keep every `captureError` / `trackRenderInCloudCompleted|Failed` call with the same `phase` values, the `Notification` permission/notify calls (guard `typeof Notification !== 'undefined'`), and the save-first + `getCloudVersion` check.

```ts
static start(projectId, projectName, quality = '1080p'): Promise<void>  // no-op if task active; replaces a completed/failed task
static download(projectId): Promise<void>   // re-fetch signed URL for task.renderStoragePath → a.click()  (popover/toast "Download")
static retry(projectId): void               // failed@downloading → download(); else start() with stored quality
static isActive(projectId): boolean
private static pollers = new Map<projectId, interval>   // cleared on terminal state
```

Fixes folded in: capture `getProjectMeta()` once at start and reuse for the completed event (today it re-reads `useProjectStore` at completion, which may hold a different project by then); no 1.5s reset-to-idle — the completed task stays until seen. `projectSlug` from `useProjectMetaStore.getState()` at start. Auto-download on completion still fires from the poller even on another page (same SPA document); `download()` is the gesture-backed fallback.

**`useCloudRender(projectId, projectName)`** becomes a thin selector returning `{ phase, progress, isActive, startCloudRender(quality) }`; re-export `CloudRenderPhase` so `DownloadModal` keeps compiling. Drop `onToast`/`cleanup`.

- `Header.tsx`: `useCloudRender(project.id, projectName)`; `handleStartCloudRender` → `cloudRender.startCloudRender(quality)`. Insert `<ActivityIndicator />` before the Share button. Replace `SyncIndicator` (`:26-43`) with **`UploadStatusBadge`** (new, same folder) reading `selectUploadTask(project.id)`: active → `<StatusBadge variant="primary">Uploading {pct}%</StatusBadge>` (`Uploading…` while null); failed → `<StatusBadge variant="secondary">Upload failed</StatusBadge>` in a Tooltip with the error, click opens the popover. `isSyncingMedia` (`:50`) → per-project selector.
- `DownloadModal.tsx`: `CloudRenderView` auto-start condition (`:223`) → `phase === 'idle' || 'failed' || 'completed'` (a finished task must not block a new render). **Remove** the `maybeOpenLeaveReviewModal('export_completed')` effect (`:75-79`) — it moves to `ActivityToasts` (transition-based, fires even off the editor).

### 3. Upload → store bridge (least churn) — `webapp/src/storage/cloudProjectService.ts`

Keep `useSyncStatusStore` writes as they are; add activity-store writes at the four existing call sites:
1. `startMediaUpload` (after the `activeUploads` dedupe): `upsertTask({ id: uploadTaskId(projectId), kind:'upload', status:'active', progress:null, projectSlug, … })`. Add optional `slug?: string` param (ImportPage has it; resume path gets it from the list item).
2. `updateAggregateProgress`: `patchTask({ progress })`.
3. After `confirmProjectUpload`: `patchTask({ status:'completed', progress:1, completedAt, seen:false })`.
4. `.catch`: `patchTask({ status:'failed', error, retry })` with the existing retry closure. Remove `setMediaUploadError`; drop `mediaUploadError`/`setMediaUploadError` from `syncStatusStore.ts` (only consumers were this service + the deleted toast).

**Per-project save gate** — `saveProject` (`:508-509`) currently blocks *all* saves while `pendingMediaUploads > 0`; once the dashboard resumes several uploads this would freeze saves on unrelated projects. Change to `if (this.activeUploads.has(projectId)) return;`. Switch the other global readers to per-project selectors: `CaptionsSettings.tsx:56`, `ShareModal.tsx:37` (project id via `useProjectStore`). Leave `pendingMediaUploads`/`currentUpload` writes in place (harmless).

Delete `UploadProgressToast.tsx` and `useUploadBeforeUnloadWarning.ts` + their references in `App.tsx` (`:19-20,55,166`); mount `<ActivityToasts />` there instead. Fix the comment at `ImportPage.tsx:252-254`.

### 4. Components (`webapp/src/activity/`, ring in `shared/components/`)

- **`shared/components/ProgressRing.tsx`** (+ barrel export): `progress: number|null`, `size=20`, `strokeWidth=2`, `children` (centre icon). SVG track + `stroke-dasharray/dashoffset` arc, `animate-spin` when null. Tokens per ui-guidelines.
- **`ActivityIndicator.tsx`** `({ placement?: 'down'|'up' })`: null when no tasks. Ghost-button-sized trigger: `ProgressRing` around a cloud icon; check icon for 3s after latest `completedAt` (effect timer keyed on `max(completedAt)`); unseen dot (`bg-primary`) / error dot (`bg-destructive`) top-right; count badge (`text-badge`). Click toggles popover (`markAllSeen` on open, `clearSeenCompleted` on close); click-outside + Escape close, copied from `UserMenu.tsx:28-41`. `'down'` → `absolute right-0 top-full mt-2 z-[var(--z-index-dropdown)]`; `'up'` → portal + fixed rect like `UserMenu openDirection="up"`. `aria-label="Background activity"`, `aria-expanded`.
- **`ActivityPopover.tsx`**: `w-80 bg-surface-raised border border-border rounded-lg shadow-float`; header "Activity" + `XButton`. Row: project name, status line, thin bar, actions. Status lines — render: `Saving…` / `Queued…` / `Rendering {quality} · {pct}%` / `Downloading…` / `Export ready` / `Render failed — {error}`; upload: `Uploading recording · {pct}%` / `Upload complete` / `Upload failed — {error}`. Actions: `Open project` (navigate(editorPath(slug)), hidden when slug null); `Download` (completed render → `CloudRenderService.download`); `Retry` (`task.retry`); ✕ → `removeTask` on completed/failed rows.
- **`ActivityToasts.tsx`**: renders nothing; `useActivityStore.subscribe` in an effect (unsubscribe on cleanup), diff tasks by id:
  - new render task → `info` "Rendering in the cloud" / "We'll let you know when it's ready."
  - render active→completed → `success` "Export ready" + `action { label:'Download again', onClick: download }` + `maybeOpenLeaveReviewModal('export_completed')`
  - render active→failed → `error`, `duration: 0`, `action { Retry }`
  - upload active→completed → `success` "Upload complete"; active→failed → `error`, `duration: 0`, `action { Retry }`
  - upload start: no toast (header tag / card already show it).
- **`Toast.tsx`**: `action?: { label; href?; onClick? }` — render `<button>` when `onClick` (then `startExit('clicked')`); existing `{label, href}` callers unchanged.

Mount points: editor `Header.tsx` right cluster before Share; `ScreenshotHeader.tsx:81-86` after `{children}` before `UserMenu`; `VideoPage.tsx:191` first in the right cluster, only when `isAuthenticated`; `DashboardSidebar.tsx` a `px-2 pb-1` row above the account row, `{!inDrawer && <ActivityIndicator placement="up" />}` with a visible "Activity" label (sidebar has room).

### 5. Pending projects survive browser close

**Server — `server/src/routes/projects/projectList.ts`**: switch from `jsonb_agg` to row-per-project so pending rows can be post-processed. Add `'upload_status', p.upload_status` and `'project_data', CASE WHEN p.upload_status='pending' THEN p.project_data END`; WHERE becomes
`p.upload_status = 'ready' OR (p.upload_status = 'pending' AND p.owner_id = $2 AND p.deleted_at IS NULL)`.
In TS, for pending rows: `media_paths = getProjectMediaPaths(project_data).filter(type in screen|camera|mic)` (from `services/projectMedia.ts`), then delete `project_data`. Background/music are excluded on purpose — personal defaults can stamp a custom background `storagePath` that is never in BlobCache. Soft-deleted pending rows are excluded server-side so they never reach Trash. Update the header comment. Update `server/test/projects/projectList.test.ts` (`:107` asserts pending excluded → now: own pending included with `media_paths` and no `project_data`; another member's pending excluded; soft-deleted pending excluded).

**Shared — `shared/api/projects.ts` `CloudProjectSummary`**: `upload_status: 'pending'|'ready'; media_paths?: { storagePath; type: 'screen'|'camera'|'mic' }[]`.

**Client — `cloudProjectService.ts`**:
- `ProjectListItem` += `uploadStatus`, `mediaPaths | null`. `listProjects` maps them, then filters: pending item kept only if `mediaPaths.length > 0` and `BlobCache.has()` is true for every path (`Promise.all`). Both `DashboardPage` and `NavDrawer` counts use `listProjects`, so they agree for free.
- Extract `resumeUploadFromPaths(projectId, projectName, slug, paths)` from `tryResumeUpload:295-320` (per-path `getBlobIfCached` → `startMediaUpload(…, 'project-media', …)`). `tryResumeUpload` keeps its signature (metadata → paths → `resumeUploadFromPaths`). Add `resumePendingUploads(items)`: for each pending item not in `activeUploads`, fire `resumeUploadFromPaths` (errors captured). Dedupe via `activeUploads` makes StrictMode/double effects safe. `loadProject:439-455` unchanged.

**Dashboard — `DashboardPage.tsx`**:
- After `setAllProjects(loaded)` in the load effect (`:201-212`): `CloudProjectService.resumePendingUploads(loaded)`.
- `trashProjects` memo (`:109`): `&& p.uploadStatus === 'ready'` (belt and braces).
- Card render (`:716-742`): pending items get `badge={<UploadingBadge projectId={item.id} />}` (new, dashboard folder; reads `selectUploadTask`: active → `Uploading {pct}%`, failed → `Upload failed`, none → `Uploading`), no `onShare`; keep `onOpen`/`onDelete`.
- Subscribe to the activity store: when an upload task for a listed project completes → `setAllProjects(prev => uploadStatus:'ready')` so the duration badge returns (`durationMs` arrives on next list load — acceptable).
- On delete of a project, `removeTask` for its non-active tasks; active ones continue.
- `libraryCounts.ts`: `yoursCount` includes pending (visible in the grid); `ownedProjectCount` excludes pending to match the server cap (`projectCreateV2.ts:107-122`). Add/extend its test.

### 6. Daily job — `projects.expire-stale-pending` (`server/src/jobs/projectsExpireStalePending.ts`)

`expire` is in the closed verb set (`jobs/index.ts:6-8`), so no new verb. Batch 100, `THIRTY_DAYS_MS`, cutoff from `deps.clock.now()`:

```sql
UPDATE projects SET deleted_at = $1
WHERE id IN (SELECT id FROM projects
             WHERE upload_status = 'pending' AND deleted_at IS NULL AND permanently_deleted = false
               AND created_at < $2
             ORDER BY created_at LIMIT 100)
RETURNING id
```

Header comment: 30-day pending → soft-delete → `projects.purge-deleted` hard-deletes row + `${created_by}/${id}/` S3 prefix (incl. partial tus objects) 30 days later. Registry entry: `period: 'daily'`, `{ itemsProcessed: r.processed, itemsFailed: 0, batchFull: r.processed >= LIMIT }`.
Test `server/test/jobs/projectsExpireStalePending.test.ts` mirrors `screenshotsPurgeDeleted.test.ts`: LOCAL-DATA SAFETY comment, clock pinned `2000-01-01`, registry assertion, `describe.runIf(hasTestDb())`: old pending → `deleted_at = clock`, `upload_status` still pending; recent pending / old ready / already-deleted untouched; re-run is a no-op. Add `createdAt?: string` to `SeedProjectOptions` in `server/test/helpers/db.ts` (`COALESCE($15::timestamptz, now())`).

## Implementation order

1. `ProgressRing` + barrel export; `Toast.tsx` action `onClick`.
2. `useActivityStore.ts` + `useActivityStore.test.ts` (selectors, aggregate math, seen/clear).
3. `cloudRenderService.ts` (port hook); `useCloudRender.ts` selector; `Header.tsx`, `DownloadModal.tsx` edits. `cloudRenderService.test.ts` (`vi.mock` client/cloudProjectService/analytics/sentry, fake timers): start→queued→polling→completed→download; failed job → task failed + `trackRenderInCloudFailed({phase:'server_render'})` + poller cleared; retry; start-while-active no-op.
4. Upload bridge + `slug` param + per-project save gate + `resumeUploadFromPaths`/`resumePendingUploads` + list mapping/filter; `syncStatusStore` cleanup; delete toast + unload hook; `App.tsx`; `ImportPage.tsx`. Update `cloudProjectService.test.ts` (add `has` to BlobCache mock; pending filter kept/dropped/ready-untouched; task lifecycle; resume).
5. `UploadStatusBadge`; per-project selectors in `CaptionsSettings`/`ShareModal`.
6. `ActivityIndicator`, `ActivityPopover`, `ActivityToasts`; mount in the four hosts.
7. Server `projectList.ts` + shared type + route test.
8. Dashboard changes + `UploadingBadge` + `libraryCounts`.
9. Job + registry + seed `createdAt` + job test.
10. `npm run lint`, `tsc -b` in webapp and server, `npx vitest run` from repo root (loads `.env.test` for the DB tier).

## Edge cases

- One render + one upload per project max (keyed ids). "Render again" replaces the completed task → new "Rendering" toast.
- Retry keeps the same task id (no duplicate rows). Render retry after `downloading` failure only re-downloads; server `render-job-create` is a cache hit for the same version.
- Deleted project: "Open project" lands on `?error=Project not found` (existing path) — acceptable.
- Refresh mid-render: task lost (out of scope); the server job finishes anyway.
- Dashboard auto-resume of N projects runs concurrently; if bandwidth contention bites, a `MAX_CONCURRENT_RESUMES` cap is a small follow-up.
- Fresh browser profile / cleared site data: pending projects hidden (no BlobCache) — by design. Trash never shows pending.
- e2e: `e2e/fixtures/project.ts` confirms upload so seeded rows are `ready`; no spec asserts the old toast text; stale pending rows from other runs are hidden in a fresh Playwright context.

## Verification

Unit: tests listed in steps 2–4, 7–9. Run `npx vitest run` from the repo root.

Manual (per `START_LOCALLY.md`: `supabase start`, `npm run dev:server`, `npm run dev:webapp`, `npm run build:render-page && npm run dev:render-worker`):
1. Import a recording → editor shows `Uploading NN%` by the name + header ring; go to `/` mid-upload → sidebar ring continues, card shows `Uploading NN%`; on completion: check → dot → "Upload complete" toast; open popover → dot clears.
2. Close the tab mid-upload; reopen `/` → pending card with `Uploading`, upload resumes (Network tab shows tus PATCHes); card gets its duration on next reload.
3. Same user in a second browser profile → pending project not listed; Trash never shows it.
4. Editor → Download → Cloud export → navigate to `/` immediately → sidebar ring advances; "Export ready" toast with "Download again"; MP4 downloads; popover lists the render with Download / Open project.
5. Stop the render worker, start a cloud render → persistent "Render failed" toast + error dot; Retry from popover after restarting the worker.
6. Signed out on `/video/{slug}` → no indicator; signed in with tasks → indicator present.
7. Job: seed a pending project with `created_at` 40 days ago, run the job (test or scheduler tick) → `deleted_at` set, row absent from `/project-list`.

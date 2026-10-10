# Export captions: burn in / separate SRT / none — oneshot plan

> On approval, this doc is saved as `plans/export-captions-oneshot.md`, following the planning skill.

## Context

Today an export burns captions in whenever `project.settings.captions.enabled` is on. That flag is the editor's "Hide" toggle in the Captions › Style card. Users can only get an `.srt` from the Captions panel's "Download SRT" button, and the export dialog has no caption setting.

The user wants the export dialog to offer **one 3-way choice** (confirmed):

- **Burn in**: captions drawn into the video.
- **SRT file**: clean video plus a separate `.srt` download.
- **None**: clean video, no subtitle file.

The dialog choice decides the output. It defaults to the editor toggle (`enabled` → Burn in, otherwise None), and the choice overrides that toggle for this export only. The editor toggle still controls the preview and the share (Mux) video.

## Key facts

- **One draw path.** `PlaybackRenderer.render` draws captions only when `settings.captions.enabled ?? true` (`shared/export/PlaybackRenderer.ts:235`). `frameSignature.ts:109` checks the same flag, and both read `renderProject`, the scaled copy made in `ExportManager.runExport` (`shared/export/ExportManager.ts:172`).
  - So overriding `captions.enabled` on the project before `scaleProject` is the whole render-side change. Painters and frame signatures need no changes.
- **The same `ExportManager` runs in two places:** locally (`useLocalRender.ts`) and in the cloud (`render-worker/render-page/main.ts`).
- **Cloud renders are cached.** Each completed render is cached under `(project_id, cloud_version, quality, fps)`; see the CTE in `server/src/services/renderJobs.ts:89-122`, the unique index, and `projectRenderPath`. A caption override changes the output, so **it must be part of that key**. Otherwise a cache hit returns the wrong file.
- **The Mux/share render** is identified by `isMuxRender` (quality + fps, `server/src/services/muxUpload.ts:30`) and by two `render_jobs` joins in `server/src/routes/sharedVideoGet.ts` (~L146, ~L340). An override render must never feed Mux.
- **SRT logic already exists** but sits inside the component: `getVisibleTranscriptSegments`, `formatSubtitleTime` and `handleDownloadSrt` in `webapp/src/editor/components/settings/CaptionsSettings.tsx:140-178`. It uses cached output times, drops cut and hidden words, and writes `HH:MM:SS,mmm`.
- **The fps option already went through this whole pipeline** (commit `2ac5fde4`). Its file list is the template for this change.

## Design

### 1. Types (`shared/utils/exportQuality.ts`, next to `ExportQuality` and `ExportFps`)

```ts
/** What the export dialog offers. */
export type CaptionExportMode = 'burn' | 'srt' | 'none';
/** Render-time caption override. 'project' = follow settings.captions.enabled. */
export type ExportCaptions = 'project' | 'burn' | 'none';

/** Override only when it differs from the project, so the common case keeps
 *  sharing the cache with existing renders and the Mux render. */
export function resolveExportCaptions(mode: CaptionExportMode, projectCaptionsEnabled: boolean): ExportCaptions
// burn+enabled → 'project'; burn+disabled → 'burn'; srt|none + enabled → 'none'; srt|none + disabled → 'project'
```

### 2. Render-side override (`shared/export/ExportManager.ts`)

- Add `captions?: ExportCaptions` to `ExportOptions` (default `'project'`).
- In `runExport`, before `scaleProject`: when the value is not `'project'`, shallow-copy the project with `settings.captions.enabled = (captions === 'burn')`. The caller's project must not be mutated.

### 3. Shared SRT helpers (`shared/utils/captionUtils.ts`)

Move the logic out of `CaptionsSettings.tsx` without changing its behaviour:

```ts
export interface SubtitleLine { startMs: number; endMs: number; text: string }
/** Lines as they play in the output: visible segments, words neither cut nor hidden, output time. */
export function getSubtitleLines(segments: CaptionSegment[] | undefined): SubtitleLine[]
export function formatSrt(lines: SubtitleLine[]): string   // keeps the current floor-based HH:MM:SS,mmm
```

- `CaptionsSettings.tsx` Copy and Download SRT switch to these helpers.
- Add `webapp/src/lib/downloadBlob.ts` (`downloadBlob(blob, filename)`), the anchor-click helper. It is used by the new SRT downloads, the two video downloads touched here, and `CaptionsSettings`. Other copies of that pattern stay as they are.

### 4. Export dialog (`webapp/src/editor/components/settings/DownloadModal.tsx`)

- Add a **Captions** row with a `MultiToggle<CaptionExportMode>`, same layout as Resolution:
  - Options: `Burn in` / `SRT file` / `None`, each with a tooltip ("Draw captions into the video" / "Clean video + .srt subtitle file" / "No captions").
  - Load the `ui-guidelines` skill before writing it; the icon is `LuCaptions` if one is used.
- Show the row only when `getSubtitleLines(project.timeline.captionSegments).length > 0`. Without captions, the export behaves as today with `'project'`.
- Default: `settings.captions.enabled ?? true ? 'burn' : 'none'`. Like the other options it lives in `useState` and is not persisted.
- Subtitle line: `… · MP4` becomes `… · MP4 + SRT` in SRT mode.
- On Export, build an `ExportRequest` once:

  ```ts
  { quality, fps, captions: resolveExportCaptions(mode, enabled), srt: mode === 'srt' ? formatSrt(lines) : null }
  ```

  - The SRT is a snapshot at click time and matches the version being rendered.
  - `onStartCloudRender` takes this object instead of `(quality, fps)`.
  - `LocalRenderView` / `useLocalRender` receive `captions` and `srt` the same way.

### 5. Delivery

- **Shared file name.** The `.srt` gets the same base name as its MP4, so VLC, QuickTime and others load it automatically:
  - local: `${base}_local.mp4` + `${base}_local.srt`
  - cloud: `${base}.mp4` + `${base}.srt`
- **Local** (`useLocalRender.ts`): pass `captions` into `ExportOptions`. After the MP4 download, download `srt` as a `text/plain` blob when present.
- **Cloud** (`webapp/src/activity/cloudRenderService.ts`, `useCloudRender.ts`, `useActivityStore.ts`):
  - `start(projectId, projectName, request)`.
  - `RenderTask` gains `captions: ExportCaptions` and `srt: string | null`, so retry and re-download keep them.
  - The `render-job-create` body gains `captions`.
  - `downloadFile` saves the `.srt` right after the MP4.
- **SRT always comes second.** The MP4 comes first so it is never the file Chrome's "download multiple files" prompt blocks. At worst the user sees that prompt once, for the SRT.

### 6. Cloud plumbing (`captions` threaded like `fps`)

1. **Migration** `supabase/migrations/<ts>_render_jobs_captions.sql`:
   - `ADD COLUMN IF NOT EXISTS captions TEXT NOT NULL DEFAULT 'project' CHECK (captions IN ('project','burn','none'))`.
   - Recreate `idx_render_jobs_one_completed_per_version` on `(project_id, cloud_version, quality, fps, captions) WHERE status='completed'`. This only relaxes the constraint, and existing rows become `'project'`, which is correct.
2. **`server/src/routes/renderJobCreate.ts`**: the body gains `captions: Type.Optional(Union('project','burn','none'))` with the comment "Mirrors ExportCaptions", default `'project'`. No new entitlement gate.
3. **`server/src/services/renderJobs.ts`**:
   - `GetOrCreateRenderJobOptions.captions` (default `'project'`).
   - The CTE gets `AND captions = $7` and the INSERT column.
   - `projectRenderPath` receives it, and `submitJob` sends it.
   - `sharedVideoPublish.ts` omits it, so the share render stays `'project'`.
4. **`server/src/services/storagePaths.ts` `projectRenderPath`**: names are unchanged for `'project'`, and get a `_captions-burn` / `_captions-none` suffix otherwise. Existing paths stay valid.
5. **Mux identity**:
   - `isMuxRender` also requires `job.captions === 'project'`.
   - `renderJobWebhook.ts` SELECT adds `captions`.
   - Both `render_jobs` joins in `sharedVideoGet.ts` add `AND rj.captions = 'project'`. That file has unrelated uncommitted edits; touch only those two queries.
6. **`server/src/ports/renderWorker.ts`**: `RenderJobSubmission.captions`.
7. **Render worker**:
   - `render-worker/src/server.ts` `RenderBody.captions?`, validated like `fps` (400 on an unknown value, default `'project'`).
   - Thread it through `runRender` and `_runRender`, then `playwrightRender.ts` config and `__RENDER_JOB__`.
   - `render-page/main.ts`: `RenderJob.captions?`, passed into `ExportOptions`.

**Deploy order:** migration → render-worker → server → webapp. An old worker ignores `captions` and would store a captioned file under a `'none'` key, so the worker must ship before the server.

## Out of scope

- Logged to `plans/export-captions-agent-suggestions.md` if they come up:
  - Cloud renders fall back from Satoshi to another font (`plans/vfr-export-agent-suggestions.md`).
  - A Mux text track or VTT for the share page.
  - Word-level filtering differences between the painter, the editor SRT and the server transcript.
- Removing or renaming the editor's Hide toggle.

## Verification

1. **Unit tests**, run with `npx vitest run <paths>`:
   - `shared/utils/captionUtils.test.ts`: `getSubtitleLines` drops cut segments, cut words and hidden words; `formatSrt` numbering, `,` separator and hour padding.
   - `shared/utils/exportQuality.test.ts`: the four `resolveExportCaptions` cases.
   - `webapp/src/activity/cloudRenderService.test.ts`: `captions` in the job body; `.srt` downloaded after the MP4 on completion, cache hit and retry.
2. **Server tests** (`cd server && npm test`), with `seedRenderJob` gaining `captions` in `server/test/helpers/db.ts`:
   - `storagePaths.test.ts`: the suffix.
   - `renderJobCreate.test.ts`: separate jobs per `captions` value, default `'project'`, an invalid value gives 400, and the cache hit respects the key.
   - `renderJobWebhook.test.ts`: a completed `'none'` render at 1080p/60 does **not** upload to Mux.
   - `sharedVideoGet.test.ts`: progress joins ignore override renders.
   - `adapters/renderWorker.test.ts`: body passthrough.
3. **Typecheck and lint**: `npm run build:webapp:dev`, `cd server && npm run typecheck`, `npm run lint`.
4. **Manual, local export** (the `run` skill to launch, Chrome tools to drive), on a project with captions:
   - **Burn in**: captions visible in the MP4.
   - **SRT file**: clean MP4, plus `X_local.srt` with the same base name; VLC loads it automatically and the timing lines up across a cut.
   - **None**: clean MP4 and no `.srt`.
   - **Editor Hide on + Burn in**: captions still burned.
   - **A project with no captions**: no Captions row.
5. **Manual, cloud export** (local stack with the worker): do the same three modes.
   - Check the `render_jobs.captions` values and the storage paths.
   - Re-exporting the same mode is a cache hit.
   - A share publish still uses the `'project'` render.

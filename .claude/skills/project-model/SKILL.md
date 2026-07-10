---
name: project-model
description: How projects are created, stored, versioned, edited with batched history, and how source/output time works. Use when modifying project types, storage, timeline logic, migrations, undo/redo, or time mapping.
---

# Project Model

## 1. Creation & Auto Effects

Flow: the Chrome extension records screen + optional camera/mic into a `RawRecording` (`shared/types/core.ts`) → the webapp import flow calls `CloudProjectService.importRecording*()` (`webapp/src/storage/cloudProjectService.ts`) → `ProjectImpl.createFromSource()` (`webapp/src/core/Project.ts`) builds the `Project` struct → media uploads to cloud storage (tus/chunked), metadata via edge functions.

**`createFromSource` is a plain struct builder** — default settings, one full-length `OutputWindow`, empty segment arrays, `autoEffectsGenerated: false`.

**Auto zoom/spotlight segments are generated on first editor open**, not at upload. `useProjectStore.loadProject()` checks `project.autoEffectsGenerated`; if false it runs `calculateAutoZooms` / `calculateAutoSpotlights` / `getAllFocusAreas` (`webapp/src/editor/zoom/`, `webapp/src/editor/spotlight/`) from `userEvents`, stamps the results on the timeline, and flips the flag. This happens *before* `set()` so the effects are part of the initial, non-undoable state.

⚠️ Never infer "needs generation" from empty `zoomSegments` — an empty array may mean the user deleted them. Only the flag decides.

The `Project` type lives in `shared/types/project.ts`.

## 2. Storage & Sync (pointers)

Cloud-first via Supabase. Entry points, not descriptions — read the files:

- `webapp/src/storage/cloudProjectService.ts` — orchestration: import, load, save, conflict handling
- `webapp/src/storage/cloudStorage.ts` — server calls (edge functions: `project-create-v2`, `render-job-create`, `mux-video-*`, …)
- `webapp/src/storage/blobCache.ts` — media cache using the **Cache API** (`caches.open`), keyed by storagePath
- `webapp/src/storage/useMediaUrlStore.ts` — transient blob URLs for playback (never persisted)
- Video sharing uses **Mux** (`shared_videos` table + `mux-video-*` edge functions)

**Auto-save:** a `subscribeWithSelector` subscription at the bottom of `useProjectStore.ts` debounces project changes 2s, re-attaches `userEvents`, and calls `CloudProjectService.saveProject`, which skips no-op writes via SHA-256 hash and raises a conflict modal on cloud version mismatch.

### userEvents separation (runtime vs persistence)

`userEvents` is persisted as part of the project JSON, but `loadProject()` strips it into a separate store slot so zundo doesn't snapshot the huge arrays on every mutation:

- `useProjectData()` / `s.project` does NOT contain `userEvents` at runtime
- read events via `useProjectStore(s => s.userEvents)` or `useUserEvents()`
- auto-save re-attaches them before writing

## 3. Versioning & Migrations

- Constant: `CURRENT_SCHEMA_VERSION` in `webapp/src/core/Project.ts`
- Migrations: `webapp/src/core/migrateProject.ts`, run by `CloudProjectService.loadProject()`
- Runtime backfills for fields that don't warrant a version bump live in `useProjectStore.loadProject()`

**Rules for safe migrations:**
1. Bump `CURRENT_SCHEMA_VERSION`
2. Add a new `if (version < N)` block — migrations run sequentially
3. For renames: copy to new key, delete old key
4. For new fields: add a version-independent backfill at the bottom (handles projects that predate the field entirely)

## 4. History Batching (useHistoryBatcher)

File: `webapp/src/editor/hooks/useHistoryBatcher.ts`

Undo/redo uses [zundo](https://github.com/charkour/zundo) (temporal middleware). Without batching, dragging a slider 0→100 would create 100 history entries; we want one.

### Latch pattern

```
startInteraction()     — pointerDown / drag start
  batchAction(fn)      — every change (slider onChange, drag move)
  ...
endInteraction()       — pointerUp / drag end
```

1. `startInteraction()` increments a module-level `interactionCount` ref counter
2. `batchAction(action)` executes the mutation; on the first recorded history entry it **pauses** zundo tracking (latch) — subsequent mutations in this interaction skip history
3. `endInteraction()` decrements; at 0 it **resumes** tracking → whole interaction = one undo step

Nesting works because the counter is module-level (e.g. ZoomEditor session + ZoomTrack drag overlap).

```tsx
const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();
<Slider onPointerDown={startInteraction} onPointerUp={endInteraction}
        onChange={(val) => batchAction(() => updateSettings({ ... }))} />
```

### Zundo config (in useProjectStore.ts)

- **partialize:** only `{ project }` tracked (`userEvents` excluded)
- **equality:** `JSON.stringify` deep compare prevents no-op entries
- **limit:** 50

## 5. Source Time vs Output Time

### Core principle

> **Source times are the source of truth. Output times are a cache.**
> Never edit output times directly.

- **Source time**: timestamp in the original recording (before cuts/speed changes)
- **Output time**: timestamp in the final rendered video (after cuts/speed)

### The OutputWindow

```typescript
interface OutputWindow {
    id: ID;
    startMs: TimeMs;  // source time start
    endMs: TimeMs;    // source time end
    speed: number;    // playback multiplier (2.0 = 2x)
}
```

OutputWindows define which source ranges appear in the output. Gaps between windows = cut content. `outputDuration = sourceDuration / speed`.

Example:
- Window A: [0, 5000ms] at 1x → output [0, 5000ms]
- Window B: [8000, 10000ms] at 2x → output [5000, 6000ms]
- Gap [5000, 8000ms] is cut. Total output: 6000ms.

### TimeSegment base interface

All segment types (zoom, spotlight, captions, cameraMove, overlay) extend `TimeSegment`:

```typescript
interface TimeSegment {
    id: ID;
    sourceStartTimeMs: TimeMs;   // stored, edited
    sourceEndTimeMs: TimeMs;     // stored, edited
    outputStartTimeMs: TimeMs;   // cached, recomputed
    outputEndTimeMs: TimeMs;     // cached, recomputed
    visible: boolean;            // false if fully inside a cut
}
```

### TimeMapper

File: `shared/mappers/timeMapper.ts`

- `mapSourceToOutputTime(sourceMs)` → output ms (or -1 if in a gap)
- `mapOutputToSourceTime(outputMs)` → source ms
- `mapSourceRangeToOutputRange(start, end)` → `{start, end}` or `null` if fully cut
- `getOutputDuration()` → total output video length

`recomputeOutputTimes(segments, timeMapper)` (same file) stamps cached output times onto segments. **Must be called whenever `outputWindows` change** — each store slice does this via `windowSlice.ts`.

### Spatial coordinate systems

| Segment type | Temporal anchor | Spatial coordinates |
|---|---|---|
| ZoomSegment | source time | `rectPx` in OUTPUT pixels |
| SpotlightSegment | source time | `sourceRect` in SOURCE pixels |
| CameraMoveSegment | source time | x/y/width/height in OUTPUT pixels |
| OverlaySegment | source time | all positions in OUTPUT pixels |
| CaptionSegment | source time (per-word too) | N/A (rendered by captions system) |

### When adding a new segment type

1. Extend `TimeSegment` — store times in source time
2. Call `recomputeOutputTimes()` on creation and in the window slice's `updateOutputWindow`/`splitWindow`/etc.
3. Add the segment array to the `Timeline` interface (`shared/types/timeline.ts`)
4. Add a store slice following the pattern in `webapp/src/editor/stores/slices/`
5. Backfill an empty array in `migrateProject.ts` or `loadProject()` for existing projects

### Export scaling

`ProjectImpl.scale()` (→ `shared/utils/projectScale.ts`) proportionally scales all fields ending in `Px` when exporting at different resolutions. Source-coordinate fields (no `Px` suffix, e.g. `sourceRect`) are NOT scaled. **This convention is load-bearing — always suffix output-pixel fields with `Px`.**

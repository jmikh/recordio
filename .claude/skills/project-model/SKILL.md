---
name: project-model
description: How projects are created, stored, versioned, edited with batched history, and how source/output time works. Use when modifying project types, storage, timeline logic, migrations, undo/redo, or time mapping.
when_to_use: When modifying project structure, adding new segment types, changing timeline behavior, writing migrations, touching undo/redo or history batching, working with time conversions, or adding new persisted fields.
---

# Project Model

## 1. Project Creation

A project is born from a screen recording. The flow:

1. **Chrome extension** records screen + optional camera + optional microphone, producing a `RawRecording` (`shared/types/core.ts`)
2. `ProjectStorage.importFromRawRecording()` (`webapp/src/storage/projectStorage.ts`) saves media blobs to IndexedDB and calls `ProjectImpl.createFromSource()`
3. `ProjectImpl.createFromSource()` (`webapp/src/core/Project.ts`) builds the full `Project`:
   - Creates default settings (1920x1080, 60fps, all effects enabled)
   - Sets timeline duration = screen recording duration
   - Creates a single `OutputWindow` spanning `[0, durationMs]` at 1x speed
   - Auto-calculates `zoomSegments` and `spotlightSegments` from `userEvents` (mouse/keyboard)
   - Initializes empty `captionSegments`, `cameraMoveSegments`, `overlaySegments`
   - Stamps `schemaVersion: CURRENT_SCHEMA_VERSION`

The `Project` type (`webapp/src/types/project.ts`):
```
Project {
  id, schemaVersion, name, createdAt, updatedAt, thumbnail?,
  screenSource, cameraSource?, microphoneSource?,
  userEvents,
  settings: ProjectSettings,
  timeline: Timeline
}
```

---

## 2. Storage

### Local-first: IndexedDB

All project data lives client-side in IndexedDB (`webapp/src/storage/projectStorage.ts`).

| Store | Contents |
|---|---|
| `projects` | Full `Project` JSON documents (keyed by `id`) |
| `recordings` | Media blobs (video, audio, background images, music) |
| `thumbnails` | Project preview images |
| `customBackgrounds` | Global background library (copy-on-select into project) |
| `customMusic` | Global music library (copy-on-select into project) |

**Blob references** use a `recordio-blob://{id}` scheme for persistent `storageUrl`. On load, blobs are hydrated to transient `runtimeUrl` via `URL.createObjectURL()`. Before save, `runtimeUrl` is stripped — only `storageUrl` persists.

### Supabase (backend)

Backend tables track sharing/billing, not project content:
- `shared_videos` — links projects to Cloudflare Stream uploads (has its own `version` column for re-uploads)
- `user_metadata`, `subscriptions`, `project_unlocks` — billing
- `transcription_usage` — usage tracking

### Auto-save

A Zustand `subscribeWithSelector` subscription debounces saves to IndexedDB (2-second delay). Before writing, it re-attaches `userEvents` (stripped at load time for undo/redo performance):

```
project changes → debounce 2s → re-attach userEvents → ProjectStorage.saveProject()
```

---

## 3. Versioning & Migrations

### Schema version

- Constant: `CURRENT_SCHEMA_VERSION` in `webapp/src/core/Project.ts` (currently **2**)
- Stored on every project as `project.schemaVersion`

### Adding a migration

File: `webapp/src/core/migrateProject.ts`

```typescript
export function migrateProject(raw: any): any {
    const version = raw.schemaVersion ?? 0;

    if (version < 2) { /* v1→v2: rename cameraLayout → cameraMove */ }
    // Add new: if (version < 3) { /* v2→v3 */ }

    // Backfill missing fields (version-independent)
    if (raw.timeline && !raw.timeline.displaySettings) { /* add defaults */ }

    raw.schemaVersion = CURRENT_SCHEMA_VERSION;
    return raw;
}
```

**Rules for safe migrations:**
1. Bump `CURRENT_SCHEMA_VERSION`
2. Add a new `if (version < N)` block — migrations run sequentially
3. For renames: copy to new key, delete old key
4. For new fields: add a version-independent backfill at the bottom (handles projects that predate the field entirely)
5. `migrateProject()` runs automatically on every `loadProject()` call

### Runtime backfills

`useProjectStore.loadProject()` also backfills fields that were added after the initial schema but don't warrant a version bump (e.g. `overlaySegments`, `overlay` settings). These are in `webapp/src/editor/stores/useProjectStore.ts` lines 96-119.

---

## 4. History Batching (useHistoryBatcher)

File: `webapp/src/editor/hooks/useHistoryBatcher.ts`

### Problem

Undo/redo uses [zundo](https://github.com/charkour/zundo) (temporal middleware on Zustand). Without batching, dragging a slider from 0→100 would create 100 history entries. We want one.

### Solution: Latch pattern

```
startInteraction()     — called on pointerDown / drag start
  batchAction(fn)      — called on every change (slider onChange, drag move)
  batchAction(fn)      — ...
  batchAction(fn)      — ...
endInteraction()       — called on pointerUp / drag end
```

**How it works:**
1. `startInteraction()` increments a global `interactionCount` ref counter. On first interaction, ensures zundo tracking is active.
2. `batchAction(action)` executes the store mutation. If zundo recorded a new history entry AND we haven't latched yet, it **pauses** tracking (`hasLatched = true`). All subsequent mutations during this interaction skip history.
3. `endInteraction()` decrements the counter. When it hits 0, **resumes** tracking. Result: the entire interaction is one undo step.

**Nesting support:** `interactionCount` is module-level, so overlapping interactions (e.g. ZoomEditor session + ZoomTrack drag) nest correctly.

### Usage pattern in components

```tsx
const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

<Slider
    onPointerDown={startInteraction}
    onPointerUp={endInteraction}
    onChange={(val) => batchAction(() => updateSettings({ ... }))}
/>
```

For canvas drag operations: `onDragStart` → `startInteraction()`, every move → `batchAction()`, `onCommit` → `batchAction()` + `endInteraction()`.

### Zundo config

In `useProjectStore.ts`:
- **partialize:** Only `{ project }` is tracked — `userEvents` (immutable, large) is excluded
- **equality:** `JSON.stringify` deep comparison prevents no-op history entries
- **limit:** 50 undo/redo states max

---

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

OutputWindows define which source ranges appear in the output. Gaps between windows = cut content. Speed affects output duration: `outputDuration = sourceDuration / speed`.

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

File: `webapp/src/core/mappers/timeMapper.ts`

Key methods:
- `mapSourceToOutputTime(sourceMs)` → output ms (or -1 if in a gap)
- `mapOutputToSourceTime(outputMs)` → source ms
- `mapSourceRangeToOutputRange(start, end)` → `{start, end}` or `null` if fully cut
- `getOutputDuration()` → total output video length

### recomputeOutputTimes()

Same file. Stamps cached output times onto segments:

```typescript
function recomputeOutputTimes<T extends TimeSegment>(segments: T[], timeMapper: TimeMapper): T[]
```

**Must be called whenever `outputWindows` change.** Each store slice (zoom, spotlight, transcription, cameraMove, overlay) calls this in `windowSlice.ts` when windows are modified.

### Spatial coordinate systems

| Segment type | Temporal anchor | Spatial coordinates |
|---|---|---|
| ZoomSegment | source time | `rectPx` in OUTPUT pixels |
| SpotlightSegment | source time | `sourceRect` in SOURCE pixels |
| CameraMoveSegment | source time | x/y/width/height in OUTPUT pixels |
| OverlaySegment | source time | All positions in OUTPUT pixels |
| CaptionSegment | source time (per-word too) | N/A (rendered by captions system) |

### When adding a new segment type

1. Extend `TimeSegment` — store times in source time
2. Call `recomputeOutputTimes()` on creation and in the window slice's `updateOutputWindow`/`splitWindow`/etc.
3. Add the segment array to the `Timeline` interface
4. Add a store slice following the pattern in `webapp/src/editor/stores/slices/`
5. Backfill empty array in `migrateProject.ts` or `loadProject()` for existing projects

### Export scaling

`ProjectImpl.scale()` proportionally scales all fields ending in `Px` when exporting at different resolutions. Source-coordinate fields (no `Px` suffix, e.g. `sourceRect`) are NOT scaled. This convention is load-bearing — always suffix output-pixel fields with `Px`.

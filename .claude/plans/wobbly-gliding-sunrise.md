# Highlighted Segment (Timeline Range Selection)

## Context

Users need a way to select a time range on the timeline and delete it from the output. Currently, deleting content requires selecting individual windows and trimming their edges manually, or using the scissors tool to split. This feature lets users click-drag on the ruler to highlight an output time range, see it visually, and press Delete to cut it out -- similar to range selection in video editors like Premiere and DaVinci Resolve.

For this iteration: ruler-only drag initiation, single highlight, delete action only. Future iterations may connect to caption word selection.

---

## Files to Modify

1. `webapp/src/editor/stores/useUIStore.ts` -- add `highlightRange` state
2. `webapp/src/editor/stores/slices/windowSlice.ts` -- add `cutOutputRange` method
3. `webapp/src/editor/components/timeline/useTimelineInteraction.ts` -- drag-to-highlight logic
4. `webapp/src/editor/components/timeline/Timeline.tsx` -- visual overlay + Delete key handling

---

## Step 1: UIStore -- Highlight Range State

**File:** `webapp/src/editor/stores/useUIStore.ts`

Add to `UIState` interface:
```ts
highlightRange: { startMs: number; endMs: number } | null;
setHighlightRange: (range: { startMs: number; endMs: number } | null) => void;
```

Implementation:
- Initial value: `null`
- `setHighlightRange`: sets the range. When setting a non-null range, deselect all segments (call `deselectAllSegments()`)
- In every `select*` function (selectWindow, selectZoom, selectSpotlight, selectCaption, selectCameraMove, selectOverlaySegment): when selecting a non-null id, also `set({ highlightRange: null })`
- `deselectAllSegments`: add `highlightRange: null` to the set call
- `reset`: add `highlightRange: null`

This maintains the existing mutual-exclusion pattern: highlight and segment selections are never active simultaneously.

---

## Step 2: windowSlice -- `cutOutputRange`

**File:** `webapp/src/editor/stores/slices/windowSlice.ts`

Add `cutOutputRange(outputStartMs: number, outputEndMs: number)` to `WindowSlice` interface.

Algorithm:
1. Walk through windows, accumulating output time position for each window
2. For each window, compute its output span: `[outputAccum, outputAccum + (endMs - startMs) / speed]`
3. Find overlap between highlight range and window's output span
4. Convert overlap boundaries to source time: `sourceOffset = outputOffset * speed`
5. Keep surviving left/right portions (if >= 100ms output duration each)
6. Safety: abort if all windows would be removed

This correctly handles per-window speed differences and ranges spanning multiple windows.

---

## Step 3: useTimelineInteraction -- Drag-to-Highlight

**File:** `webapp/src/editor/components/timeline/useTimelineInteraction.ts`

New internal state:
- `dragAnchor: { outputMs: number; clientX: number } | null` -- recorded on mousedown
- `isDraggingHighlight: boolean` -- true once drag threshold exceeded

Constants:
- `DRAG_THRESHOLD_PX = 5` -- horizontal pixels before drag activates
- `RULER_HEIGHT = 26` -- matches Timeline.tsx

Modified behavior:

**mousedown:**
- Deselect zoom/spotlight (existing)
- Clear existing highlight range
- Check if mousedown Y is in ruler area (< 26px from container top)
- If in ruler: record drag anchor (outputMs + clientX), set CTI to clicked time, do NOT start CTI scrubbing yet
- If below ruler: start CTI scrubbing (existing behavior)

**mousemove:**
- If `dragAnchor` set and not yet dragging: check if `|currentX - anchorX| >= 5px`
  - If threshold exceeded: set `isDraggingHighlight = true`, cancel CTI scrubbing
- If `isDraggingHighlight`: update `highlightRange` in UIStore (min/max of anchor and current output time)
- Otherwise: existing hover/scrub behavior

**mouseup:**
- If `isDraggingHighlight`: finalize range, clear if too small (< 50ms)
- Reset `dragAnchor`, `isDraggingHighlight`, `isCTIScrubbing`

**mouseLeave:**
- Cancel any in-progress highlight drag, clear range
- Reset all drag state

Return `isDraggingHighlight` so Timeline can set cursor style.

---

## Step 4: Timeline.tsx -- Visual Overlay + Delete

**File:** `webapp/src/editor/components/timeline/Timeline.tsx`

### Visual overlay
Subscribe to `highlightRange` from UIStore. Render a semi-transparent secondary-colored overlay div inside the scrollable content area (the `div` with `style={{ width: totalWidth }}`). Placed after tracks and before the hover line. Spans the entire height of the timeline scrollable area (ruler + all tracks) using `top-0 bottom-0`:

```tsx
{highlightRange && (
    <div
        className="absolute top-0 bottom-0 pointer-events-none z-[25] bg-secondary/20 border-l border-r border-secondary/50"
        style={{
            left: `${(highlightRange.startMs / 1000) * pixelsPerSec}px`,
            width: `${((highlightRange.endMs - highlightRange.startMs) / 1000) * pixelsPerSec}px`,
        }}
    />
)}
```

- Semi-transparent secondary color (`bg-secondary/20`) covers ruler + recording track + all effect tracks
- Thin secondary borders on left/right edges for clarity
- `pointer-events-none` so it doesn't block interactions with segments underneath
- Inline styles only for dynamically computed `left`/`width` (per UI guidelines)

z-index 25 sits above track blocks (10-20) but below playhead/tooltips.

### Delete key
In existing `handleKeyDown`, add highlight range check BEFORE individual segment checks:

```ts
const range = useUIStore.getState().highlightRange;
if (range) {
    e.preventDefault();
    cutOutputRange(range.startMs, range.endMs);
    useUIStore.getState().clearHighlightRange();
    return;
}
```

Wire up `cutOutputRange` from useProjectStore.

### Cursor
Optionally set `cursor: 'col-resize'` on the container when `isDraggingHighlight` is true.

---

## Verification

1. **Click on ruler** -- CTI moves to clicked position, no highlight (existing behavior preserved)
2. **Click-drag on ruler** -- after 5px threshold, highlight overlay appears spanning drag range
3. **Release** -- highlight stays visible
4. **Press Delete/Backspace** -- highlighted range is cut from output, windows trimmed accordingly
5. **Press Escape** -- highlight clears
6. **Click any segment (zoom/spotlight/window/etc.)** -- highlight clears
7. **Undo (Cmd+Z)** -- cut is undone (automatic via zundo)
8. **Drag across multiple windows** -- both windows are trimmed correctly
9. **Drag across window with speed != 1** -- source time conversion accounts for speed
10. **Highlight entire timeline** -- cut is aborted (can't remove all windows)

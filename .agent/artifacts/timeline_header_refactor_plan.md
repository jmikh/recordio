# Timeline Header Components Refactoring Plan

## Overview
Reorganize timeline header components into a dedicated `header` directory within `timeline/`, and extract reusable components from `TimelineToolbar` for better modularity.

## Directory Structure (After)
```
src/editor/components/timeline/
├── header/
│   ├── TimelineToolbar.tsx          (moved & refactored)
│   ├── TimelineRuler.tsx            (moved)
│   ├── TimelineTrackHeader.tsx      (moved)
│   ├── PlaybackControls.tsx         (extracted)
│   ├── ZoomControls.tsx             (extracted)
│   └── ResolutionSelector.tsx       (extracted)
├── recording/
├── zoom/
├── EventsTrack.tsx
├── Timeline.tsx
├── TimelinePlayhead.tsx
└── useTimelineInteraction.ts
```

## Components to Move
1. **TimelineToolbar.tsx** → `timeline/header/TimelineToolbar.tsx`
2. **TimelineRuler.tsx** → `timeline/header/TimelineRuler.tsx`
3. **TimelineTrackHeader.tsx** → `timeline/header/TimelineTrackHeader.tsx`

## Components to Extract from TimelineToolbar

### 1. PlaybackControls.tsx
**Purpose:** Encapsulate the play/pause button and time display
**Props:**
```typescript
interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTimeMs: number;
  totalDurationMs: number;
  onTogglePlay: () => void;
}
```
**Contains:**
- Play/Pause button (lines 162-164)
- Time display with ref optimization (lines 165-170)
- `formatSmartTime` helper function (lines 82-96)

### 2. ZoomControls.tsx
**Purpose:** Timeline zoom in/out controls and fit button
**Props:**
```typescript
interface ZoomControlsProps {
  pixelsPerSec: number;
  onScaleChange: (newScale: number) => void;
  onFit: () => void;
}
```
**Contains:**
- Fit button (lines 174-180)
- Zoom out button (lines 181-186)
- Zoom slider (lines 187-197)
- Zoom in button (lines 198-203)
- MIN_PIXELS_PER_SEC and MAX_PIXELS_PER_SEC constants

### 3. ResolutionSelector.tsx
**Purpose:** Aspect ratio/resolution selection dropdown
**Props:**
```typescript
interface ResolutionSelectorProps {
  currentResolution: { width: number; height: number };
  onResolutionChange: (resolution: Resolution) => void;
}
```
**Contains:**
- RESOLUTIONS constant (lines 27-31)
- Resolution type definition (lines 21-25)
- Resolution dropdown (lines 143-158)

## Files That Import These Components (Need Updates)
1. `Timeline.tsx` - imports TimelineToolbar, TimelineRuler

## Benefits
✅ Better code organization - all header components in one place
✅ Smaller, more focused components
✅ Easier to test individual sections
✅ Clearer separation of concerns
✅ Reusable components (e.g., PlaybackControls could be used elsewhere)

## Implementation Order
1. Create `timeline/header/` directory
2. Extract new components (PlaybackControls, ZoomControls, ResolutionSelector)
3. Refactor TimelineToolbar to use the extracted components
4. Move all three existing components to the header directory
5. Update import paths in Timeline.tsx and other files

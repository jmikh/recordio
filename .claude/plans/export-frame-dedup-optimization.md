# Export Pipeline: Frame Deduplication & Render Optimization

## Context

Screen recordings produce many consecutive identical frames (user reading, thinking, idle screen). The current export pipeline at `shared/export/ExportManager.ts:290-400` processes every frame through the full decode → render → encode pipeline regardless of whether the output changed. At high resolutions (up to 4K after the cap), this is expensive. The goal is to identify where time is actually spent and skip redundant work for duplicate frames.

## Current Pipeline Per-Frame (30fps)

```
for each frame i:
  1. DECODE:  FrameExtractor.getFrameAtTime() → VideoFrame clone        
  2. RENDER:  clearRect + drawBackground + PlaybackRenderer.render (9 layers)
  3. ENCODE:  new VideoFrame(canvas) → videoEncoder.encode()
  4. CLEANUP: close all VideoFrames
```

## Analysis: What's Already Cheap vs. Expensive for Duplicate Frames

| Step | For duplicate frames | Notes |
|------|---------------------|-------|
| **Decode** | Already ~no-op | FrameExtractor doesn't feed new chunks when source time maps to same frame. Just clones from buffer. Main cost = `VideoFrame.clone()` |
| **Render** | Full cost every time | 9 canvas layers redrawn even if nothing changed visually. At 4K this is significant |
| **Encode** | Reduced but not free | H.264 P-frames for identical content are small, but encoder still processes each frame |

**Key insight**: The decode step is already efficient for duplicates. The real waste is in **render** (full canvas composite) and **encode** (per-frame encoder calls) for frames where the output hasn't changed.

## Complication: Overlays Change Independently of Video

Even if the source video frame is identical, overlays may differ:
- Zoom animations (viewport transitions)
- Mouse click/drag visual effects
- Spotlight state changes  
- Keyboard overlay (hotkey display with fade timers)
- Caption text changes
- Camera PiP position/opacity transitions
- Overlay annotations

So "same video frame" ≠ "same output frame." We need to check overlay state too.

---

## Recommended Approach: Canvas-Level Frame Dedup

### Step 1: Confirm where time is actually spent

Before optimizing, add a one-time diagnostic that logs the **actual** breakdown for a real export. The timing accumulators already exist (`ExportManager.ts:287-393`), but we should also log how many frames had unchanged source video timestamps to quantify the opportunity.

**File**: `shared/export/ExportManager.ts`
- After decode (line 318), compare each source frame's `.timestamp` to previous frame's timestamp
- Count `unchangedSourceFrames` and log it alongside the existing timing breakdown at line 387

### Step 2: Skip render + encode for fully static frames

Add a dirty-detection system that checks whether the output frame would be visually identical to the previous one. If clean, skip render and re-encode the previous canvas content (which is still on the OffscreenCanvas) with an extended duration.

**In the frame loop** (`ExportManager.ts:290`):

```
Track per-frame:
  - prevSourceTimestamps: Record<string, number>  (per video source)
  - prevOutputTimeMs: number

For each frame:
  1. Decode as usual
  2. Compare each decoded frame's .timestamp to prevSourceTimestamps
  3. If ALL source frames unchanged:
     - Check overlay dirty: call a lightweight function that checks if any 
       animated property changed between prevOutputTimeMs and currentTimeMs
     - If clean: skip render, create VideoFrame from unchanged canvas,
       encode with same timestamp/duration → continue
  4. If dirty: render as normal, update prev state
```

**Overlay dirty check** — new function in `PlaybackRenderer.ts`:

```typescript
static isFrameDirty(prev: number, curr: number, project, userEvents, timeMapper): boolean
```

Checks (all cheap timestamp comparisons, no rendering):
- `getViewportStateAtTime()` changed (zoom segments)
- Any mouse click effect active in [prev, curr] window
- Any drag effect active
- Spotlight state changed
- Keyboard overlay changed (active key events with fade)
- Active caption changed
- Camera resolved state changed (position/opacity)
- Any overlay annotation active

If none of these changed → frame is clean → skip render.

### Step 3: Batch encode identical frames with extended duration

Instead of encoding each identical frame separately, accumulate a "repeat count" and encode one frame with `duration = repeatCount * frameDuration`. This reduces encoder calls proportionally.

**Implementation**:
- Don't encode immediately — buffer the last `VideoFrame` and a `pendingDuration` counter
- When the next frame is dirty, encode the buffered frame with accumulated duration, then start a new buffer
- Flush the buffer after the loop ends (before `videoEncoder.flush()`)
- Keyframe interval logic needs adjustment: ensure keyframes still happen every ~2 seconds of output time

---

## Files to Modify

| File | Change |
|------|--------|
| `shared/export/ExportManager.ts` | Frame loop: source timestamp tracking, dirty check, deferred encoding with duration batching |
| `shared/export/PlaybackRenderer.ts` | New `isFrameDirty()` static method |
| `shared/export/FrameExtractor.ts` | Expose last returned frame timestamp for cheap comparison (minor) |

## Estimated Impact

For a typical 60-second screen recording where ~60-70% of frames are visually static:
- ~1100 of 1800 frames skip render + encode
- Render savings: significant (no 4K canvas compositing for those frames)  
- Encode savings: moderate (fewer encoder calls, smaller output file)
- Overall: could cut export time by 30-50% for static-heavy recordings

## Verification

1. Export a screen recording with known static segments, compare timing logs before/after
2. Compare output video quality — ensure no visual artifacts at transition points
3. Verify keyframes still appear at regular intervals
4. Test with recordings that have continuous overlay activity (zooms, spotlight) to ensure no skipped frames when content is changing
5. Test edge cases: all-static recording, all-dynamic recording, recordings with camera PiP

import { type ZoomSegment, type Rect, type ZoomSettings, type FocusArea } from '@shared/types';
import { ViewMapper } from '@shared/mappers/viewMapper';
import { TimeMapper } from '@shared/mappers/timeMapper';
import {
    rectContainsRect,
    rectContainsPoint,
    clampViewportToBounds,
    unionRects,
    scaleRectFromCenter,
    getRectCenter,
    getRectArea,
} from '@shared/utils/geometry';

// ============================================================================
// Internal Types
// ============================================================================

/** Focus area converted to output time, ready for scheduling. */
interface OutputFocusArea {
    outputStartTimeMs: number;
    outputEndTimeMs: number;
    rect: Rect;
    reason: FocusArea['reason'];
}

/** Zoom action with output times, used internally during scheduling. */
interface OutputZoomSegment {
    outputStartTimeMs: number;
    outputEndTimeMs: number;
    rectPx: Rect;
    /** Union of the focus areas this block was built from. Kept so merges can
     *  recompute a tight viewport instead of unioning two already-padded ones. */
    mustSeeRect: Rect;
    reason: FocusArea['reason'];
}

/** Open block accumulator — tracks the current in-progress zoom block. */
interface OpenBlock {
    blockStartTime: number;  // output time
    holdEndTime: number;     // output time
    viewport: Rect;
    mustSeeRect: Rect;
    firstAreaIndex: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Converts source-time focus areas to output time, skipping any that fall
 * entirely within a cut. Focus areas are assumed to be pre-sorted by start time.
 */
function toOutputFocusAreas(focusAreas: FocusArea[], timeMapper: TimeMapper): OutputFocusArea[] {
    const result: OutputFocusArea[] = [];
    for (const area of focusAreas) {
        const isPoint = area.sourceStartTimeMs === area.sourceEndTimeMs;
        const mapped = timeMapper.mapSourceRangeToOutputRange(
            area.sourceStartTimeMs,
            isPoint ? undefined : area.sourceEndTimeMs
        );
        if (!mapped) continue; // fully in a cut — skip
        result.push({
            outputStartTimeMs: mapped.start,
            outputEndTimeMs: mapped.end,
            rect: area.rect,
            reason: area.reason,
        });
    }
    return result;
}

// ============================================================================
// Auto Zoom Schedule Generation
// ============================================================================

/**
 * Calculates zoom actions from focus areas using transition-aware timing.
 *
 * All scheduling logic runs in OUTPUT TIME. Focus areas are converted from
 * source time at entry; resulting actions are converted back to source time
 * before returning.
 *
 * Each block ends at its hold position — no transition-out padding is added.
 * The animator handles zoom-out continuously in gaps between blocks.
 *
 * @param zoomSettings - Zoom settings including maxZoom, transitionDurationMs
 * @param viewMapper - Mapper for source to output coordinate transformation
 * @param timeMapper - Mapper for source ↔ output time conversion
 * @param focusAreas - Focus areas computed from user events (in source time, pre-sorted)
 * @returns Array of zoom actions with sourceStartTimeMs and sourceEndTimeMs
 */
export function calculateAutoZooms(
    zoomSettings: ZoomSettings,
    viewMapper: ViewMapper,
    timeMapper: TimeMapper,
    focusAreas: FocusArea[],
): ZoomSegment[] {
    const { maxZoom, transitionDurationMs } = zoomSettings;

    if (focusAreas.length === 0) return [];

    const outputFocusAreas = toOutputFocusAreas(focusAreas, timeMapper);
    if (outputFocusAreas.length === 0) return [];

    // -------------------------------------------------------------------------
    // Schedule blocks in output time
    // -------------------------------------------------------------------------
    const outputSize = viewMapper.outputSize;
    const fullViewport: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // Timing constants for block scheduling
    const START_BUFFER_MS = 2000;              // Don't zoom in the first N ms of the video
    const HOLD_TAIL_MS = 2000;                // How long to hold after the last focus area in a block
    const FULL_ZOOM_OUT_DELAY_MS = 500;       // To avoid quick zoom out after a zoom in.
    const CENTER_ZONE_FRACTION = 0.75;         // An area must land in this middle share of the viewport to reuse it
    const MIN_RECENTRE_SHIFT_PX = outputSize.width * 0.01;  // Below this, re-centring isn't worth a new block
    const END_BUFFER_MS = 500 + transitionDurationMs;               // Leave this much room at the end of the video before zooming out
    const MIN_HOLD_MS = 1000;                  // Drop blocks that settle at their viewport for less than this

    const outputActions: OutputZoomSegment[] = [];
    let openBlock: OpenBlock | null = null;

    const closeBlock = (endTimeMs: number) => {
        if (!openBlock) return;
        outputActions.push({
            outputStartTimeMs: openBlock.blockStartTime,
            outputEndTimeMs: endTimeMs,
            rectPx: openBlock.viewport,
            mustSeeRect: openBlock.mustSeeRect,
            reason: outputFocusAreas[openBlock.firstAreaIndex].reason,
        });
        openBlock = null;
    };

    for (let i = 0; i < outputFocusAreas.length; i++) {
        const area = outputFocusAreas[i];
        const mappedRect = viewMapper.eventToOutputRect(area.rect);

        // Next area's start time — used to prevent blocks from overlapping
        const nextAreaStart = i + 1 < outputFocusAreas.length
            ? outputFocusAreas[i + 1].outputStartTimeMs
            : Infinity;

        const targetViewport = getViewport(mappedRect, maxZoom, viewMapper);

        // Area that covers ≥80% of the output width — treat as full zoom out, close block and skip
        // (getViewport always preserves aspect ratio, so checking one dimension is sufficient)
        const isEffectivelyFullViewport = targetViewport.width / fullViewport.width >= 0.8;
        if (isEffectivelyFullViewport) {
            if (openBlock) {
                closeBlock(Math.min(openBlock.holdEndTime + HOLD_TAIL_MS, area.outputStartTimeMs + FULL_ZOOM_OUT_DELAY_MS));
            }
            continue;
        }

        if (openBlock) {
            const gapToNext = area.outputStartTimeMs - openBlock.holdEndTime;
            const tooFarAway = gapToNext > HOLD_TAIL_MS + transitionDurationMs;

            if (tooFarAway) {
                closeBlock(Math.min(openBlock.holdEndTime + HOLD_TAIL_MS, area.outputStartTimeMs - transitionDurationMs));
            } else {
                const fitsInViewport = rectContainsRect(openBlock.viewport, mappedRect);
                const sameViewportSize =
                    Math.abs(openBlock.viewport.width - targetViewport.width) < 0.5 &&
                    Math.abs(openBlock.viewport.height - targetViewport.height) < 0.5;

                // Merely fitting isn't enough — an area parked against the edge of the
                // viewport reads as off-centre. Judge by its centre, not its edges.
                const isCentred = rectContainsPoint(
                    scaleRectFromCenter(openBlock.viewport, CENTER_ZONE_FRACTION),
                    getRectCenter(mappedRect)
                );

                // ...but only re-centre if it would actually move. When the viewport is
                // already clamped against the screen edge, getViewport returns the same
                // rect and a new block would be a no-op zoom.
                const recentreShift = Math.hypot(
                    targetViewport.x - openBlock.viewport.x,
                    targetViewport.y - openBlock.viewport.y
                );
                const worthRecentring = recentreShift >= MIN_RECENTRE_SHIFT_PX;

                if (fitsInViewport && sameViewportSize && (isCentred || !worthRecentring)) {
                    // New area sits comfortably inside the current block — just extend it
                    openBlock.holdEndTime = Math.max(openBlock.holdEndTime, area.outputEndTimeMs);
                    openBlock.mustSeeRect = unionRects([openBlock.mustSeeRect, mappedRect]);
                    continue;
                }

                // Different viewport needed — close current block, leaving room for the next transition-in
                const blockEndTime = Math.min(openBlock.holdEndTime + HOLD_TAIL_MS, area.outputStartTimeMs - transitionDurationMs);
                closeBlock(Math.max(openBlock.holdEndTime, blockEndTime));
            }
        }

        // Open a new block for this focus area
        const lastAction = outputActions.length > 0 ? outputActions[outputActions.length - 1] : null;

        let blockStartTime: number;

        if (!lastAction) {
            // First block — don't start zooming before START_BUFFER_MS
            if (area.outputEndTimeMs <= START_BUFFER_MS) {
                continue;
            }
            blockStartTime = Math.max(area.outputStartTimeMs - transitionDurationMs, START_BUFFER_MS);
        } else {
            // Start the transition-in early enough to reach the target by area start,
            // but never before the previous block ended
            blockStartTime = Math.max(area.outputStartTimeMs - transitionDurationMs, lastAction.outputEndTimeMs);
        }

        openBlock = {
            blockStartTime,
            holdEndTime: area.outputEndTimeMs,
            viewport: targetViewport,
            mustSeeRect: mappedRect,
            firstAreaIndex: i,
        };
    }

    // Close the last open block, leaving END_BUFFER_MS at the end of the video.
    // If the block starts after the cutoff, there's no room to zoom in and back out — skip it.
    if (openBlock && openBlock.blockStartTime < timeMapper.outputDuration - END_BUFFER_MS - transitionDurationMs) {
        closeBlock(Math.min(openBlock.holdEndTime + HOLD_TAIL_MS, timeMapper.outputDuration - END_BUFFER_MS));
    }

    // -------------------------------------------------------------------------
    // Absorb blocks that barely hold
    // -------------------------------------------------------------------------
    // A block spends its first transitionDurationMs travelling to its viewport;
    // whatever is left is the hold. A block that arrives and immediately leaves
    // reads as a twitch rather than a deliberate zoom.
    //
    // Rather than dropping it, fold it into a neighbour it is already continuous
    // with — one wider zoom covering both beats a jitter. Attached to just one
    // neighbour: merge that way. Attached to both: try each union and take
    // whichever yields the tighter viewport, since the looser one gives up more
    // magnification. Attached to neither, there is nothing to fold into, so drop it.
    //
    // Runs before the zoom-out absorb pass below so that pass sees the final set
    // of blocks — otherwise a start could be pulled back to a block that is about
    // to disappear.
    //
    // A neighbour is "attached" when the gap is too short for the animator's
    // zoom-out to complete, which is the same test the pass below uses.
    const isAttached = (earlier: OutputZoomSegment, later: OutputZoomSegment) =>
        later.outputStartTimeMs - earlier.outputEndTimeMs < transitionDurationMs;

    /** The viewport a merged block would use, and how tight it is. */
    const mergedViewport = (a: OutputZoomSegment, b: OutputZoomSegment) => {
        const mustSeeRect = unionRects([a.mustSeeRect, b.mustSeeRect]);
        return { mustSeeRect, viewport: getViewport(mustSeeRect, maxZoom, viewMapper) };
    };

    const survivingActions: OutputZoomSegment[] = [];
    for (let i = 0; i < outputActions.length; i++) {
        const action = outputActions[i];
        const holdDuration =
            (action.outputEndTimeMs - action.outputStartTimeMs) - transitionDurationMs;

        if (holdDuration >= MIN_HOLD_MS) {
            survivingActions.push(action);
            continue;
        }

        // Merge into the previous block as already kept, and into the next block in
        // place — the next block is folded into before its own turn comes round, so
        // a run of brief blocks collapses into one.
        const prev = survivingActions.length > 0
            ? survivingActions[survivingActions.length - 1]
            : null;
        const next = i + 1 < outputActions.length ? outputActions[i + 1] : null;

        const canMergePrev = prev !== null && isAttached(prev, action);
        const canMergeNext = next !== null && isAttached(action, next);

        let mergeInto: OutputZoomSegment | null = null;
        if (canMergePrev && canMergeNext) {
            mergeInto = getRectArea(mergedViewport(prev!, action).viewport)
                <= getRectArea(mergedViewport(action, next!).viewport)
                ? prev
                : next;
        } else if (canMergePrev) {
            mergeInto = prev;
        } else if (canMergeNext) {
            mergeInto = next;
        }

        if (!mergeInto) continue; // Attached to nothing — drop it

        const { mustSeeRect, viewport } = mergedViewport(mergeInto, action);
        mergeInto.mustSeeRect = mustSeeRect;
        mergeInto.rectPx = viewport;
        // Blocks never overlap, so the merged span is simply the outer bounds.
        mergeInto.outputStartTimeMs = Math.min(mergeInto.outputStartTimeMs, action.outputStartTimeMs);
        mergeInto.outputEndTimeMs = Math.max(mergeInto.outputEndTimeMs, action.outputEndTimeMs);
    }

    // -------------------------------------------------------------------------
    // Absorb partial zoom-outs
    // -------------------------------------------------------------------------
    // The animator zooms out over T in the gap after a block's hold ends. When the
    // next block starts before that zoom-out has finished, the viewport pulls
    // partway out and snaps straight back in — a visible bounce. Pull those starts
    // back to the previous block's hold end so the transition runs directly from
    // one viewport to the next, with no zoom-out at all.
    //
    // Only shrinks the gap to zero, never past it: the block's end is untouched, so
    // each pair is independent and a single forward pass is enough.
    for (let i = 1; i < survivingActions.length; i++) {
        const prevHoldEnd = survivingActions[i - 1].outputEndTimeMs;
        const action = survivingActions[i];
        const gap = action.outputStartTimeMs - prevHoldEnd;

        if (gap > 0 && gap < transitionDurationMs) {
            action.outputStartTimeMs = prevHoldEnd;
        }
    }

    // -------------------------------------------------------------------------
    // Convert actions back to source time
    // -------------------------------------------------------------------------
    return survivingActions.map(action => ({
        id: crypto.randomUUID(),
        sourceStartTimeMs: timeMapper.mapOutputToSourceTime(action.outputStartTimeMs),
        sourceEndTimeMs: timeMapper.mapOutputToSourceTime(action.outputEndTimeMs),
        outputStartTimeMs: action.outputStartTimeMs,
        outputEndTimeMs: action.outputEndTimeMs,
        visible: true,
        rectPx: action.rectPx,
        reason: action.reason,
        type: 'auto' as const,
        transitionDurationMs: zoomSettings.transitionDurationMs,
        easing: zoomSettings.easing,
    }));
}

// ============================================================================
// Viewport Calculation
// ============================================================================

function getViewport(
    mustSeeRect: Rect,
    maxZoom: number,
    viewMapper: ViewMapper
): Rect {
    const outputSize = viewMapper.outputSize;
    const aspectRatio = outputSize.width / outputSize.height;

    // Minimum viewport size allowed by MAX ZOOM
    const minViewportWidth = outputSize.width / maxZoom;
    const minViewportHeight = minViewportWidth / aspectRatio;

    // Calculate viewport size needed to contain mustSeeRect while maintaining aspect ratio
    const widthBasedHeight = mustSeeRect.width / aspectRatio;
    const heightBasedWidth = mustSeeRect.height * aspectRatio;

    let viewportWidth: number;
    let viewportHeight: number;

    if (widthBasedHeight >= mustSeeRect.height) {
        viewportWidth = mustSeeRect.width;
        viewportHeight = widthBasedHeight;
    } else {
        viewportWidth = heightBasedWidth;
        viewportHeight = mustSeeRect.height;
    }

    // Ensure we don't exceed max zoom
    viewportWidth = Math.max(minViewportWidth, viewportWidth);
    viewportHeight = Math.max(minViewportHeight, viewportHeight);

    // Center around the Must See Rect
    const centerX = mustSeeRect.x + mustSeeRect.width / 2;
    const centerY = mustSeeRect.y + mustSeeRect.height / 2;

    const viewport = {
        x: centerX - viewportWidth / 2,
        y: centerY - viewportHeight / 2,
        width: viewportWidth,
        height: viewportHeight
    };

    return clampViewportToBounds(viewport, outputSize);
}

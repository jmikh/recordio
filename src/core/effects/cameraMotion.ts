import type { ClickEvent, ZoomConfig, UserEvent, CameraMotion, Size, MouseEvent, Rect } from '../types';
import { ViewTransform } from './viewTransform';

// export * from './types'; // Removed as types are now in core
export * from './viewTransform';

// ============================================================================
// Core Abstractions
// ============================================================================

// Box interface removed

export interface HoverBlock {
    startTime: number;
    endTime: number;
    centerX: number;
    centerY: number;
}

export function findHoverBlocks(
    events: UserEvent[],
    inputSize: Size
): HoverBlock[] {
    // 1. Determine Box Size (10% of the bigger dimension)
    const boxSize = Math.max(inputSize.width, inputSize.height) * 0.1;
    const minDuration = 1000; // 1 second in ms

    const blocks: HoverBlock[] = [];
    let currentSegment: MouseEvent[] = [];

    // Helper to process a continuous segment of mouse events
    const processSegment = (segment: MouseEvent[]) => {
        let i = 0;
        while (i < segment.length) {
            let j = i;
            let minX = segment[i].x;
            let maxX = segment[i].x;
            let minY = segment[i].y;
            let maxY = segment[i].y;

            // Greedy expansion: find the longest sequence starting at i that fits in the box
            while (j < segment.length) {
                const p = segment[j];
                const newMinX = Math.min(minX, p.x);
                const newMaxX = Math.max(maxX, p.x);
                const newMinY = Math.min(minY, p.y);
                const newMaxY = Math.max(maxY, p.y);

                // Check if the bounding box dimensions are within the allowed boxSize
                if ((newMaxX - newMinX) <= boxSize && (newMaxY - newMinY) <= boxSize) {
                    minX = newMinX;
                    maxX = newMaxX;
                    minY = newMinY;
                    maxY = newMaxY;
                    j++;
                } else {
                    break;
                }
            }

            // Check if the identified block meets the duration requirement
            // j is exclusive, so the block is events[i] to events[j-1]
            if (j > i) {
                const startEvent = segment[i];
                const endEvent = segment[j - 1];
                const duration = endEvent.timestamp - startEvent.timestamp;

                if (duration >= minDuration) {
                    // Valid Hover Block found
                    const points = segment.slice(i, j);
                    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
                    const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

                    blocks.push({
                        startTime: startEvent.timestamp,
                        endTime: endEvent.timestamp,
                        centerX,
                        centerY
                    });

                    // Advance i to j to continue searching after this block
                    // (Try to fill "already created" implies we took the max possible, so we move on)
                    i = j;
                } else {
                    // Sequence too short, try starting from the next point
                    i++;
                }
            } else {
                i++;
            }
        }
    };

    // 2. Iterate events and split by separators (clicks, etc.)
    for (const evt of events) {
        if (evt.type === 'mouse') {
            currentSegment.push(evt);
        } else if (evt.type === 'click' || evt.type === 'url') {
            // These events break the "hover" continuity
            if (currentSegment.length > 0) {
                processSegment(currentSegment);
                currentSegment = [];
            }
        }
    }

    // Process potential remaining segment
    if (currentSegment.length > 0) {
        processSegment(currentSegment);
    }

    return blocks;
}

export function calculateZoomSchedule(
    config: ZoomConfig,
    viewTransform: ViewTransform, // Kept for signature compatibility
    events: UserEvent[]
): CameraMotion[] {
    const motions: CameraMotion[] = [];

    // 1. Identify all Click Events and sort them.
    const clickEvents = events
        .filter((e): e is ClickEvent => e.type === 'click')
        .sort((a, b) => a.timestamp - b.timestamp);

    if (clickEvents.length === 0) {
        return motions;
    }

    // 2. Prepare for Zoom Level Calculation (Output Space)
    // Zoom 1x = Full Output Size.
    // Zoom 2x = Half Output Size (centered).
    const zoomLevel = config.zoomIntensity;

    const cameraWidth = viewTransform.outputVideoSize.width / zoomLevel;
    const cameraHeight = viewTransform.outputVideoSize.height / zoomLevel;

    // Default duration for a zoom "scene" around a click
    const ZOOM_HOLD_DURATION = config.zoomDuration || 2000;
    const ZOOM_TRANSITION_DURATION = config.zoomOffset ? Math.abs(config.zoomOffset) : 500;

    for (let i = 0; i < clickEvents.length; i++) {
        const evt = clickEvents[i];

        // 1. Map Click to Output Space
        const clickOutput = viewTransform.inputToOutput({ x: evt.x, y: evt.y });

        // 2. Center CameraWindow on Click
        let cameraX = clickOutput.x - cameraWidth / 2;
        let cameraY = clickOutput.y - cameraHeight / 2;

        // 3. Clamp to Output Space Edges
        // The CameraWindow must stay within the Output Canvas (0,0 -> OutputW, OutputH)
        // (Unless zoomLevel < 1, which implies window > output, then we adjust differently...
        // assuming zoom >= 1 for now).

        const maxX = viewTransform.outputVideoSize.width - cameraWidth;
        const maxY = viewTransform.outputVideoSize.height - cameraHeight;

        if (cameraX < 0) cameraX = 0;
        else if (cameraX > maxX) cameraX = maxX;

        if (cameraY < 0) cameraY = 0;
        else if (cameraY > maxY) cameraY = maxY;

        const newCameraWindow: Rect = {
            x: cameraX,
            y: cameraY,
            width: cameraWidth,
            height: cameraHeight
        };

        // Timing Logic
        const timeIn = Math.max(0, evt.timestamp - ZOOM_TRANSITION_DURATION);

        // We arrive at target exactly at click time
        const arrivalTime = evt.timestamp;

        motions.push({
            id: crypto.randomUUID(),
            timeInMs: timeIn,
            timeOutMs: arrivalTime,
            cameraWindow: newCameraWindow,
            easing: 'ease_in_out'
        });

        // Hold the zoom
        const nextEvt = clickEvents[i + 1];
        const holdUntil = arrivalTime + ZOOM_HOLD_DURATION;

        if (nextEvt && nextEvt.timestamp < holdUntil + ZOOM_TRANSITION_DURATION * 2) {
            // Stay zoomed
        } else {
            // Zoom OUT to full view (Output Space)
            const fullView: Rect = {
                x: 0, y: 0,
                width: viewTransform.outputVideoSize.width,
                height: viewTransform.outputVideoSize.height
            };

            const zoomOutStart = Math.max(arrivalTime + 1000, arrivalTime + 500);
            const zoomOutEnd = zoomOutStart + ZOOM_TRANSITION_DURATION;

            motions.push({
                id: crypto.randomUUID(),
                timeInMs: zoomOutStart,
                timeOutMs: zoomOutEnd,
                cameraWindow: fullView,
                easing: 'ease_in_out'
            });
        }
    }

    return motions;
}

// ============================================================================
// Runtime Execution / Interpolation
// ============================================================================



/*
 * Calculates the current CameraWindow (in Output Space)
 * based on the list of motions and the current time.
 */
export function getCameraStateAtTime(
    motions: CameraMotion[],
    timeMs: number,
    fullSize: Size
): Rect {
    const fullRect: Rect = { x: 0, y: 0, width: fullSize.width, height: fullSize.height };

    if (!motions || motions.length === 0) {
        return fullRect;
    }

    // Ensure motions are sorted
    const sortedMotions = [...motions].sort((a, b) => a.timeInMs - b.timeInMs);

    // Before first motion
    if (timeMs < sortedMotions[0].timeInMs) {
        return fullRect;
    }

    // After last motion
    const lastMotion = sortedMotions[sortedMotions.length - 1];
    if (timeMs >= lastMotion.timeOutMs) {
        return lastMotion.cameraWindow;
    }

    // Find the relevant motion segment
    for (let i = 0; i < sortedMotions.length; i++) {
        const curr = sortedMotions[i];

        // Case: Inside a motion (Interpolating)
        if (timeMs >= curr.timeInMs && timeMs < curr.timeOutMs) {
            let startRect = fullRect;
            if (i > 0) {
                startRect = sortedMotions[i - 1].cameraWindow;
            }

            const duration = curr.timeOutMs - curr.timeInMs;
            const elapsed = timeMs - curr.timeInMs;
            const progress = duration === 0 ? 1 : elapsed / duration;

            const easedProgress = applyEasing(progress, curr.easing);

            return interpolateRect(startRect, curr.cameraWindow, easedProgress);
        }

        // Case: Between motions (Holding previous target)
        if (i < sortedMotions.length - 1) {
            const next = sortedMotions[i + 1];
            if (timeMs >= curr.timeOutMs && timeMs < next.timeInMs) {
                return curr.cameraWindow;
            }
        }
    }

    return fullRect;
}

function applyEasing(t: number, type: CameraMotion['easing']): number {
    switch (type) {
        case 'ease_in':
            return t * t;
        case 'ease_out':
            return t * (2 - t);
        case 'ease_in_out':
            return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        case 'linear':
        default:
            return t;
    }
}

function interpolateRect(from: Rect, to: Rect, t: number): Rect {
    return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        width: from.width + (to.width - from.width) * t,
        height: from.height + (to.height - from.height) * t,
    };
}

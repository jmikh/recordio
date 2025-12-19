import type { ClickEvent, ZoomConfig, UserEvent, CameraMotion, Size, MouseEvent } from '../types';
import { VideoMappingConfig } from './videoMappingConfig';

// export * from './types'; // Removed as types are now in core
export * from './videoMappingConfig';

// ============================================================================
// Core Abstractions
// ============================================================================

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

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
    mappingConfig: VideoMappingConfig,
    events: UserEvent[]
): CameraMotion[] {
    const motions: CameraMotion[] = [];

    // 1. Identify all Click Events and sort them.
    const clickEvents = events
        .filter((e): e is ClickEvent => e.type === 'click')
        .sort((a, b) => a.timestamp - b.timestamp);

    // Initial Full View


    if (clickEvents.length === 0) {
        return motions;
    }

    // 3. Prepare for Zoom Level Calculation
    const zoomLevel = config.zoomIntensity; // e.g. 2.0
    const zoomBoxSize: Size = {
        width: mappingConfig.outputVideoSize.width / zoomLevel,
        height: mappingConfig.outputVideoSize.height / zoomLevel
    };

    // 4. Iterate Events and Generate Motions
    let lastTime = 0;

    // Default duration for a zoom "scene" around a click
    const ZOOM_HOLD_DURATION = config.zoomDuration || 2000;
    const ZOOM_TRANSITION_DURATION = config.zoomOffset ? Math.abs(config.zoomOffset) : 500;

    for (let i = 0; i < clickEvents.length; i++) {
        const evt = clickEvents[i];

        // Calculate Target Box
        const centerOfInterest = mappingConfig.projectInputToOutput({
            x: evt.x,
            y: evt.y
        });

        let newBox: Box = {
            x: centerOfInterest.x - zoomBoxSize.width / 2,
            y: centerOfInterest.y - zoomBoxSize.height / 2,
            width: zoomBoxSize.width,
            height: zoomBoxSize.height
        };

        // Shift-Clamping
        if (newBox.x < 0) newBox.x = 0;
        else if (newBox.x > mappingConfig.outputVideoSize.width - newBox.width) {
            newBox.x = mappingConfig.outputVideoSize.width - newBox.width;
        }

        if (newBox.y < 0) newBox.y = 0;
        else if (newBox.y > mappingConfig.outputVideoSize.height - newBox.height) {
            newBox.y = mappingConfig.outputVideoSize.height - newBox.height;
        }

        // Timing Logic
        // Zoom IN starts before click
        const timeIn = Math.max(lastTime, evt.timestamp - ZOOM_TRANSITION_DURATION); // Start zooming in 500ms before click

        // We arrive at target exactly at click time? Or slightly before?
        // Let's say we want to arrive AT the click.
        // So motion is from [timeIn, evt.timestamp] -> Interpolating from "Previous State" to "Target State".
        // But CameraMotion struct defines a "State" that applies *from* timeIn *to* timeOut?
        // No, `CameraMotion` defines an interpolation: "The camera moves... starting at timeIn and arriving at timeOut".

        // So at `timeOutMs` we are technically AT the `target`.

        const arrivalTime = evt.timestamp;

        motions.push({
            id: crypto.randomUUID(),
            timeInMs: timeIn,
            timeOutMs: arrivalTime,
            target: newBox,
            easing: 'ease_in_out'
        });

        // Hold the zoom for valid duration?
        // Next event might be soon.
        const nextEvt = clickEvents[i + 1];
        const holdUntil = arrivalTime + ZOOM_HOLD_DURATION;

        // Determine when we must leave this zoom.
        // If next click is close, we might transition directly.
        // If next click is far, we zoom OUT to full view.

        if (nextEvt && nextEvt.timestamp < holdUntil + ZOOM_TRANSITION_DURATION * 2) {
            // Too close to zoom out and back in.
            // Just stay here until next zoom starts.
            lastTime = arrivalTime;
        } else {
            // Zoom OUT to full view
            // But we need a motion for that?
            // If we want to return to full view, we add a motion targeting the Full View.

            // Full View Box
            const fullView: Box = {
                x: 0, y: 0,
                width: mappingConfig.outputVideoSize.width,
                height: mappingConfig.outputVideoSize.height
            };

            const zoomOutStart = Math.max(arrivalTime + 1000, arrivalTime + 500); // Wait at least 500ms
            const zoomOutEnd = zoomOutStart + ZOOM_TRANSITION_DURATION;

            motions.push({
                id: crypto.randomUUID(),
                timeInMs: zoomOutStart,
                timeOutMs: zoomOutEnd,
                target: fullView,
                easing: 'ease_in_out'
            });

            lastTime = zoomOutEnd;
        }
    }

    return motions;
}

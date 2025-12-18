import type { ClickEvent, ZoomConfig, ZoomEvent, ZoomKeyframe, Size } from './types';
import { VideoMappingConfig } from './videoMappingConfig';

export * from './types';
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



// ============================================================================
// Lazy Camera Logic
// ============================================================================

/**
 * Calculates the optimal camera center for `targetPoint` given the `previousCameraCenter`.
 * It tries to keep `targetPoint` within the Inner Box of the camera, minimizing movement from `previousCameraCenter`.
 */
// Helper functions removed as per simplification request

// ============================================================================
// Main Logic: Schedule Calculation
// ============================================================================

/**
 * Generates a schedule of Zoom Keyframes based on events.
 * Returns a list of keyframes defining the Zoom Box at specific timestamps.
 * 
 * Logic:
 * 1. Start with full view (Zoom 1.0) at t=0.
 * 2. At first click, switch to Zoom 2.0 (Target Zoom).
 * 3. For each subsequent click, move camera "Lazily".
 */
export function calculateZoomSchedule(
    config: ZoomConfig,
    mappingConfig: VideoMappingConfig,
    events: ZoomEvent[]
): ZoomKeyframe[] {
    const schedule: ZoomKeyframe[] = [];

    // 1. Identify all Click Events and sort them.
    const clickEvents = events
        .filter((e): e is ClickEvent => e.type === 'click')
        .sort((a, b) => a.timestamp - b.timestamp);

    // 2. Initial State: Full View (Zoom 1.0)
    // Actually, user wants "Zoom 1.0" initially?
    // "not before the click" implied we stay at Zoom 1.0 (or whatever default) until the first click.
    // Let's explicitly add a keyframe at t=0 for Zoom 1.0.

    const initialBox: Box = {
        x: 0,
        y: 0,
        width: mappingConfig.outputVideoSize.width,
        height: mappingConfig.outputVideoSize.height
    };

    schedule.push({
        timestamp: 0,
        zoomBox: initialBox
    });

    if (clickEvents.length === 0) {
        return schedule;
    }

    // 3. Prepare for Zoom Level Calculation
    const zoomLevel = config.zoomIntensity; // e.g. 2.0
    const zoomBoxSize: Size = {
        width: mappingConfig.outputVideoSize.width / zoomLevel,
        height: mappingConfig.outputVideoSize.height / zoomLevel
    };

    // 4. Iterate Events and Generate Keyframes
    for (const evt of clickEvents) {
        const centerOfInterest = mappingConfig.projectInputToOutput({
            x: evt.x,
            y: evt.y
        });

        // Calculate Zoom Box Top-Left
        const newBox: Box = {
            x: centerOfInterest.x - zoomBoxSize.width / 2,
            y: centerOfInterest.y - zoomBoxSize.height / 2,
            width: zoomBoxSize.width,
            height: zoomBoxSize.height
        };

        // Shift-Clamping: Ensure box stays within bounds [0, 0, W, H] without changing size.
        // 1. Clamp X
        // minX = 0. maxX = videoSize.width - newBox.width.
        if (newBox.x < 0) {
            newBox.x = 0;
        } else if (newBox.x > mappingConfig.outputVideoSize.width - newBox.width) {
            newBox.x = mappingConfig.outputVideoSize.width - newBox.width;
        }

        // 2. Clamp Y
        // minY = 0. maxY = videoSize.height - newBox.height.
        if (newBox.y < 0) {
            newBox.y = 0;
        } else if (newBox.y > mappingConfig.outputVideoSize.height - newBox.height) {
            newBox.y = mappingConfig.outputVideoSize.height - newBox.height;
        }

        schedule.push({
            timestamp: evt.timestamp,
            zoomBox: newBox
        });
    }

    return schedule;
}

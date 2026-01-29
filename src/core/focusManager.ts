import { EventType, type MousePositionEvent, type Rect, type Size, type UserEvents, type FocusArea, type HoverEvent } from './types';
import { TimeMapper } from './timeMapper';

// Re-export FocusArea from types for backward compatibility
export type { FocusArea } from './types';

// ============================================================================
// Focus Manager
// ============================================================================

// Minimum hover duration to be considered a valid hover (ms)
const K_HOVER_MIN_DURATION_MS = 2000;

// Minimum hovered card duration to process (ms)
const K_MIN_HOVERED_CARD_DURATION_MS = 3000;

// Inactivity threshold - if gap between current time and next target >= this, zoom out
const K_INACTIVITY_THRESHOLD_MS = 3000;

// Buffer timing constants (used for both start and end)
// Events within this duration from start/end are skipped (or adjusted)
const K_BUFFER_MS = 3000;

// Range events must extend past this threshold to be included
// Also defines the trigger zone at end: [duration - K_EXTEND_BUFFER_MS, duration - K_BUFFER_MS)
const K_EXTEND_BUFFER_MS = 5000; // 3s + 2s buffer

// Size of the hover detection box as a fraction of the larger dimension
const K_HOVER_BOX_FRACTION = 0.1;

/**
 * Union type for all targets that can be processed by FocusManager.
 * Includes explicit events from UserEvents.allEvents and detected HoverEvents.
 * All events extend BaseEvent; some have additional fields like endTime and targetRect.
 */
type FocusTarget = {
    type: EventType;
    timestamp: number;
    mousePos: { x: number; y: number };
    endTime?: number;
    targetRect?: Rect;
};

/**
 * FocusManager handles the sequential emission of focus areas for the zoom schedule.
 * It maintains internal state tracking the current output time position and emits
 * events in priority order as they occur after that position.
 * 
 * Key features:
 * - Processes explicit events (clicks, typing, scrolls, hovered cards)
 * - Detects hover regions from mouse positions between explicit events
 * - Returns full viewport on inactivity (gap >= threshold before next target)
 * 
 * NOTE: This class is internal. Use getAllFocusAreas() instead.
 */
class FocusManager {
    private events: UserEvents;
    private timeMapper: TimeMapper;
    private currentOutputTime: number;
    private allEventsIdx: number;
    private filteredMouseIdx: number;
    private hoverBoxSize: number;
    private readonly fullViewportRect: Rect;
    private readonly outputDuration: number;

    // Pre-processed mouse positions (filtered and remapped to output time)
    private filteredMousePositions: MousePositionEvent[];

    // Pending target: when we detect inactivity, we save the target and return full viewport first
    private pendingTarget: FocusTarget | null = null;

    // Track when to emit final_zoomout (may be moved earlier by events in trigger zone)
    private finalZoomoutTime: number;
    private finalZoomoutEmitted: boolean = false;

    constructor(events: UserEvents, timeMapper: TimeMapper, sourceSize: Size) {
        this.events = events;
        this.timeMapper = timeMapper;
        this.currentOutputTime = 0;
        this.allEventsIdx = 0;
        this.filteredMouseIdx = 0;
        this.hoverBoxSize = Math.max(sourceSize.width, sourceSize.height) * K_HOVER_BOX_FRACTION;
        this.fullViewportRect = { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
        this.outputDuration = timeMapper.outputDuration;

        // Default final zoomout time (may be adjusted earlier by events in trigger zone)
        this.finalZoomoutTime = Math.max(0, this.outputDuration - K_BUFFER_MS);

        // Pre-compute remapped mouse positions (filter out positions outside output windows)
        // Also apply start buffer filtering for mouse positions
        this.filteredMousePositions = events.mousePositions
            .map(pos => this.remapEventToOutputTime(pos) as MousePositionEvent | null)
            .filter((pos): pos is MousePositionEvent => pos !== null)
            .filter(pos => pos.timestamp >= K_BUFFER_MS);
    }

    /**
     * Gets the next focus area after currentOutputTime.
     * Returns focus rects in order, detecting hovers between explicit events.
     * Returns full viewport when there's inactivity before the next target.
     * 
     * @returns The next focus area (timestamp + rect) or null if no more events
     */
    public getNextFocusArea(): FocusArea | null {
        // If we have a pending target from a previous inactivity zoom-out, process it now
        if (this.pendingTarget) {
            const target = this.pendingTarget;
            this.pendingTarget = null;
            return this.processTarget(target);
        }

        // Find the next target (hover or explicit event)
        const nextTarget = this.findNextTarget();
        if (!nextTarget) {
            // No more events - emit final_zoomout if not already done
            if (!this.finalZoomoutEmitted && this.outputDuration > 0) {
                this.finalZoomoutEmitted = true;
                return {
                    timestamp: this.finalZoomoutTime,
                    rect: this.fullViewportRect,
                    reason: 'final_zoomout'
                };
            }
            return null;
        }

        // Check for inactivity gap
        const targetStartTime = nextTarget.timestamp;

        const gap = targetStartTime - this.currentOutputTime;

        if (gap >= K_INACTIVITY_THRESHOLD_MS) {
            // Inactivity detected - save target for next call and return full viewport
            this.pendingTarget = nextTarget;
            // Advance time to just before the target
            this.currentOutputTime = targetStartTime - 1;
            return { timestamp: this.currentOutputTime + 1000, rect: this.fullViewportRect, reason: 'inactivity' };
        }

        // No inactivity - process the target normally
        return this.processTarget(nextTarget);
    }

    /**
     * Finds the next target (hover or explicit event) after currentOutputTime.
     * Applies start/end buffer filtering to both events and hovers.
     */
    private findNextTarget(): FocusTarget | null {
        const hardCutoffTime = this.outputDuration - K_BUFFER_MS;
        const triggerZoneStart = this.outputDuration - K_EXTEND_BUFFER_MS;

        while (true) {
            // Get the next valid explicit event
            const nextEvent = this.peekNextValidEvent();

            // Determine the time limit for hover search
            const hoverTimeLimit = nextEvent ? nextEvent.timestamp : Number.POSITIVE_INFINITY;

            // Try to find a hover before the next explicit event
            const hover = this.findNextHover(hoverTimeLimit);

            // Pick the earlier target (hover or event)
            let target: FocusTarget | null = null;
            if (hover) {
                target = hover;
            } else if (nextEvent) {
                this.allEventsIdx++; // Consume the event
                target = nextEvent;
            }

            if (!target) {
                return null;
            }

            const timestamp = target.timestamp;

            // === START BUFFER LOGIC ===
            // Targets starting before K_BUFFER_MS (3s)
            if (timestamp < K_BUFFER_MS) {
                const hasEndTime = 'endTime' in target && target.endTime !== undefined;

                if (!hasEndTime) {
                    // No endTime -> skip entirely, continue to find next target
                    continue;
                }

                // Has endTime -> check if it extends past threshold (5s)
                if (target.endTime !== undefined && target.endTime <= K_EXTEND_BUFFER_MS) {
                    // Doesn't extend far enough -> skip
                    continue;
                }

                // Target extends past threshold -> adjust timestamp to 3s
                target = { ...target, timestamp: K_BUFFER_MS };
            }

            // === END BUFFER LOGIC ===
            // Targets at or after hard cutoff (t-3s) -> skip completely
            if (target.timestamp >= hardCutoffTime) {
                continue;
            }

            // Targets in trigger zone [t-5s, t-3s) -> skip but adjust finalZoomoutTime
            if (target.timestamp >= triggerZoneStart) {
                // Move final zoomout earlier to this target's timestamp
                this.finalZoomoutTime = Math.min(this.finalZoomoutTime, target.timestamp);
                continue;
            }

            // Valid target found
            return target;
        }
    }

    /**
     * Peeks at the next valid explicit event without consuming it.
     */
    private peekNextValidEvent(): FocusTarget | null {
        let idx = this.allEventsIdx;

        while (idx < this.events.allEvents.length) {
            const event = this.remapEventToOutputTime(this.events.allEvents[idx]);

            // Skip events that are not visible in output
            if (!event) {
                idx++;
                this.allEventsIdx = idx;
                continue;
            }

            // Skip events before currentOutputTime
            if (event.timestamp < this.currentOutputTime) {
                idx++;
                this.allEventsIdx = idx;
                continue;
            }

            // For hovered cards, skip if visible duration is too short
            if (event.type === EventType.HOVERED_CARD) {
                if (event.endTime - event.timestamp < K_MIN_HOVERED_CARD_DURATION_MS) {
                    idx++;
                    this.allEventsIdx = idx;
                    continue;
                }
            }

            // Found a valid event
            return event;
        }

        return null;
    }

    /**
     * Finds the next hover region from pre-filtered mouse positions, up to the time limit.
     * A hover is detected when the mouse stays within a small bounding box
     * for at least K_HOVER_MIN_DURATION_MS.
     * 
     * Returns targetRect (bounding box) instead of center point.
     */
    private findNextHover(timeLimit: number): any | null {
        const positions = this.filteredMousePositions;
        let searchIdx = this.filteredMouseIdx;

        while (searchIdx < positions.length) {
            const startPos = positions[searchIdx];

            // Skip positions before currentOutputTime
            if (startPos.timestamp < this.currentOutputTime) {
                searchIdx++;
                this.filteredMouseIdx = searchIdx;
                continue;
            }

            // Stop if we've reached the time limit
            if (startPos.timestamp >= timeLimit) {
                break;
            }

            // Start hover detection at this position
            let j = searchIdx;
            let minX = startPos.mousePos.x;
            let maxX = startPos.mousePos.x;
            let minY = startPos.mousePos.y;
            let maxY = startPos.mousePos.y;
            let validHoverEndIdx = -1;
            let validHoverEndTime = -1;
            let lastTimestamp = startPos.timestamp;

            while (j < positions.length) {
                const pos = positions[j];

                // Check for gap between consecutive points
                const gapFromPrev = pos.timestamp - lastTimestamp;
                if (gapFromPrev > K_HOVER_MIN_DURATION_MS) {
                    // Gap too large - hover sequence is broken
                    break;
                }

                // Stop if we cross the time limit
                if (pos.timestamp >= timeLimit) break;

                const p = pos.mousePos;
                const newMinX = Math.min(minX, p.x);
                const newMaxX = Math.max(maxX, p.x);
                const newMinY = Math.min(minY, p.y);
                const newMaxY = Math.max(maxY, p.y);

                if ((newMaxX - newMinX) <= this.hoverBoxSize && (newMaxY - newMinY) <= this.hoverBoxSize) {
                    // Still within box
                    const duration = pos.timestamp - startPos.timestamp;
                    if (duration >= K_HOVER_MIN_DURATION_MS) {
                        validHoverEndIdx = j;
                        validHoverEndTime = pos.timestamp;
                    }

                    minX = newMinX;
                    maxX = newMaxX;
                    minY = newMinY;
                    maxY = newMaxY;
                    lastTimestamp = pos.timestamp;
                    j++;
                } else {
                    break; // Broken box
                }
            }

            // Virtual endpoint: check if hover extends to timeLimit
            if (timeLimit !== Number.POSITIVE_INFINITY) {
                const gapToTimeLimit = timeLimit - lastTimestamp;
                if (gapToTimeLimit <= K_HOVER_MIN_DURATION_MS) {
                    const duration = timeLimit - startPos.timestamp;
                    if (duration >= K_HOVER_MIN_DURATION_MS) {
                        validHoverEndTime = timeLimit;
                        if (validHoverEndIdx === -1) {
                            validHoverEndIdx = j > searchIdx ? j - 1 : searchIdx;
                        }
                    }
                }
            }

            if (validHoverEndIdx !== -1 && validHoverEndTime !== -1) {
                // Found a valid hover - return bounding box directly
                this.filteredMouseIdx = validHoverEndIdx + 1;

                const hoverEvent: HoverEvent = {
                    type: EventType.HOVER,
                    timestamp: startPos.timestamp,
                    endTime: validHoverEndTime,
                    // mousePos is the center of the hover region
                    mousePos: {
                        x: (minX + maxX) / 2,
                        y: (minY + maxY) / 2
                    },
                    targetRect: {
                        x: minX,
                        y: minY,
                        width: maxX - minX,
                        height: maxY - minY
                    }
                };
                return hoverEvent;
            }

            searchIdx++;
        }

        // No hover found - advance filteredMouseIdx to timeLimit
        while (this.filteredMouseIdx < positions.length) {
            if (positions[this.filteredMouseIdx].timestamp >= timeLimit) break;
            this.filteredMouseIdx++;
        }

        return null;
    }

    /**
     * Processes a target (hover or event) and returns its focus area.
     */
    private processTarget(target: FocusTarget): FocusArea {
        const timestamp = target.timestamp;

        // Advance currentOutputTime
        this.currentOutputTime = timestamp + 1;

        // For range events, try advancing to endTime - 500 if larger
        if ('endTime' in target && target.endTime !== undefined) {
            this.currentOutputTime = Math.max(this.currentOutputTime, target.endTime - 500);
        }

        // Advance filteredMouseIdx past this event's time
        while (this.filteredMouseIdx < this.filteredMousePositions.length) {
            if (this.filteredMousePositions[this.filteredMouseIdx].timestamp > this.currentOutputTime) break;
            this.filteredMouseIdx++;
        }

        // Use the type field directly as the reason
        const reason = target.type;

        return {
            timestamp,
            rect: this.getEventRect(target),
            reason,
        };
    }



    /**
     * Gets the rect for a target. If the target has a targetRect property, returns it.
     * Otherwise, returns a 100x100 box centered on the mouse position.
     */
    private getEventRect(target: FocusTarget): Rect {
        // URL changes should show the full viewport
        if (target.type === EventType.URLCHANGE) {
            return this.fullViewportRect;
        }

        let rect: Rect;
        if ('targetRect' in target && target.targetRect) {
            rect = target.targetRect;
        } else if ('mousePos' in target && target.mousePos) {
            // Fallback: 100x100 box centered on mouse position
            rect = {
                x: target.mousePos.x - 50,
                y: target.mousePos.y - 50,
                width: 100,
                height: 100,
            };
        } else {
            // No targetRect or mousePos - return full viewport
            return this.fullViewportRect;
        }

        // Clamp rect to viewport bounds
        return this.clampRectToViewport(rect);
    }

    /**
     * Clamps a rect to stay within the viewport bounds.
     */
    private clampRectToViewport(rect: Rect): Rect {
        const viewport = this.fullViewportRect;

        // Clamp position to viewport bounds
        let x = Math.max(0, Math.min(rect.x, viewport.width - 1));
        let y = Math.max(0, Math.min(rect.y, viewport.height - 1));

        // Clamp width/height so rect doesn't extend past viewport
        const width = Math.min(rect.width, viewport.width - x);
        const height = Math.min(rect.height, viewport.height - y);

        return { x, y, width, height };
    }

    /**
     * Remaps an event from source time to output time.
     * Returns the event with output timestamps, or null if the event is not visible
     * or should be skipped for focus purposes.
     */
    private remapEventToOutputTime(event: any): any | null {
        // Skip keyboard and drag events for focus purposes
        if (event.type === EventType.KEYDOWN || event.type === EventType.MOUSEDRAG) {
            return null;
        }

        // For range events (with endTime), use range mapping
        if ('endTime' in event && event.endTime !== undefined) {
            const outputRange = this.timeMapper.mapSourceRangeToOutputRange(event.timestamp, event.endTime);
            if (!outputRange) {
                return null;
            }
            return {
                ...event,
                timestamp: outputRange.start,
                endTime: outputRange.end,
            };
        }

        // For point events, use point mapping
        const outputTime = this.timeMapper.mapSourceToOutputTime(event.timestamp);
        if (outputTime === -1) {
            return null;
        }
        return {
            ...event,
            timestamp: outputTime,
        };
    }
}

/**
 * Helper function to extract all focus areas from a FocusManager.
 * Creates a temporary FocusManager and iterates through all focus areas.
 */
export function getAllFocusAreas(
    userEvents: UserEvents,
    timeMapper: TimeMapper,
    sourceSize: Size
): FocusArea[] {
    const focusManager = new FocusManager(userEvents, timeMapper, sourceSize);
    const focusAreas: FocusArea[] = [];

    let focusArea = focusManager.getNextFocusArea();
    while (focusArea) {
        focusAreas.push(focusArea);
        focusArea = focusManager.getNextFocusArea();
    }

    return focusAreas;
}

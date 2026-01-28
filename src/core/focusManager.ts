import { EventType, type Rect, type Size, type UserEvents } from './types';
import { TimeMapper } from './timeMapper';

// ============================================================================
// Focus Manager
// ============================================================================

// Minimum hover duration to be considered a valid hover (ms)
const K_HOVER_MIN_DURATION_MS = 1000;

// Minimum hovered card duration to process (ms)
const K_MIN_HOVERED_CARD_DURATION_MS = 3000;

// Inactivity threshold - if gap between current time and next target >= this, zoom out
const K_INACTIVITY_THRESHOLD_MS = 3000;

// Size of the hover detection box as a fraction of the larger dimension
const K_HOVER_BOX_FRACTION = 0.1;

/**
 * Return type for getNextFocusArea - contains both when and where to focus
 */
export interface FocusArea {
    timestamp: number;  // Output time when this focus area applies
    rect: Rect;         // The focus rectangle in source coordinates
    reason: string;     // Why this focus area was returned (event type, 'hover', or 'inactivity')
}

/**
 * FocusManager handles the sequential emission of focus areas for the zoom schedule.
 * It maintains internal state tracking the current output time position and emits
 * events in priority order as they occur after that position.
 * 
 * Key features:
 * - Processes explicit events (clicks, typing, scrolls, hovered cards)
 * - Detects hover regions from mouse positions between explicit events
 * - Returns full viewport on inactivity (gap >= threshold before next target)
 */
export class FocusManager {
    private events: UserEvents;
    private timeMapper: TimeMapper;
    private currentOutputTime: number;
    private allEventsIdx: number;
    private mousePositionIdx: number;
    private hoverBoxSize: number;
    private readonly fullViewportRect: Rect;

    // Pending target: when we detect inactivity, we save the target and return full viewport first
    private pendingTarget: { type: 'event' | 'hover'; data: any } | null = null;

    constructor(events: UserEvents, timeMapper: TimeMapper, sourceSize: Size) {
        this.events = events;
        this.timeMapper = timeMapper;
        this.currentOutputTime = 0;
        this.allEventsIdx = 0;
        this.mousePositionIdx = 0;
        this.hoverBoxSize = Math.max(sourceSize.width, sourceSize.height) * K_HOVER_BOX_FRACTION;
        this.fullViewportRect = { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
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
            return null;
        }

        // Check for inactivity gap
        const targetStartTime = nextTarget.data.timestamp;

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
     */
    private findNextTarget(): { type: 'event' | 'hover'; data: any } | null {
        // Get the next valid explicit event
        const nextEvent = this.peekNextValidEvent();

        // Determine the time limit for hover search
        const hoverTimeLimit = nextEvent ? nextEvent.timestamp : Number.POSITIVE_INFINITY;

        // Try to find a hover before the next explicit event
        const hover = this.findNextHover(hoverTimeLimit);

        if (hover) {
            // Found a hover - return it (it's before the explicit event)
            return { type: 'hover', data: hover };
        }

        if (nextEvent) {
            // No hover found, return the explicit event
            this.allEventsIdx++; // Consume the event
            return { type: 'event', data: nextEvent };
        }

        return null;
    }

    /**
     * Peeks at the next valid explicit event without consuming it.
     */
    private peekNextValidEvent(): any | null {
        let idx = this.allEventsIdx;

        while (idx < this.events.allEvents.length) {
            const event = this.remapEventToOutputTime(this.events.allEvents[idx]);

            // Skip events before currentOutputTime or not visible
            if (!event || event.timestamp < this.currentOutputTime) {
                idx++;
                this.allEventsIdx = idx; // Consume skipped events
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
     * Finds the next hover region from mouse positions, up to the time limit.
     * A hover is detected when the mouse stays within a small bounding box
     * for at least K_HOVER_MIN_DURATION_MS.
     */
    // TODO: optimize!!!!
    private findNextHover(timeLimit: number): any | null {
        const mousePositions = this.events.mousePositions;
        let searchIdx = this.mousePositionIdx;

        while (searchIdx < mousePositions.length) {
            // Remap mouse position to output time
            const startPos = this.remapEventToOutputTime(mousePositions[searchIdx]);
            if (!startPos) {
                searchIdx++;
                continue;
            }

            // Skip positions before currentOutputTime
            if (startPos.timestamp < this.currentOutputTime) {
                searchIdx++;
                this.mousePositionIdx = searchIdx;
                continue;
            }

            // Stop if we've reached the time limit
            if (startPos.timestamp >= timeLimit) {
                break;
            }

            // Start hover detection at this position
            let i = searchIdx;
            let j = i;
            let minX = startPos.mousePos.x;
            let maxX = startPos.mousePos.x;
            let minY = startPos.mousePos.y;
            let maxY = startPos.mousePos.y;
            let validHoverEndIdx = -1;
            let validHoverEndTime = -1;
            let lastTimestamp = startPos.timestamp;
            let lastMousePos = startPos.mousePos;

            while (j < mousePositions.length) {
                const mappedPos = this.remapEventToOutputTime(mousePositions[j]);
                if (!mappedPos) {
                    j++;
                    continue;
                }

                // Check for gap between consecutive points
                const gapFromPrev = mappedPos.timestamp - lastTimestamp;
                if (gapFromPrev > K_HOVER_MIN_DURATION_MS) {
                    // Gap too large - hover sequence is broken
                    break;
                }

                // Stop if we cross the time limit (but we'll check virtual endpoint after)
                if (mappedPos.timestamp >= timeLimit) break;

                const p = mappedPos.mousePos;
                const newMinX = Math.min(minX, p.x);
                const newMaxX = Math.max(maxX, p.x);
                const newMinY = Math.min(minY, p.y);
                const newMaxY = Math.max(maxY, p.y);

                if ((newMaxX - newMinX) <= this.hoverBoxSize && (newMaxY - newMinY) <= this.hoverBoxSize) {
                    // Still within box
                    const duration = mappedPos.timestamp - startPos.timestamp;
                    if (duration >= K_HOVER_MIN_DURATION_MS) {
                        validHoverEndIdx = j;
                        validHoverEndTime = mappedPos.timestamp;
                    }

                    minX = newMinX;
                    maxX = newMaxX;
                    minY = newMinY;
                    maxY = newMaxY;
                    lastTimestamp = mappedPos.timestamp;
                    lastMousePos = p;
                    j++;
                } else {
                    break; // Broken box
                }
            }

            // Virtual endpoint: check if hover extends to timeLimit
            // (treating timeLimit as a virtual point at last seen position)
            if (timeLimit !== Number.POSITIVE_INFINITY) {
                const gapToTimeLimit = timeLimit - lastTimestamp;
                // Only extend if gap is not too large
                if (gapToTimeLimit <= K_HOVER_MIN_DURATION_MS) {
                    // Virtual point at timeLimit with last mouse position (same position, so box stays valid)
                    const duration = timeLimit - startPos.timestamp;
                    if (duration >= K_HOVER_MIN_DURATION_MS) {
                        // Use timeLimit as the end time, but keep the last valid index for center calculation
                        validHoverEndTime = timeLimit;
                        if (validHoverEndIdx === -1) {
                            validHoverEndIdx = j - 1; // Use last valid point for center calc
                        }
                    }
                }
            }

            if (validHoverEndIdx !== -1 && validHoverEndTime !== -1) {
                // Found a valid hover!
                // Calculate center of hover
                const points: { x: number; y: number }[] = [];
                for (let k = i; k <= validHoverEndIdx; k++) {
                    const mp = this.remapEventToOutputTime(mousePositions[k]);
                    if (mp) points.push(mp.mousePos);
                }
                // Include last mouse position if virtual endpoint was used
                if (points.length === 0) {
                    points.push(lastMousePos);
                }
                const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
                const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

                // Advance mousePositionIdx past this hover
                this.mousePositionIdx = validHoverEndIdx + 1;

                return {
                    type: EventType.HOVER,
                    timestamp: startPos.timestamp,
                    endTime: validHoverEndTime,
                    mousePos: { x: centerX, y: centerY }
                };
            }

            searchIdx++;
        }

        // No hover found - advance mousePositionIdx to timeLimit
        while (this.mousePositionIdx < mousePositions.length) {
            const mp = this.remapEventToOutputTime(mousePositions[this.mousePositionIdx]);
            if (mp && mp.timestamp >= timeLimit) break;
            this.mousePositionIdx++;
        }

        return null;
    }

    /**
     * Processes a target (hover or event) and returns its focus area.
     */
    private processTarget(target: { type: 'event' | 'hover'; data: any }): FocusArea {
        const data = target.data;
        const timestamp = data.timestamp;

        // Advance currentOutputTime
        this.currentOutputTime = timestamp + 1;

        // For range events, try advancing to endTime - 500 if larger
        if ('endTime' in data && data.endTime !== undefined) {
            this.currentOutputTime = Math.max(this.currentOutputTime, data.endTime - 500);
        }

        // Advance mousePositionIdx past this event's time
        const mousePositions = this.events.mousePositions;
        while (this.mousePositionIdx < mousePositions.length) {
            const mp = this.remapEventToOutputTime(mousePositions[this.mousePositionIdx]);
            if (mp && mp.timestamp > this.currentOutputTime) break;
            this.mousePositionIdx++;
        }

        // Determine the reason string
        const reason = target.type === 'hover' ? 'hover' : data.type;

        return {
            timestamp,
            rect: this.getEventRect(data),
            reason,
        };
    }



    /**
     * Gets the rect for an event. If the event has a targetRect property, returns it.
     * Otherwise, returns a 100x100 box centered on the mouse position.
     */
    private getEventRect(event: any): Rect {
        if ('targetRect' in event && event.targetRect) {
            return event.targetRect;
        }
        // Fallback: 100x100 box centered on mouse position
        return {
            x: event.mousePos.x - 50,
            y: event.mousePos.y - 50,
            width: 100,
            height: 100,
        };
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

import { EventType, type BaseEvent, type Rect, type Size, type UserEvents, type FocusArea } from '../types';
import { TimeMapper } from '../timeMapper';
import { HoverDetector } from './hoverDetector';

// Re-export FocusArea from types for backward compatibility
export type { FocusArea } from '../types';

// ============================================================================
// Constants
// ============================================================================

/** If gap between current time and next target >= this, trigger inactivity zoom-out */
const K_INACTIVITY_THRESHOLD_MS = 5000;
/** Wait before starting the inactivity zoom-out */
const K_INACTIVITY_ZOOM_BUFFER_MS = 2000;

/** Size of the hover detection bounding box (fraction of larger screen dimension) */
const K_HOVER_BOX_FRACTION = 0.2;

/** Size of the click detection box - fallback when no targetRect (fraction of larger screen dimension) */
const K_CLICK_BOX_FRACTION = 0.2;

/** Minimum movement required to start a new hover (fraction of larger screen dimension) */
const K_MIN_HOVER_MOVEMENT_FRACTION = 0.1;

// ============================================================================
// Focus Manager
// ============================================================================

/**
 * FocusManager handles the sequential emission of focus areas for the zoom schedule.
 * It maintains internal state tracking the current output time position and emits
 * events in priority order as they occur after that position.
 *
 * Key features:
 * - Processes explicit events (clicks, typing, scrolls, hovered cards)
 * - Detects hover regions from mouse positions between explicit events (via HoverDetector)
 * - Returns full viewport on inactivity (gap >= threshold before next target)
 *
 * NOTE: This class is internal. Use getAllFocusAreas() instead.
 */
class FocusManager {
    private readonly events: UserEvents;
    private readonly timeMapper: TimeMapper;
    private readonly fullViewportRect: Rect;
    private readonly clickBoxSize: number;
    private readonly hoverDetector: HoverDetector;
    private readonly outputDuration: number;

    /** Current position in output timeline */
    private currentOutputTime: number = 0;

    /** Index into allEvents array */
    private allEventsIdx: number = 0;

    /** Pending target: when we detect inactivity, we save the target and return full viewport first */
    private pendingTarget: BaseEvent | null = null;

    constructor(events: UserEvents, timeMapper: TimeMapper, sourceSize: Size) {
        this.events = events;
        this.timeMapper = timeMapper;

        const largerDimension = Math.max(sourceSize.width, sourceSize.height);
        this.clickBoxSize = largerDimension * K_CLICK_BOX_FRACTION;
        this.fullViewportRect = { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
        this.outputDuration = timeMapper.outputDuration;

        // Pre-compute remapped mouse positions and create hover detector
        const filteredMousePositions = events.mousePositions
            .map(pos => this.remapEventToOutputTime(pos))
            .filter((pos): pos is BaseEvent => pos !== null);

        this.hoverDetector = new HoverDetector(
            filteredMousePositions,
            largerDimension * K_HOVER_BOX_FRACTION,
            largerDimension * K_MIN_HOVER_MOVEMENT_FRACTION
        );
    }

    // ========================================================================
    // Public API
    // ========================================================================

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
            // No more targets - return full viewport zoom-out at the end
            const endTimestamp = Math.max(
                this.currentOutputTime,
                Math.min(this.currentOutputTime + K_INACTIVITY_ZOOM_BUFFER_MS, this.outputDuration - 500)
            );
            // Only return null if we've already emitted this final zoom-out
            if (endTimestamp <= this.currentOutputTime) {
                return null;
            }
            this.currentOutputTime = endTimestamp;
            return {
                timestamp: endTimestamp,
                rect: this.fullViewportRect,
                reason: 'final_zoomout'
            };
        }

        // Check for inactivity gap (use clamped time for ongoing range events)
        const targetStartTime = Math.max(nextTarget.timestamp, this.currentOutputTime);
        const gap = targetStartTime - this.currentOutputTime;

        if (gap >= K_INACTIVITY_THRESHOLD_MS) {
            // Inactivity detected - save target for next call and return full viewport
            this.pendingTarget = nextTarget;
            this.currentOutputTime = targetStartTime - 1;
            return {
                timestamp: this.currentOutputTime + K_INACTIVITY_ZOOM_BUFFER_MS,
                rect: this.fullViewportRect,
                reason: 'inactivity'
            };
        }

        // No inactivity - process the target normally
        return this.processTarget(nextTarget);
    }

    // ========================================================================
    // Target Finding
    // ========================================================================

    /**
     * Finds the next target (hover or explicit event) after currentOutputTime.
     * Hovers are detected between explicit events and take priority if they occur earlier.
     */
    private findNextTarget(): BaseEvent | null {
        const nextEvent = this.peekNextValidEvent();

        // Search for hovers up until the next explicit event (or infinity if none)
        const hoverTimeLimit = nextEvent?.timestamp ?? Number.POSITIVE_INFINITY;
        const hover = this.hoverDetector.findNext(this.currentOutputTime, hoverTimeLimit);

        if (hover) {
            return hover;
        } else if (nextEvent) {
            this.allEventsIdx++; // Consume the event
            return nextEvent;
        }

        return null;
    }

    /**
     * Peeks at the next valid explicit event without consuming it.
     * Handles range events that started before currentOutputTime but are still ongoing.
     */
    private peekNextValidEvent(): BaseEvent | null {
        while (this.allEventsIdx < this.events.allEvents.length) {
            const event = this.remapEventToOutputTime(this.events.allEvents[this.allEventsIdx]);

            // Skip events that are not visible in output
            if (!event) {
                this.allEventsIdx++;
                continue;
            }

            // Skip events that have fully passed
            if (event.timestamp < this.currentOutputTime) {
                // For range events, only skip if the event has ended
                if ('endTime' in event && event.endTime !== undefined) {
                    if (event.endTime > this.currentOutputTime) {
                        // Event is still ongoing - return it
                        return event;
                    }
                }
                // Point event or range event that has ended - skip
                this.allEventsIdx++;
                continue;
            }

            return event;
        }

        return null;
    }

    // ========================================================================
    // Target Processing
    // ========================================================================

    /**
     * Processes a target (hover or event) and returns its focus area.
     * Advances internal state to move past this target.
     */
    private processTarget(target: BaseEvent): FocusArea {
        const timestamp = target.timestamp;

        // Save original currentOutputTime for clamping the returned timestamp
        // (for ongoing range events that started before currentOutputTime)
        const originalOutputTime = this.currentOutputTime;

        // Advance currentOutputTime based on event type
        if (target.type === EventType.URLCHANGE) {
            this.currentOutputTime = timestamp + 1000;
        } else {
            this.currentOutputTime = timestamp + 1;
        }

        // Advance hover detector past this event's time
        this.hoverDetector.advancePast(this.currentOutputTime);

        return {
            timestamp: Math.max(timestamp, originalOutputTime),
            rect: this.getEventRect(target),
            reason: target.type,
        };
    }

    // ========================================================================
    // Rect Calculation
    // ========================================================================

    /**
     * Gets the focus rect for a target event.
     * Uses targetRect if available, otherwise creates a box around mousePos.
     */
    private getEventRect(target: BaseEvent): Rect {
        // URL changes should show the full viewport
        if (target.type === EventType.URLCHANGE) {
            return this.fullViewportRect;
        }
        let rect: Rect;
        if (target.type === EventType.CLICK) {
            const halfSize = this.clickBoxSize / 2;
            rect = {
                x: target.mousePos.x - halfSize,
                y: target.mousePos.y - halfSize,
                width: this.clickBoxSize,
                height: this.clickBoxSize,
            };
        }

        if ('targetRect' in target && target.targetRect) {
            rect = target.targetRect;
        } else {
            console.warn('No targetRect found for event', target);
            return this.fullViewportRect;
        }

        return this.clampRectToViewport(rect);
    }

    /**
     * Clamps a rect to stay within the viewport bounds.
     */
    private clampRectToViewport(rect: Rect): Rect {
        const viewport = this.fullViewportRect;

        const x = Math.max(0, Math.min(rect.x, viewport.width - 1));
        const y = Math.max(0, Math.min(rect.y, viewport.height - 1));
        const width = Math.min(rect.width, viewport.width - x);
        const height = Math.min(rect.height, viewport.height - y);

        return { x, y, width, height };
    }

    // ========================================================================
    // Time Remapping
    // ========================================================================

    /**
     * Remaps an event from source time to output time.
     * Returns null if the event is not visible in output or should be skipped.
     */
    private remapEventToOutputTime(event: BaseEvent): BaseEvent | null {
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

// ============================================================================
// Public API
// ============================================================================

/**
 * Extracts all focus areas from the given events and time mapping.
 * This is the main entry point for focus area calculation.
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

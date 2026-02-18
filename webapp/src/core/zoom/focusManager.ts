import { EventType, type BaseEvent, type Rect, type Size, type UserEvents, type FocusArea } from '../../types';
import { HoverDetector } from './hoverDetector';
import { clampRectToBounds, enlargeRect, DEFAULT_ENLARGE_FACTOR } from '../geometry';

// Re-export FocusArea from types for backward compatibility
export type { FocusArea } from '../../types';

// ============================================================================
// Constants
// ============================================================================

/** Max size threshold — if targetRect exceeds this on either dimension, fall back to box (fraction of larger screen dimension) */
const K_CLICK_MAX_RECT_FRACTION = 0.4;

/** Fallback click box size when targetRect is too large or missing (fraction of larger screen dimension) */
const K_CLICK_FALLBACK_BOX_FRACTION = 0.10;



// ============================================================================
// Focus Manager
// ============================================================================

/**
 * FocusManager emits focus areas as pure measured facts:
 *
 * - Clicks: instant (start = end = clickTime). AutoZoom decides hold duration.
 * - Range events (typing, scroll, hover, hovered cards): [measuredStart, measuredEnd]
 * - URL changes: sentinel with rect = fullViewport (forces zoom out)
 *
 * Operates entirely in SOURCE TIME. No timing decisions — autoZoom handles
 * transition padding, chaining, merging, and minimum durations.
 *
 * NOTE: This class is internal. Use getAllFocusAreas() instead.
 */
class FocusManager {
    private readonly events: UserEvents;
    private readonly fullViewportRect: Rect;
    private readonly clickFallbackBoxSize: number;
    private readonly clickMaxRectSize: number;
    private readonly hoverDetector: HoverDetector;
    private readonly sourceDuration: number;

    /** Current position in source timeline */
    private currentSourceTime: number = 0;

    /** Index into allEvents array */
    private allEventsIdx: number = 0;

    constructor(events: UserEvents, sourceSize: Size, sourceDurationMs: number) {
        this.events = events;
        this.sourceDuration = sourceDurationMs;

        const largerDimension = Math.max(sourceSize.width, sourceSize.height);
        this.clickFallbackBoxSize = largerDimension * K_CLICK_FALLBACK_BOX_FRACTION;
        this.clickMaxRectSize = largerDimension * K_CLICK_MAX_RECT_FRACTION;
        this.fullViewportRect = { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };

        // Mouse positions are already in source time — pass directly to hover detector
        this.hoverDetector = new HoverDetector(
            events.mousePositions,
            largerDimension
        );
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Gets the next focus area after currentSourceTime.
     * Returns focus rects in order, detecting hovers between explicit events.
     */
    public getNextFocusArea(): FocusArea | null {
        const nextTarget = this.findNextTarget();
        if (!nextTarget) {
            return null;
        }
        return this.processTarget(nextTarget);
    }

    // ========================================================================
    // Target Finding
    // ========================================================================

    /**
     * Finds the next target (hover or explicit event) after currentSourceTime.
     * Hovers are detected between explicit events and take priority if they occur earlier.
     */
    private findNextTarget(): BaseEvent | null {
        const nextEvent = this.peekNextValidEvent();

        // Search for hovers up until the next explicit event (or end of source)
        const hoverTimeLimit = nextEvent?.timestamp ?? this.sourceDuration;
        console.log(`[FM] findNext: currentSourceTime=${this.currentSourceTime}, hoverTimeLimit=${hoverTimeLimit}, nextEvent=${nextEvent?.type ?? 'none'}@${nextEvent?.timestamp ?? '-'}`);
        const hover = this.hoverDetector.findNext(this.currentSourceTime, hoverTimeLimit);

        if (hover) {
            console.log(`[FM] → hover found: ${hover.timestamp}-${hover.endTime}`);
            return hover;
        } else if (nextEvent) {
            console.log(`[FM] → no hover, using event: ${nextEvent.type}@${nextEvent.timestamp}`);
            this.allEventsIdx++; // Consume the event
            return nextEvent;
        }

        console.log(`[FM] → no target found, done`);
        return null;
    }

    /**
     * Peeks at the next valid explicit event without consuming it.
     * Handles range events that started before currentSourceTime but are still ongoing.
     */
    private peekNextValidEvent(): BaseEvent | null {
        while (this.allEventsIdx < this.events.allEvents.length) {
            const event = this.events.allEvents[this.allEventsIdx];

            // Skip events that aren't valid for focus
            if (!this.isValidFocusEvent(event)) {
                this.allEventsIdx++;
                continue;
            }

            // Skip events that have fully passed
            if (event.timestamp < this.currentSourceTime) {
                // For range events, only skip if the event has ended
                if (event.endTime !== undefined) {
                    if (event.endTime > this.currentSourceTime) {
                        // Event is still ongoing - clamp start time and return it
                        return { ...event, timestamp: this.currentSourceTime };
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
     * Processes a target and returns its focus area.
     * FocusAreas are pure measured facts — no timing padding added.
     */
    private processTarget(target: BaseEvent): FocusArea {
        let sourceStartTimeMs: number;
        let sourceEndTimeMs: number;

        if (target.type === EventType.URLCHANGE) {
            // URL change: sentinel — instant, full viewport, forces zoom out
            sourceStartTimeMs = target.timestamp;
            sourceEndTimeMs = target.timestamp;
        } else if (target.type === EventType.CLICK) {
            // Click: instant — autoZoom decides hold duration
            sourceStartTimeMs = target.timestamp;
            sourceEndTimeMs = target.timestamp;
        } else if (target.endTime !== undefined) {
            // Range events (typing, scroll, hovered cards, hover): measured time range
            sourceStartTimeMs = Math.max(target.timestamp, this.currentSourceTime);
            sourceEndTimeMs = target.endTime;
        } else {
            // Fallback for unknown point events
            sourceStartTimeMs = target.timestamp;
            sourceEndTimeMs = target.timestamp;
        }

        // Clamp to source duration
        sourceEndTimeMs = Math.min(sourceEndTimeMs, this.sourceDuration);

        // Advance currentSourceTime past this focus area
        this.currentSourceTime = sourceEndTimeMs + 1;

        // Advance hover detector — only for explicit events (hovers handle their own index)
        if (target.type !== EventType.HOVER) {
            this.hoverDetector.advancePast(this.currentSourceTime);
        }

        const area: FocusArea = {
            sourceStartTimeMs,
            sourceEndTimeMs,
            rect: this.getEventRect(target),
            reason: target.type,
        };
        console.log(`[FM] processTarget: ${target.type} → focus[${sourceStartTimeMs}-${sourceEndTimeMs}], nextSourceTime=${this.currentSourceTime}`);
        return area;
    }

    // ========================================================================
    // Rect Calculation
    // ========================================================================

    /**
     * Gets the focus rect for a target event.
     */
    private getEventRect(target: BaseEvent): Rect {
        // URL changes: full viewport (sentinel)
        if (target.type === EventType.URLCHANGE) {
            return this.fullViewportRect;
        }

        let rect: Rect;

        if (target.type === EventType.CLICK) {
            const tr = target.targetRect;
            const mp = target.mousePos;
            const mouseInRect = tr
                && mp.x >= tr.x && mp.x <= tr.x + tr.width
                && mp.y >= tr.y && mp.y <= tr.y + tr.height;

            if (mouseInRect
                && tr.width <= this.clickMaxRectSize
                && tr.height <= this.clickMaxRectSize
            ) {
                // targetRect fits within threshold and contains the mouse — use it
                rect = tr;
            } else {
                // targetRect too large, missing, or doesn't contain the mouse — box on mousePos
                const halfSize = this.clickFallbackBoxSize / 2;
                rect = {
                    x: mp.x - halfSize,
                    y: mp.y - halfSize,
                    width: this.clickFallbackBoxSize,
                    height: this.clickFallbackBoxSize,
                };
            }
        } else if (target.targetRect) {
            // Non-click events: enlarge targetRect
            rect = enlargeRect(target.targetRect, DEFAULT_ENLARGE_FACTOR);
        } else {
            console.warn('No targetRect found for event', target);
            return this.fullViewportRect;
        }

        return clampRectToBounds(rect, this.fullViewportRect);
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Checks if an event type is valid for focus area generation.
     * Keyboard and drag events are not used for focus purposes.
     */
    private isValidFocusEvent(event: BaseEvent): boolean {
        return event.type !== EventType.KEYDOWN && event.type !== EventType.MOUSEDRAG;
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extracts all focus areas from the given events.
 * Operates entirely in source time — no TimeMapper needed.
 *
 * Returns focus areas as pure measured facts:
 * - Clicks/URL changes are instants (startTime === endTime)
 * - Range events use their measured time range
 * - URL changes have rect = fullViewport (sentinel for forced zoom out)
 */
export function getAllFocusAreas(
    userEvents: UserEvents,
    sourceSize: Size,
    sourceDurationMs: number
): FocusArea[] {
    const focusManager = new FocusManager(userEvents, sourceSize, sourceDurationMs);
    const focusAreas: FocusArea[] = [];

    let focusArea = focusManager.getNextFocusArea();
    while (focusArea) {
        focusAreas.push(focusArea);
        focusArea = focusManager.getNextFocusArea();
    }

    return focusAreas;
}

import { EventType, type BaseEvent, type Rect, type Size, type UserEvents, type FocusArea } from '@shared/types';
import { HoverDetector } from './hoverDetector';
import { clampRectToBounds, enlargeRect, DEFAULT_ENLARGE_FACTOR } from '@shared/utils/geometry';

// Re-export FocusArea from types for backward compatibility
export type { FocusArea } from '@shared/types';

// ============================================================================
// Constants
// ============================================================================

/** Max size threshold — if targetRect exceeds this on either dimension, fall back to box (fraction of larger screen dimension) */
const K_CLICK_MAX_RECT_FRACTION = 0.4;

/** Fallback click box size when targetRect is too large or missing (fraction of larger screen dimension) */
const K_CLICK_FALLBACK_BOX_FRACTION = 0.10;

/** How long before a click its focus area opens, so the zoom is settled by the time the click lands */
const K_CLICK_LEAD_MS = 500;

/**
 * Quiet period after a scroll focus area ends. Scrolling zooms out, and snapping
 * straight back in on the click or hover that follows reads as a jitter — so
 * nothing is allowed to take focus for this long afterwards. Events that merely
 * *start* inside the window are dropped; a range event still running past it
 * (typing, a long hover) picks up at the window's end instead.
 */
const K_SCROLL_COOLDOWN_MS = 1000;



// ============================================================================
// Focus Manager
// ============================================================================

/**
 * FocusManager emits focus areas as pure measured facts:
 *
 * - Clicks: [clickTime - K_CLICK_LEAD_MS, clickTime]. AutoZoom decides hold duration.
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
    private readonly sortedEvents: BaseEvent[];
    private readonly fullViewportRect: Rect;
    private readonly clickFallbackBoxSize: number;
    private readonly clickMaxRectSize: number;
    private readonly hoverDetector: HoverDetector;
    private readonly sourceDuration: number;

    /** Current position in source timeline */
    private currentSourceTime: number = 0;

    /** Index into sortedEvents array */
    private sortedEventsIdx: number = 0;

    constructor(events: UserEvents, sourceSize: Size, sourceDurationMs: number) {
        this.events = events;
        this.sortedEvents = FocusManager.buildSortedEvents(events);
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

    /**
     * Builds a chronologically sorted aggregate of all non-mouse-position events.
     * This replaces the previously-persisted allEvents field on UserEvents.
     */
    private static buildSortedEvents(events: UserEvents): BaseEvent[] {
        return [
            ...events.mouseClicks,
            ...events.keyboardEvents,
            ...events.drags,
            ...events.scrolls,
            ...events.typingEvents,
            ...events.urlChanges,
            ...events.hoveredCards,
        ].sort((a, b) => a.timestamp - b.timestamp);
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Gets the next focus area after currentSourceTime.
     * Returns focus rects in order, detecting hovers between explicit events.
     * Returns null once the source is exhausted.
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
        const hover = this.hoverDetector.findNext(this.currentSourceTime, hoverTimeLimit);

        if (hover) {
            return hover;
        } else if (nextEvent) {
            this.sortedEventsIdx++; // Consume the event
            return nextEvent;
        }


        return null;
    }

    /**
     * Peeks at the next valid explicit event without consuming it.
     * Handles range events that started before currentSourceTime but are still ongoing.
     */
    private peekNextValidEvent(): BaseEvent | null {
        while (this.sortedEventsIdx < this.sortedEvents.length) {
            const event = this.sortedEvents[this.sortedEventsIdx];

            // Skip events that aren't valid for focus
            if (!this.isValidFocusEvent(event)) {
                this.sortedEventsIdx++;
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
                this.sortedEventsIdx++;
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
     * Processes a target and returns its focus area, or null once the target
     * lies beyond the end of the source.
     * FocusAreas are pure measured facts — no timing padding added.
     */
    private processTarget(target: BaseEvent): FocusArea | null {
        let sourceStartTimeMs: number;
        let sourceEndTimeMs: number;

        if (target.type === EventType.URLCHANGE) {
            // URL change: sentinel — instant, full viewport, forces zoom out
            sourceStartTimeMs = target.timestamp;
            sourceEndTimeMs = target.timestamp;
        } else if (target.type === EventType.CLICK) {
            // Click: the event itself is instantaneous — the recorder stores no
            // endTime — but the focus area covers the approach to it, opening
            // K_CLICK_LEAD_MS early so the zoom has arrived by the time the click
            // lands and closing on the click itself. Never opens earlier than the
            // previous focus area, which would break the sorted-by-time contract
            // that autoZoom and the debug overlay rely on.
            sourceStartTimeMs = Math.max(target.timestamp - K_CLICK_LEAD_MS, this.currentSourceTime);
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

        // Nothing at or past the end of the source is visible. Events can outlive
        // the source — a trimmed recording, or currentSourceTime pushed past the
        // end by the scroll cooldown — and clamping only the end would emit an
        // inverted area (start > end), breaking the sorted, non-overlapping
        // contract. Stop instead: every remaining event starts later still.
        if (sourceStartTimeMs >= this.sourceDuration) {
            return null;
        }

        // Clamp to source duration
        sourceEndTimeMs = Math.min(sourceEndTimeMs, this.sourceDuration);

        // Advance currentSourceTime past this focus area. After a scroll, push it
        // a full cooldown further so the zoom-out is allowed to settle.
        this.currentSourceTime = sourceEndTimeMs + 1
            + (target.type === EventType.SCROLL ? K_SCROLL_COOLDOWN_MS : 0);

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
 * - URL changes are instants (startTime === endTime)
 * - Clicks span the lead-in up to the click itself
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

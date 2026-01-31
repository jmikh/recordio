import { EventType, type BaseEvent, type Point } from '../types';

// ============================================================================
// Constants
// ============================================================================

/** Size of the hover detection bounding box (fraction of larger screen dimension) */
const K_HOVER_BOX_FRACTION = 0.2;

/** Minimum movement required to start a new hover (fraction of larger screen dimension) */
const K_MIN_HOVER_MOVEMENT_FRACTION = 0.075;

/** Minimum time mouse must stay in a region to be considered a hover (ms) */
const K_HOVER_MIN_DURATION_MS = 1000;

// ============================================================================
// Types
// ============================================================================

/** Accumulated bounding box during hover detection */
interface HoverBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    startPos: BaseEvent;
    lastTimestamp: number;
    /** Index of the last position that formed a valid hover (-1 if none yet) */
    bestEndIdx: number;
    /** Timestamp when the best hover ended (-1 if none yet) */
    bestEndTime: number;
}

/** Result of a successful hover detection */
interface HoverResult {
    box: HoverBox;
    endIdx: number;
    endTime: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Calculate Euclidean distance between two points */
function euclideanDistance(p1: Point, p2: Point): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================================
// Hover Detector
// ============================================================================

/**
 * Detects hover regions from a sequence of mouse positions.
 * A hover is detected when the mouse stays within a small bounding box
 * for at least K_HOVER_MIN_DURATION_MS.
 *
 * Stateful: tracks the current position index across multiple findNext() calls.
 */
export class HoverDetector {
    private readonly positions: BaseEvent[];
    private readonly hoverBoxSize: number;
    private readonly minMovement: number;

    /** Current search position in the positions array */
    private currentIdx: number = 0;

    constructor(positions: BaseEvent[], largerDimension: number) {
        this.positions = positions;
        this.hoverBoxSize = largerDimension * K_HOVER_BOX_FRACTION;
        this.minMovement = largerDimension * K_MIN_HOVER_MOVEMENT_FRACTION;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Finds the next hover starting at or after minTime, ending before timeLimit.
     * @param minTime - Don't return hovers that start before this time
     * @param timeLimit - Don't search past this time (usually the next explicit event)
     * @returns A hover event with targetRect, or null if no valid hover found
     */
    public findNext(minTime: number, timeLimit: number): BaseEvent | null {
        while (this.currentIdx < this.positions.length) {
            const startPos = this.positions[this.currentIdx];

            // Skip positions before minTime
            if (startPos.timestamp < minTime) {
                this.currentIdx++;
                continue;
            }

            // Stop if we've reached the time limit
            if (startPos.timestamp >= timeLimit) {
                break;
            }

            // Check if this position qualifies as a hover start
            if (!this.canStartHoverAt(this.currentIdx)) {
                this.currentIdx++;
                continue;
            }

            // Try to build a hover box starting at this position
            const result = this.tryBuildHoverBox(this.currentIdx, startPos, timeLimit);

            if (result) {
                // Found a valid hover - advance past it
                this.currentIdx = result.endIdx + 1;
                return this.createHoverEvent(result.box, result.endTime);
            }

            this.currentIdx++;
        }

        return null;
    }

    /**
     * Advances the current position index past the given time.
     * Used after processing a target to skip mouse positions covered by that target.
     */
    public advancePast(time: number): void {
        while (this.currentIdx < this.positions.length) {
            if (this.positions[this.currentIdx].timestamp > time) {
                break;
            }
            this.currentIdx++;
        }
    }

    // ========================================================================
    // Hover Start Validation
    // ========================================================================

    /**
     * Checks if we can start a hover at the given index.
     * Requires minimum movement from the previous position to prevent
     * detecting "hovers" when the mouse hasn't actually moved.
     */
    private canStartHoverAt(idx: number): boolean {
        if (idx === 0) {
            return true; // First position can always start a hover
        }

        const startPos = this.positions[idx];
        const prevPos = this.positions[idx - 1];

        const distance = euclideanDistance(startPos.mousePos, prevPos.mousePos);
        return distance >= this.minMovement;
    }

    // ========================================================================
    // Hover Box Building
    // ========================================================================

    /**
     * Attempts to build a hover bounding box starting at the given position.
     * Expands the box as long as positions stay within hoverBoxSize.
     */
    private tryBuildHoverBox(
        startIdx: number,
        startPos: BaseEvent,
        timeLimit: number
    ): HoverResult | null {
        // Initialize bounding box at start position
        const box: HoverBox = {
            minX: startPos.mousePos.x,
            maxX: startPos.mousePos.x,
            minY: startPos.mousePos.y,
            maxY: startPos.mousePos.y,
            startPos,
            lastTimestamp: startPos.timestamp,
            bestEndIdx: -1,
            bestEndTime: -1,
        };

        let j = startIdx;

        // Expand box while positions stay within bounds
        while (j < this.positions.length) {
            const pos = this.positions[j];

            // Check for gap between consecutive points (breaks hover sequence)
            const gapFromPrev = pos.timestamp - box.lastTimestamp;
            if (gapFromPrev > K_HOVER_MIN_DURATION_MS) {
                break;
            }

            // Stop if we cross the time limit
            if (pos.timestamp >= timeLimit) {
                break;
            }

            // Try to expand the box with this position
            if (!this.tryExpandBox(box, pos)) {
                break; // Position broke the box
            }

            // Update best hover if duration threshold is met
            const duration = pos.timestamp - startPos.timestamp;
            if (duration >= K_HOVER_MIN_DURATION_MS) {
                box.bestEndIdx = j;
                box.bestEndTime = pos.timestamp;
            }

            box.lastTimestamp = pos.timestamp;
            j++;
        }

        // Calculate effective end time: mouse stays at last position until next movement
        // This handles the case where mouse enters a box, stays, then moves away
        const effectiveEndTime = this.calculateEffectiveEndTime(j, timeLimit);

        if (effectiveEndTime !== null) {
            const effectiveDuration = effectiveEndTime - startPos.timestamp;
            if (effectiveDuration >= K_HOVER_MIN_DURATION_MS) {
                if (box.bestEndIdx === -1 || effectiveEndTime > box.bestEndTime) {
                    box.bestEndIdx = j > startIdx ? j - 1 : startIdx;
                    box.bestEndTime = effectiveEndTime;
                }
            }
        }

        // Return result if we found a valid hover
        if (box.bestEndIdx !== -1 && box.bestEndTime !== -1) {
            return { box, endIdx: box.bestEndIdx, endTime: box.bestEndTime };
        }

        return null;
    }

    /**
     * Tries to expand the hover box to include a new position.
     * @returns true if the position fits within the box size, false otherwise
     */
    private tryExpandBox(box: HoverBox, pos: BaseEvent): boolean {
        const p = pos.mousePos;
        const newMinX = Math.min(box.minX, p.x);
        const newMaxX = Math.max(box.maxX, p.x);
        const newMinY = Math.min(box.minY, p.y);
        const newMaxY = Math.max(box.maxY, p.y);

        const width = newMaxX - newMinX;
        const height = newMaxY - newMinY;

        if (width <= this.hoverBoxSize && height <= this.hoverBoxSize) {
            box.minX = newMinX;
            box.maxX = newMaxX;
            box.minY = newMinY;
            box.maxY = newMaxY;
            return true;
        }

        return false;
    }

    // ========================================================================
    // Effective End Time
    // ========================================================================

    /**
     * Calculates the effective end time for a hover.
     * The mouse stays at its last recorded position until the next movement occurs.
     */
    private calculateEffectiveEndTime(nextIdx: number, timeLimit: number): number | null {
        if (nextIdx < this.positions.length && this.positions[nextIdx].timestamp < timeLimit) {
            // Next movement occurred before timeLimit
            return this.positions[nextIdx].timestamp;
        } else if (timeLimit !== Number.POSITIVE_INFINITY) {
            // No next movement before timeLimit - extend to timeLimit
            return timeLimit;
        }

        return null;
    }

    // ========================================================================
    // Hover Event Creation
    // ========================================================================

    /**
     * Creates a hover event from a completed hover box.
     */
    private createHoverEvent(box: HoverBox, endTime: number): BaseEvent {
        return {
            type: EventType.HOVER,
            timestamp: box.startPos.timestamp,
            endTime,
            mousePos: {
                x: (box.minX + box.maxX) / 2,
                y: (box.minY + box.maxY) / 2,
            },
            targetRect: {
                x: box.minX,
                y: box.minY,
                width: box.maxX - box.minX,
                height: box.maxY - box.minY,
            },
        };
    }
}

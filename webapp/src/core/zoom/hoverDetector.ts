import { EventType, type BaseEvent, type Point } from '../../types';

// ============================================================================
// Constants
// ============================================================================

/** Radius of the hover detection circle (fraction of larger screen dimension) */
const K_HOVER_RADIUS_FRACTION = 0.1;

/** Minimum time mouse must stay in a region to be considered a hover (ms) */
const K_HOVER_MIN_DURATION_MS = 1000;

/** Maximum time gap between consecutive positions before breaking a hover (ms) */
const K_MAX_GAP_MS = 1000;

/** Minimum total path distance within the circle to count as "active" (fraction of larger screen dimension) */
const K_MIN_ACTIVITY_FRACTION = 0.1;

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
 * Detects hover regions from a sequence of mouse positions using a
 * circle-anchored sliding scan.
 *
 * Algorithm (O(N)):
 * 1. Pick a position as the anchor (center of a detection circle)
 * 2. Scan forward, accumulating positions that stay within radius R of the anchor
 * 3. Track duration and total path distance (activity)
 * 4. When a position leaves the circle (or there's a time gap):
 *    - If duration ≥ 1s AND path distance ≥ minActivity → emit hover
 *    - Advance to the break point (never backtrack)
 *
 * Each position is visited at most twice (outer loop + inner expansion),
 * guaranteeing O(N) time complexity.
 */
export class HoverDetector {
    private readonly positions: BaseEvent[];
    private readonly radius: number;
    private readonly minActivity: number;

    /** Current search position in the positions array */
    private currentIdx: number = 0;

    constructor(positions: BaseEvent[], largerDimension: number) {
        this.positions = positions;
        this.radius = largerDimension * K_HOVER_RADIUS_FRACTION;
        this.minActivity = largerDimension * K_MIN_ACTIVITY_FRACTION;
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

        // Skip positions before minTime
        while (this.currentIdx < this.positions.length && this.positions[this.currentIdx].timestamp < minTime) {
            this.currentIdx++;
        }

        while (this.currentIdx < this.positions.length) {
            const anchor = this.positions[this.currentIdx];

            // Stop if we've passed the time limit
            if (anchor.timestamp >= timeLimit) {
                break;
            }

            // Try to build a hover circle from this anchor
            const result = this.scanCircle(this.currentIdx, anchor, timeLimit);

            if (result) {
                this.currentIdx = result.breakIdx;
                return this.createHoverEvent(anchor, result);
            }

            // Failed — advance by 1 and try the next position as anchor
            this.currentIdx++;
        }


        return null;
    }

    /**
     * Advances the current position index past the given time.
     * Used after processing an explicit event to skip mouse positions covered by it.
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
    // Circle Scan
    // ========================================================================

    /** Result of a circle scan */
    private scanCircle(
        startIdx: number,
        anchor: BaseEvent,
        timeLimit: number
    ): {
        endIdx: number;     // Last index inside the circle
        endTime: number;    // End time of the hover
        breakIdx: number;   // Index to resume scanning from (position that broke the circle)
        pathDistance: number;
        centerX: number;
        centerY: number;
        minX: number; maxX: number;
        minY: number; maxY: number;
    } | null {
        const anchorPoint = anchor.mousePos;
        let pathDistance = 0;
        let lastIdx = startIdx;
        let lastTimestamp = anchor.timestamp;

        // Track bounding box for the hover event rect
        let minX = anchorPoint.x, maxX = anchorPoint.x;
        let minY = anchorPoint.y, maxY = anchorPoint.y;

        let j = startIdx + 1;

        while (j < this.positions.length) {
            const pos = this.positions[j];

            // Time gap too large — break
            if (pos.timestamp - lastTimestamp > K_MAX_GAP_MS) {
                break;
            }

            // Past time limit — break
            if (pos.timestamp >= timeLimit) {
                break;
            }

            // Check if position is within radius of anchor
            const dist = euclideanDistance(pos.mousePos, anchorPoint);
            if (dist > this.radius) {
                break; // Left the circle
            }

            // Accumulate path distance (activity)
            const prevPos = this.positions[j - 1];
            pathDistance += euclideanDistance(pos.mousePos, prevPos.mousePos);

            // Update bounding box
            minX = Math.min(minX, pos.mousePos.x);
            maxX = Math.max(maxX, pos.mousePos.x);
            minY = Math.min(minY, pos.mousePos.y);
            maxY = Math.max(maxY, pos.mousePos.y);

            lastIdx = j;
            lastTimestamp = pos.timestamp;
            j++;
        }

        // Calculate effective end time: extend to when mouse actually left
        let endTime = lastTimestamp;
        if (j < this.positions.length && this.positions[j].timestamp < timeLimit) {
            endTime = this.positions[j].timestamp; // Mouse continued — use next position's time
        } else if (timeLimit < Infinity) {
            endTime = timeLimit; // No next position before limit — extend to limit
        }

        const duration = endTime - anchor.timestamp;

        // Validate: sufficient duration and activity
        if (duration >= K_HOVER_MIN_DURATION_MS && pathDistance >= this.minActivity) {
            return {
                endIdx: lastIdx,
                endTime,
                breakIdx: j, // Resume from position that broke the circle
                pathDistance,
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2,
                minX, maxX, minY, maxY,
            };
        }

        // Not valid — still return breakIdx so caller can skip ahead
        // But we need to signal failure. Use a convention:
        // If j > startIdx + 1, we scanned multiple positions — skip to j
        // If j === startIdx + 1, just advance by 1
        return null;
    }

    // ========================================================================
    // Hover Event Creation
    // ========================================================================

    /**
     * Creates a hover event from a successful circle scan.
     */
    private createHoverEvent(
        anchor: BaseEvent,
        result: {
            endTime: number;
            centerX: number; centerY: number;
            minX: number; maxX: number;
            minY: number; maxY: number;
        }
    ): BaseEvent {
        return {
            type: EventType.HOVER,
            timestamp: anchor.timestamp,
            endTime: result.endTime,
            mousePos: {
                x: result.centerX,
                y: result.centerY,
            },
            targetRect: {
                x: result.minX,
                y: result.minY,
                width: result.maxX - result.minX,
                height: result.maxY - result.minY,
            },
        };
    }
}

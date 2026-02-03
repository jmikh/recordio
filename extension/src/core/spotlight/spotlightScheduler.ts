/**
 * Spotlight Scheduler
 * 
 * Calculates automatic spotlight actions based on hovered card events.
 * Spotlights highlight UI elements that the user hovered over for extended periods.
 */

import type { HoveredCardEvent, ZoomAction, SpotlightAction, Rect, Size } from '../types';
import { ViewMapper } from '../mappers/viewMapper';
import { getViewportStateAtTime } from '../zoom';
import { TimeMapper } from '../mappers/timeMapper';

// ============================================================================
// Constants
// ============================================================================

/** Minimum output duration (ms) for a hovered card to qualify for an auto-spotlight */
const K_MIN_SPOTLIGHT_DURATION_MS = 3000;

/** Buffer (ms) to trim from spotlight start and end to avoid edge effects */
const K_SPOTLIGHT_BUFFER_MS = 250;

/** Safety margin fraction for viewport bounds (2%) */
const K_VIEWPORT_MARGIN = 0.98;

// ============================================================================
// Spotlight Scheduler Class
// ============================================================================

/**
 * SpotlightScheduler calculates automatic spotlight actions from hovered card events.
 * 
 * It processes each hovered card to determine:
 * - Whether it qualifies based on duration and viewport containment
 * - The appropriate scale factor based on available space
 * 
 * NOTE: This class is internal. Use calculateAutoSpotlights() instead.
 */
class SpotlightScheduler {
    private readonly viewMapper: ViewMapper;
    private readonly timeMapper: TimeMapper;
    private readonly zoomActions: ZoomAction[];
    private readonly enlargeScale: number;
    private readonly outputSize: Size;

    constructor(
        viewMapper: ViewMapper,
        timeMapper: TimeMapper,
        zoomActions: ZoomAction[],
        enlargeScale: number
    ) {
        this.viewMapper = viewMapper;
        this.timeMapper = timeMapper;
        this.zoomActions = zoomActions;
        this.enlargeScale = enlargeScale;
        this.outputSize = viewMapper.outputVideoSize;
    }

    /**
     * Process all hovered cards and generate spotlight actions.
     */
    processCards(hoveredCards: HoveredCardEvent[]): SpotlightAction[] {
        console.log('[AutoSpotlight] Starting calculation...');
        console.log('[AutoSpotlight] Input:', {
            hoveredCardsCount: hoveredCards.length,
            zoomActionsCount: this.zoomActions.length,
            outputSize: this.outputSize,
            sourceSize: this.viewMapper.inputVideoSize,
            enlargeScale: this.enlargeScale
        });

        const spotlights: SpotlightAction[] = [];

        for (let i = 0; i < hoveredCards.length; i++) {
            const spotlight = this.processCard(hoveredCards[i], i);
            if (spotlight) {
                spotlights.push(spotlight);
            }
        }

        // Note: hoveredCards are already sorted by timestamp, so spotlights are naturally sorted
        console.log('[AutoSpotlight] Result:', { generated: spotlights.length });
        return spotlights;
    }

    /**
     * Process a single hovered card and return a spotlight action if it qualifies.
     */
    private processCard(card: HoveredCardEvent, index: number): SpotlightAction | null {
        // Map time range to output coordinates
        const outputRange = this.timeMapper.mapSourceRangeToOutputRange(card.timestamp, card.endTime);
        if (!outputRange) {
            console.log(`[AutoSpotlight] Card ${index}: SKIPPED - not visible in output (trimmed)`);
            return null;
        }

        // Check minimum duration
        const outputDuration = outputRange.end - outputRange.start;
        if (outputDuration < K_MIN_SPOTLIGHT_DURATION_MS) {
            console.log(`[AutoSpotlight] Card ${index}: SKIPPED - duration ${outputDuration}ms < ${K_MIN_SPOTLIGHT_DURATION_MS}ms threshold`);
            return null;
        }

        // Calculate the effective time range with buffers
        const spotlightStartMs = outputRange.start + K_SPOTLIGHT_BUFFER_MS;
        const spotlightEndMs = outputRange.end - K_SPOTLIGHT_BUFFER_MS;

        // Get all viewports during the spotlight duration
        const viewports = this.getViewportsForTimeRange(spotlightStartMs, spotlightEndMs);

        // Transform target rect to output coordinates
        const outputTargetRect = this.viewMapper.inputToOutputRect(card.targetRect);

        // Calculate scale factor from source to output (for corner radius conversion)
        // Use average of X and Y scale since radii are uniform
        const scaleX = outputTargetRect.width / card.targetRect.width;
        const scaleY = outputTargetRect.height / card.targetRect.height;
        const radiusScale = (scaleX + scaleY) / 2;

        // Convert corner radii from source to output coordinates
        const outputCornerRadii: [number, number, number, number] = [
            card.cornerRadius[0] * radiusScale,
            card.cornerRadius[1] * radiusScale,
            card.cornerRadius[2] * radiusScale,
            card.cornerRadius[3] * radiusScale,
        ];

        // Check containment in all viewports
        if (!this.fitsInAllViewports(outputTargetRect, viewports, card, index, outputDuration)) {
            return null;
        }

        // Calculate the viewport intersection bounds
        const bounds = this.calculateViewportIntersection(viewports);

        // Calculate the maximum scale that fits within bounds
        const maxFitScale = this.calculateMaxScale(outputTargetRect, bounds);
        const scale = Math.min(this.enlargeScale, maxFitScale);

        // Create the spotlight action (borderRadius now in OUTPUT coordinates)
        const spotlight: SpotlightAction = {
            id: crypto.randomUUID(),
            outputStartTimeMs: spotlightStartMs,
            outputEndTimeMs: spotlightEndMs,
            sourceRect: card.targetRect,
            borderRadius: outputCornerRadii,
            scale,
            reason: 'hoveredCard'
        };

        console.log(`[AutoSpotlight] Card ${index}: CREATED spotlight`, {
            duration: outputDuration,
            outputRange,
            targetRect: card.targetRect,
            scale,
            maxFitScale
        });

        return spotlight;
    }

    /**
     * Get all viewports that need to be checked during a spotlight's time range.
     * Includes viewports at start, end, and any zoom transitions in between.
     */
    private getViewportsForTimeRange(startMs: number, endMs: number): Rect[] {
        const viewports: Rect[] = [];

        // Viewport at start
        viewports.push(getViewportStateAtTime(this.zoomActions, startMs, this.outputSize));

        // Viewport at end
        viewports.push(getViewportStateAtTime(this.zoomActions, endMs, this.outputSize));

        // Viewports at any zoom action start times within the range
        for (const action of this.zoomActions) {
            const actionStartMs = action.outputEndTimeMs - action.durationMs;
            if (actionStartMs > startMs && actionStartMs < endMs) {
                viewports.push(getViewportStateAtTime(this.zoomActions, actionStartMs, this.outputSize));
            }
        }

        return viewports;
    }

    /**
     * Check if a rect fits within all given viewports.
     */
    private fitsInAllViewports(
        rect: Rect,
        viewports: Rect[],
        card: HoveredCardEvent,
        index: number,
        outputDuration: number
    ): boolean {
        for (const viewport of viewports) {
            if (!this.isRectContained(rect, viewport)) {
                console.log(`[AutoSpotlight] Card ${index}: SKIPPED - does not fit in viewport at some point`, {
                    targetRect: card.targetRect,
                    outputTargetRect: rect,
                    failingViewport: viewport,
                    outputDuration
                });
                return false;
            }
        }
        return true;
    }

    /**
     * Calculate the intersection bounds of all viewports.
     * Returns the smallest rectangle that fits within all viewports.
     */
    private calculateViewportIntersection(viewports: Rect[]): {
        minLeft: number;
        minTop: number;
        maxRight: number;
        maxBottom: number;
    } {
        let minLeft = -Infinity;
        let minTop = -Infinity;
        let maxRight = Infinity;
        let maxBottom = Infinity;

        for (const viewport of viewports) {
            minLeft = Math.max(minLeft, viewport.x);
            minTop = Math.max(minTop, viewport.y);
            maxRight = Math.min(maxRight, viewport.x + viewport.width);
            maxBottom = Math.min(maxBottom, viewport.y + viewport.height);
        }

        return { minLeft, minTop, maxRight, maxBottom };
    }

    /**
     * Calculate the maximum scale factor that keeps the spotlight within bounds.
     * Accounts for the spotlight's position - spotlights near edges have less room to expand.
     */
    private calculateMaxScale(
        rect: Rect,
        bounds: { minLeft: number; minTop: number; maxRight: number; maxBottom: number }
    ): number {
        const { minLeft, minTop, maxRight, maxBottom } = bounds;

        // Spotlight center
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;

        // Available space on each side (with safety margin)
        const spaceLeft = (centerX - minLeft) * K_VIEWPORT_MARGIN;
        const spaceRight = (maxRight - centerX) * K_VIEWPORT_MARGIN;
        const spaceTop = (centerY - minTop) * K_VIEWPORT_MARGIN;
        const spaceBottom = (maxBottom - centerY) * K_VIEWPORT_MARGIN;

        // Max scale is limited by the side with least space
        // When scaled by S, half-dimension becomes (dimension * S) / 2
        // So S <= 2 * availableSpace / dimension
        const maxScaleLeft = (2 * spaceLeft) / rect.width;
        const maxScaleRight = (2 * spaceRight) / rect.width;
        const maxScaleTop = (2 * spaceTop) / rect.height;
        const maxScaleBottom = (2 * spaceBottom) / rect.height;

        return Math.min(maxScaleLeft, maxScaleRight, maxScaleTop, maxScaleBottom);
    }

    /**
     * Checks if a rectangle is fully contained within another rectangle.
     */
    private isRectContained(inner: Rect, outer: Rect): boolean {
        return (
            inner.x >= outer.x &&
            inner.y >= outer.y &&
            inner.x + inner.width <= outer.x + outer.width &&
            inner.y + inner.height <= outer.y + outer.height
        );
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Calculates auto-spotlight actions based on hovered card events.
 * 
 * NOTE: Caller is responsible for checking isAuto before calling this function.
 * 
 * Logic:
 * 1. For each hoveredCard event, map its time range to output coordinates
 * 2. Filter for events with output duration > 3000ms
 * 3. Check if the hovered card's targetRect fits within 
 *    the current zoom viewport at that output time (output coords)
 * 4. If it fits, create a SpotlightAction for that duration
 * 
 * @param viewMapper - ViewMapper for source to output coordinate transformation
 * @param timeMapper - TimeMapper for source to output time mapping
 * @param hoveredCards - Array of hovered card events to process
 * @param zoomActions - The zoom actions to check visibility against
 * @param enlargeScale - Settings scale factor for spotlights
 * @returns Array of auto-generated SpotlightActions
 */
export const calculateAutoSpotlights = (
    viewMapper: ViewMapper,
    timeMapper: TimeMapper,
    hoveredCards: HoveredCardEvent[],
    zoomActions: ZoomAction[],
    enlargeScale: number
): SpotlightAction[] => {
    const scheduler = new SpotlightScheduler(viewMapper, timeMapper, zoomActions, enlargeScale);
    return scheduler.processCards(hoveredCards);
};

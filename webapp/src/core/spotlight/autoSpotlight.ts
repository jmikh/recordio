/**
 * Spotlight Scheduler
 * 
 * Calculates automatic spotlight actions based on hovered card events.
 * Spotlights highlight UI elements that the user hovered over for extended periods.
 */

import type { HoveredCardEvent, ZoomSegment, SpotlightSegment, SpotlightSettings, Rect, Size, ZoomSettings } from '@shared/types';
import { ViewMapper } from '@shared/mappers/viewMapper';
import { getViewportStateAtTime } from '../zoom';
import { TimeMapper } from '@shared/mappers/timeMapper';

// ============================================================================
// Constants
// ============================================================================

/** Buffer (ms) to trim from spotlight start and end to avoid edge effects */
export const K_SPOTLIGHT_BUFFER_MS = 250;

/** Minimum spotlight duration (ms) */
export const K_MIN_AUTO_SPOTLIGHT_DURATION_MS = 2500;

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
    private readonly zoomSegments: ZoomSegment[];
    private readonly zoomSettings: ZoomSettings;
    private readonly spotlightSettings: SpotlightSettings;
    private readonly enlargeScale: number;
    private readonly outputSize: Size;

    constructor(
        viewMapper: ViewMapper,
        timeMapper: TimeMapper,
        zoomSegments: ZoomSegment[],
        zoomSettings: ZoomSettings,
        spotlightSettings: SpotlightSettings
    ) {
        this.viewMapper = viewMapper;
        this.timeMapper = timeMapper;
        this.zoomSegments = zoomSegments;
        this.zoomSettings = zoomSettings;
        this.spotlightSettings = spotlightSettings;
        this.enlargeScale = spotlightSettings.enlargeScale;
        this.outputSize = viewMapper.outputSize;
    }

    /**
     * Process all hovered cards and generate spotlight actions.
     */
    processCards(hoveredCards: HoveredCardEvent[]): SpotlightSegment[] {

        const spotlights: SpotlightSegment[] = [];

        for (let i = 0; i < hoveredCards.length; i++) {
            const spotlight = this.processCard(hoveredCards[i], i);
            if (spotlight) {
                spotlights.push(spotlight);
            }
        }

        // Note: hoveredCards are already sorted by timestamp, so spotlights are naturally sorted

        return spotlights;
    }

    /**
     * Process a single hovered card and return a spotlight action if it qualifies.
     */
    private processCard(card: HoveredCardEvent, index: number): SpotlightSegment | null {
        // Map time range to output coordinates using cached fields
        const outputRange = this.timeMapper.mapSourceRangeToOutputRange(card.timestamp, card.endTime);
        if (!outputRange) {

            return null;
        }

        // Check minimum duration
        const outputDuration = outputRange.end - outputRange.start;
        if (outputDuration < K_MIN_AUTO_SPOTLIGHT_DURATION_MS) {

            return null;
        }

        // Calculate the effective time range with buffers (in source time)
        const spotlightSourceStartMs = card.timestamp + K_SPOTLIGHT_BUFFER_MS;
        const spotlightSourceEndMs = card.endTime - K_SPOTLIGHT_BUFFER_MS;

        // Re-map the buffered range to output for viewport checks
        const bufferedOutputRange = this.timeMapper.mapSourceRangeToOutputRange(spotlightSourceStartMs, spotlightSourceEndMs);
        if (!bufferedOutputRange) {

            return null;
        }

        // Get all viewports during the spotlight duration (in output time)
        const viewports = this.getViewportsForTimeRange(bufferedOutputRange.start, bufferedOutputRange.end);

        // Transform target rect to output coordinates
        const outputTargetRect = this.viewMapper.eventToOutputRect(card.targetRect);

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

        // Create the spotlight action with SOURCE times
        const spotlight: SpotlightSegment = {
            id: crypto.randomUUID(),
            sourceStartTimeMs: spotlightSourceStartMs,
            sourceEndTimeMs: spotlightSourceEndMs,
            outputStartTimeMs: bufferedOutputRange.start,
            outputEndTimeMs: bufferedOutputRange.end,
            visible: true,
            sourceRect: card.targetRect,
            borderRadiusPx: outputCornerRadii,
            scale,
            reason: 'hoveredCard',
            dimOpacity: this.spotlightSettings.dimOpacity,
            transitionDurationMs: this.spotlightSettings.transitionDurationMs,
            easing: this.spotlightSettings.easing,
        };



        return spotlight;
    }

    /**
     * Get all viewports that need to be checked during a spotlight's time range.
     * Includes viewports at start, end, and any zoom transitions in between.
     */
    private getViewportsForTimeRange(startMs: number, endMs: number): Rect[] {
        const viewports: Rect[] = [];

        // Viewport at start
        viewports.push(getViewportStateAtTime(this.zoomSegments, startMs, this.outputSize, this.zoomSettings));

        // Viewport at end
        viewports.push(getViewportStateAtTime(this.zoomSegments, endMs, this.outputSize, this.zoomSettings));

        // Viewports at any zoom action start times within the range
        for (const s of this.zoomSegments) {
            if (!s.visible) continue;
            const actionStartMs = s.outputStartTimeMs;
            if (actionStartMs > startMs && actionStartMs < endMs) {
                viewports.push(getViewportStateAtTime(this.zoomSegments, actionStartMs, this.outputSize, this.zoomSettings));
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
 *
 * 
 * Logic:
 * 1. For each hoveredCard event, map its time range to output coordinates
 * 2. Filter for events with output duration > 3000ms
 * 3. Check if the hovered card's targetRect fits within 
 *    the current zoom viewport at that output time (output coords)
 * 4. If it fits, create a SpotlightSegment for that duration
 * 
 * @param viewMapper - ViewMapper for source to output coordinate transformation
 * @param timeMapper - TimeMapper for source to output time mapping
 * @param hoveredCards - Array of hovered card events to process
 * @param zoomSegments - The zoom actions to check visibility against
 * @param enlargeScale - Settings scale factor for spotlights
 * @returns Array of auto-generated SpotlightSegments
 */
export const calculateAutoSpotlights = (
    viewMapper: ViewMapper,
    timeMapper: TimeMapper,
    hoveredCards: HoveredCardEvent[],
    zoomSegments: ZoomSegment[],
    zoomSettings: ZoomSettings,
    spotlightSettings: SpotlightSettings
): SpotlightSegment[] => {
    const scheduler = new SpotlightScheduler(viewMapper, timeMapper, zoomSegments, zoomSettings, spotlightSettings);
    return scheduler.processCards(hoveredCards);
};

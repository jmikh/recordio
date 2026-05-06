/**
 * Zoom Bounds Calculation
 * 
 * Computes the intersection of all zoom viewports that are active during
 * a given output-time range. Used by the Spotlight Editor to show a
 * "ZoomBounds" indicator — the region where the spotlight will actually
 * be visible after zoom/pan effects are applied.
 * 
 * All rectangles are in OUTPUT coordinates.
 */

import type { ZoomSegment, Size, Rect, ZoomSettings } from '@shared/types';
import { getViewportStateAtTime } from '@shared/animators/zoomAnimator';
import { getIntersection } from '@shared/utils/geometry';

/**
 * Returns the intersection of all zoom viewports during [outputStartMs, outputEndMs].
 * 
 * Strategy:
 * 1. Sample the viewport at the range start and end.
 * 2. For every zoom segment that overlaps the range, also sample at its
 *    boundary times (clamped to the range) and include its held rectPx.
 * 3. Intersect all collected rects.
 * 
 * Returns null if there are no zooms in range (viewport = full output the
 * entire time). Returns a zero-size rect if the intersection collapses
 * (zooms target incompatible areas) so the caller can show a warning.
 */
export function getZoomBoundsForRange(
    zoomSegments: ZoomSegment[],
    outputStartMs: number,
    outputEndMs: number,
    outputSize: Size,
    zoomSettings: ZoomSettings,
): Rect | null {
    const fullRect: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    const visibleSegments = zoomSegments.filter(s => s.visible);
    if (visibleSegments.length === 0) return null;

    // Collect sample times — deduplicated via Set, then sorted
    const sampleTimes = new Set<number>();
    sampleTimes.add(outputStartMs);
    sampleTimes.add(outputEndMs);

    const rects: Rect[] = [];

    for (const seg of visibleSegments) {
        const segStart = seg.outputStartTimeMs;
        const segEnd = seg.outputEndTimeMs;

        // Include transition spillover: zoom-in can start at segStart and zoom-out
        // continues for transitionDurationMs after segEnd
        const T = seg.transitionDurationMs ?? zoomSettings.transitionDurationMs;
        const effectiveEnd = segEnd + T;

        // Skip segments that don't overlap the spotlight range at all
        if (effectiveEnd <= outputStartMs || segStart >= outputEndMs) continue;

        // Clamp segment boundaries to our range and add as sample points
        if (segStart > outputStartMs && segStart < outputEndMs) {
            sampleTimes.add(segStart);
        }
        if (segEnd > outputStartMs && segEnd < outputEndMs) {
            sampleTimes.add(segEnd);
        }

        // If the segment is fully inside our range, include its held rect directly
        if (segStart >= outputStartMs && segEnd <= outputEndMs) {
            rects.push(seg.rectPx);
        }
    }

    // Sample the viewport at each collected time
    for (const t of sampleTimes) {
        const viewport = getViewportStateAtTime(visibleSegments, t, outputSize, zoomSettings);
        rects.push(viewport);
    }

    // If every sampled rect is the full viewport, there's no effective zoom — skip
    const isFullRect = (r: Rect) =>
        Math.abs(r.x) < 1 &&
        Math.abs(r.y) < 1 &&
        Math.abs(r.width - outputSize.width) < 1 &&
        Math.abs(r.height - outputSize.height) < 1;

    if (rects.every(isFullRect)) return null;

    // Intersect all rects
    let bounds: Rect | null = rects[0];
    for (let i = 1; i < rects.length; i++) {
        bounds = getIntersection(bounds!, rects[i]);
        if (!bounds) {
            // Intersection collapsed — zooms target incompatible areas.
            // Return a zero-size rect so the caller can show a warning
            // (rather than null, which means "no zoom effects at all").
            return { x: 0, y: 0, width: 0, height: 0 };
        }
    }

    // If the intersection equals the full viewport, no useful indication
    if (bounds && isFullRect(bounds)) return null;

    return bounds;
}

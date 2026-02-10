import type { SpotlightAction, SpotlightSettings, Rect } from '../../types';
import { ViewMapper } from '../mappers/viewMapper';
import { TimeMapper } from '../mappers/timeMapper';
import { scaleRectFromCenter, clampRectToBounds } from '../geometry';
import { applyEasing } from '../easing';
import { getMinSpotlightDuration } from '../../editor/components/timeline/spotlight/SpotlightTrackUtils';

// ============================================================================
// Spotlight State
// ============================================================================

/**
 * Represents the current animated state of a spotlight at a given time.
 */
export interface SpotlightState {
    /** Whether the spotlight region is visible in the current viewport */
    isVisible: boolean;
    /** The original spotlight rectangle in OUTPUT coordinates (for dim overlay cut-out). Null if not visible. */
    originalRect: Rect | null;
    /** The scaled spotlight rectangle in OUTPUT coordinates (for enlarged content clipping). Null if not visible. */
    scaledRect: Rect | null;
    /** The source rectangle (in source video coordinates) */
    sourceRect: Rect;
    /** Border radius in pixels for each corner [topLeft, topRight, bottomRight, bottomLeft] (in OUTPUT coordinates) */
    borderRadius: [number, number, number, number];
    /** Current animated dim value (0 to settings.dimOpacity) */
    dimOpacity: number;
    /** Current animated scale (1.0 to settings.enlargeScale) */
    scale: number;
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Calculates the spotlight state at a specific output time.
 * 
 * Spotlights are stored in SOURCE time. They are resolved to output time
 * via TimeMapper at render time (same pattern as zooms).
 * 
 * Animation phases:
 * 1. Before outputStartTimeMs: null (no spotlight)
 * 2. Fade in: outputStartTimeMs to outputStartTimeMs + transitionDurationMs
 * 3. Hold: between fade in and fade out
 * 4. Fade out: outputEndTimeMs - transitionDurationMs to outputEndTimeMs
 * 5. After outputEndTimeMs: null (spotlight ended)
 */
export function getSpotlightStateAtTime(
    spotlightActions: SpotlightAction[],
    settings: SpotlightSettings,
    outputTimeMs: number,
    viewport: Rect,
    viewMapper: ViewMapper,
    timeMapper: TimeMapper
): SpotlightState | null {
    if (!spotlightActions || spotlightActions.length === 0) {
        return null;
    }

    // Find the active spotlight at this time by resolving source → output
    let activeSpotlight: SpotlightAction | null = null;
    let resolvedStart = 0;
    let resolvedEnd = 0;

    for (const s of spotlightActions) {
        const range = timeMapper.mapSourceRangeToOutputRange(s.sourceStartTimeMs, s.sourceEndTimeMs);
        if (!range) continue;

        // Skip spotlights below minimum visible duration
        if (range.end - range.start < getMinSpotlightDuration(settings.transitionDurationMs)) continue;

        if (outputTimeMs >= range.start && outputTimeMs <= range.end) {
            activeSpotlight = s;
            resolvedStart = range.start;
            resolvedEnd = range.end;
            break;
        }
    }

    if (!activeSpotlight) {
        return null;
    }

    // Calculate animation progress
    const { sourceRect, borderRadius, scale: spotlightScale } = activeSpotlight;
    const { transitionDurationMs, dimOpacity } = settings;

    const elapsed = outputTimeMs - resolvedStart;
    const remaining = resolvedEnd - outputTimeMs;

    let animationProgress: number;

    // Determine which phase we're in
    if (elapsed < transitionDurationMs) {
        // Phase 2: Fade in
        animationProgress = elapsed / transitionDurationMs;
    } else if (remaining < transitionDurationMs) {
        // Phase 4: Fade out
        animationProgress = remaining / transitionDurationMs;
    } else {
        // Phase 3: Hold at full effect
        animationProgress = 1.0;
    }

    // Apply easing (ease-in-out)
    const easedProgress = applyEasing(animationProgress, settings.easing ?? 'ease-in-out');

    // Interpolate values
    const currentDimOpacity = dimOpacity * easedProgress;
    const currentScale = 1.0 + (spotlightScale - 1.0) * easedProgress;

    // Map source rect to screen (output) coordinates using the viewport
    const topLeftScreen = viewMapper.projectToScreen({ x: sourceRect.x, y: sourceRect.y }, viewport);
    const bottomRightScreen = viewMapper.projectToScreen(
        { x: sourceRect.x + sourceRect.width, y: sourceRect.y + sourceRect.height },
        viewport
    );

    const mappedRect: Rect = {
        x: topLeftScreen.x,
        y: topLeftScreen.y,
        width: bottomRightScreen.x - topLeftScreen.x,
        height: bottomRightScreen.y - topLeftScreen.y
    };

    // Check if the spotlight is visible in the viewport
    const outputSize = viewMapper.outputVideoSize;
    const isVisible =
        mappedRect.width > 0 &&
        mappedRect.height > 0 &&
        mappedRect.x < outputSize.width &&
        mappedRect.y < outputSize.height &&
        mappedRect.x + mappedRect.width > 0 &&
        mappedRect.y + mappedRect.height > 0;

    if (isVisible) {
        // Clamp to output bounds
        const clampedRect = clampRectToBounds(mappedRect, outputSize);
        const scaledRect = scaleRectFromCenter(clampedRect, currentScale);

        return {
            isVisible: true,
            originalRect: clampedRect,
            scaledRect,
            sourceRect,
            borderRadius,
            dimOpacity: currentDimOpacity,
            scale: currentScale
        };
    } else {
        // Spotlight is active but not visible in current viewport
        // Still apply dimming, but no hole
        return {
            isVisible: false,
            originalRect: null,
            scaledRect: null,
            sourceRect,
            borderRadius,
            dimOpacity: currentDimOpacity,
            scale: currentScale
        };
    }
}

// ============================================================================
// Helpers
// ============================================================================


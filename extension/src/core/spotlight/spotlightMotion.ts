import type { SpotlightAction, SpotlightSettings, Rect } from '../types';
import { ViewMapper } from '../mappers/viewMapper';
import { scaleRectFromCenter, clampRectToBounds } from '../geometry';

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
 * The spotlight is defined in SOURCE coordinates (original screen recording).
 * It is mapped to OUTPUT coordinates based on the current viewport.
 * 
 * If the spotlight region is outside the viewport:
 * - Dimming still applies (isVisible = false but dimOpacity > 0)
 * - No hole is cut out (originalRect = null)
 * 
 * Animation phases:
 * 1. Before outputStartTimeMs: null (no spotlight)
 * 2. Fade in: outputStartTimeMs to outputStartTimeMs + transitionDurationMs
 * 3. Hold: between fade in and fade out
 * 4. Fade out: outputEndTimeMs - transitionDurationMs to outputEndTimeMs
 * 5. After outputEndTimeMs: null (spotlight ended)
 * 
 * @param spotlightActions - Array of spotlight action definitions (should be non-overlapping)
 * @param settings - Global spotlight settings
 * @param outputTimeMs - Current output time in milliseconds
 * @param viewport - Current viewport in output coordinates
 * @param viewMapper - ViewMapper for source-to-output coordinate transformation
 * @returns SpotlightState if a spotlight is active, null otherwise
 */
export function getSpotlightStateAtTime(
    spotlightActions: SpotlightAction[],
    settings: SpotlightSettings,
    outputTimeMs: number,
    viewport: Rect,
    viewMapper: ViewMapper
): SpotlightState | null {
    if (!spotlightActions || spotlightActions.length === 0) {
        return null;
    }

    // Find the active spotlight at this time
    const activeSpotlight = spotlightActions.find(
        s => outputTimeMs >= s.outputStartTimeMs && outputTimeMs <= s.outputEndTimeMs
    );

    if (!activeSpotlight) {
        return null;
    }

    // Calculate animation progress
    const { outputStartTimeMs, outputEndTimeMs, sourceRect, borderRadius, scale: spotlightScale } = activeSpotlight;
    const { transitionDurationMs, dimOpacity } = settings;

    const elapsed = outputTimeMs - outputStartTimeMs;
    const remaining = outputEndTimeMs - outputTimeMs;

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
    const easedProgress = applyEasing(animationProgress);

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
    // A spotlight is visible if its mapped rect has positive dimensions and overlaps with the output area
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

/**
 * Ease-in-out function for smooth transitions.
 * Uses cubic bezier approximation.
 */
function applyEasing(t: number): number {
    // Clamp t to [0, 1]
    t = Math.max(0, Math.min(1, t));
    // Ease-in-out cubic
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}


// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Gets the minimum allowed duration for a spotlight based on settings.
 * Must allow for full fade-in, some hold time, and fade-out.
 */
export function getMinSpotlightDuration(settings: SpotlightSettings): number {
    // 2x transition + 100ms buffer for hold
    return settings.transitionDurationMs * 2 + 100;
}

/**
 * Checks if a spotlight would overlap with any existing spotlights.
 * @param newStart - Start time of the new spotlight
 * @param newEnd - End time of the new spotlight
 * @param spotlightActions - Existing spotlight actions to check against
 * @param excludeId - Optional ID to exclude from overlap check (for editing existing spotlight)
 */
export function wouldSpotlightOverlap(
    newStart: number,
    newEnd: number,
    spotlightActions: SpotlightAction[],
    excludeId?: string
): boolean {
    return spotlightActions.some(s => {
        if (excludeId && s.id === excludeId) return false;
        // Check for any overlap
        return newStart < s.outputEndTimeMs && newEnd > s.outputStartTimeMs;
    });
}

/**
 * Finds valid time boundaries for a new spotlight at a given position.
 * Returns null if no valid position exists (completely blocked).
 */
export function getValidSpotlightRange(
    clickTimeMs: number,
    spotlightActions: SpotlightAction[],
    outputDuration: number,
    minDuration: number
): { start: number; end: number } | null {
    // Sort spotlight actions by start time
    const sorted = [...spotlightActions].sort((a, b) => a.outputStartTimeMs - b.outputStartTimeMs);

    // Find boundaries around the click position
    let prevEnd = 0;
    let nextStart = outputDuration;

    for (const s of sorted) {
        if (s.outputEndTimeMs <= clickTimeMs) {
            prevEnd = s.outputEndTimeMs;
        }
        if (s.outputStartTimeMs > clickTimeMs && s.outputStartTimeMs < nextStart) {
            nextStart = s.outputStartTimeMs;
            break;
        }
    }

    // Check if there's enough space for minimum duration
    const availableSpace = nextStart - prevEnd;
    if (availableSpace < minDuration) {
        return null;
    }

    // Center the default spotlight duration around click point
    const defaultDuration = Math.min(minDuration * 2, availableSpace);
    let start = clickTimeMs - defaultDuration / 2;
    let end = clickTimeMs + defaultDuration / 2;

    // Clamp to boundaries
    if (start < prevEnd) {
        start = prevEnd;
        end = Math.min(start + defaultDuration, nextStart);
    }
    if (end > nextStart) {
        end = nextStart;
        start = Math.max(end - defaultDuration, prevEnd);
    }

    return { start, end };
}

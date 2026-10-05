import type { SpotlightSegment, SpotlightSettings, Rect } from '../types';
import { ViewMapper } from '../mappers/viewMapper';

import { clampRectToBounds } from '../utils/geometry';
import { applyEasing } from './easing';


// ============================================================================
// Spotlight State
// ============================================================================

/**
 * Represents the current animated state of a spotlight at a given time.
 */
export interface SpotlightState {
    /** Whether the spotlight region is visible in the current viewport */
    isVisible: boolean;
    /** The spotlight rectangle in OUTPUT coordinates. Null if not visible. */
    originalRect: Rect | null;
    /** The source rectangle (in source video coordinates) */
    sourceRect: Rect;
    /** Border radius in pixels for each corner [topLeft, topRight, bottomRight, bottomLeft] (in OUTPUT coordinates) */
    borderRadiusPx: [number, number, number, number];
    /** Current animated dim value (0 to settings.dimOpacity) */
    dimOpacity: number;
    /** Feathered edge width in OUTPUT px (0 = hard edge) */
    featherPx: number;
    /** Eased transition progress, 0 (fully off) to 1 (fully on) */
    progress: number;
    /** Which part of the transition we're in */
    phase: 'in' | 'hold' | 'out';
    /** How the spotlight transitions (see SpotlightSettings.featherTransition) */
    featherTransition: 'fade' | 'closeIn';
    /** The target dim opacity at full effect (dimOpacity is this × progress) */
    fullDimOpacity: number;
}

/** Defaults for the optional feather settings (filled on project load, see migrateProject) */
export const DEFAULT_SPOTLIGHT_FEATHER_PX = 60;
export const DEFAULT_SPOTLIGHT_FEATHER_TRANSITION: NonNullable<SpotlightSettings['featherTransition']> = 'closeIn';

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
    spotlightSegments: SpotlightSegment[],
    settings: SpotlightSettings,
    outputTimeMs: number,
    viewport: Rect,
    viewMapper: ViewMapper
): SpotlightState | null {
    if (!spotlightSegments || spotlightSegments.length === 0) {
        return null;
    }

    const s = spotlightSegments.find(seg => seg.visible && outputTimeMs >= seg.outputStartTimeMs && outputTimeMs <= seg.outputEndTimeMs);
    if (!s) return null;

    // Per-segment values (fall back to global settings for legacy data)
    const transitionDurationMs = s.transitionDurationMs ?? settings.transitionDurationMs;
    const dimOpacity = s.dimOpacity ?? settings.dimOpacity;
    const easing = s.easing ?? settings.easing ?? 'ease-in-out';

    const elapsed = outputTimeMs - s.outputStartTimeMs;
    const remaining = s.outputEndTimeMs - outputTimeMs;
    const duration = s.outputEndTimeMs - s.outputStartTimeMs;
    const halfDuration = duration / 2;

    let animationProgress: number;
    let phase: SpotlightState['phase'];

    if (duration < transitionDurationMs * 2) {
        // Short spotlight: use halfway as the pivot.
        // Fade in until halfway, then fade out from whatever progress was reached.
        if (elapsed <= halfDuration) {
            animationProgress = elapsed / transitionDurationMs;
            phase = 'in';
        } else {
            const peakProgress = halfDuration / transitionDurationMs;
            const fadeOutElapsed = elapsed - halfDuration;
            animationProgress = peakProgress - (fadeOutElapsed / transitionDurationMs) * peakProgress;
            phase = 'out';
        }
    } else if (elapsed < transitionDurationMs) {
        // Phase 2: Fade in
        animationProgress = elapsed / transitionDurationMs;
        phase = 'in';
    } else if (remaining < transitionDurationMs) {
        // Phase 4: Fade out
        animationProgress = remaining / transitionDurationMs;
        phase = 'out';
    } else {
        // Phase 3: Hold at full effect
        animationProgress = 1.0;
        phase = 'hold';
    }

    // Apply easing
    const easedProgress = applyEasing(animationProgress, easing);

    // Interpolate values
    const currentDimOpacity = dimOpacity * easedProgress;
    const featherPx = settings.featherPx ?? DEFAULT_SPOTLIGHT_FEATHER_PX;
    const featherTransition = settings.featherTransition ?? DEFAULT_SPOTLIGHT_FEATHER_TRANSITION;

    // Map source rect to output coordinates using the viewport
    const mappedRect = viewMapper.projectEventToOutput(s.sourceRect, viewport);

    // Scale border radius to match zoom projection.
    // borderRadiusPx is stored in base output coords (no zoom).
    // When zoom is active, the rect scales by outputSize/viewport.size,
    // so radii must scale by the same factor.
    const baseRect = viewMapper.eventToOutputRect(s.sourceRect);
    const radiusScale = baseRect.width > 0
        ? mappedRect.width / baseRect.width
        : 1;
    const zoomedBorderRadiusPx: [number, number, number, number] = [
        s.borderRadiusPx[0] * radiusScale,
        s.borderRadiusPx[1] * radiusScale,
        s.borderRadiusPx[2] * radiusScale,
        s.borderRadiusPx[3] * radiusScale,
    ];

    // Check if the spotlight is visible in the viewport
    const outputSize = viewMapper.outputSize;
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

        return {
            isVisible: true,
            originalRect: clampedRect,
            sourceRect: s.sourceRect,
            borderRadiusPx: zoomedBorderRadiusPx,
            dimOpacity: currentDimOpacity,
            featherPx,
            progress: easedProgress,
            phase,
            featherTransition,
            fullDimOpacity: dimOpacity
        };
    } else {
        // Spotlight is active but not visible in current viewport
        // Still apply dimming, but no hole
        return {
            isVisible: false,
            originalRect: null,
            sourceRect: s.sourceRect,
            borderRadiusPx: zoomedBorderRadiusPx,
            dimOpacity: currentDimOpacity,
            featherPx,
            progress: easedProgress,
            phase,
            featherTransition,
            fullDimOpacity: dimOpacity
        };
    }
}

// ============================================================================
// Helpers
// ============================================================================


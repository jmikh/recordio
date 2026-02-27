import { type ZoomSegment, type Size, type Rect, type CameraSettings, type CameraLayoutSegment, type ZoomSettings } from '../../types';
import { getViewportStateAtTime } from './zoomAnimator';
import { applyEasing } from '../easing';

/**
 * Anchor point for camera positioning.
 * Determines which corner stays fixed when camera size changes.
 */
export type CameraAnchor =
    | 'top-left' | 'top-right'
    | 'bottom-left' | 'bottom-right';

export interface CameraMotionState {
    /** Current scale factor (1.0 = full, 0.5 = 50%) */
    sizeScale: number;
    /** Whether currently transitioning */
    isTransitioning: boolean;
}

/**
 * Determines which corner the camera is anchored to based on its position.
 * The camera will shrink toward the corner closest to its center.
 */
export function getCameraAnchor(
    camera: Pick<CameraSettings, 'xPx' | 'yPx' | 'widthPx' | 'heightPx'>,
    outputSize: Size
): CameraAnchor {
    // Calculate camera center
    const cameraCenterX = camera.xPx + camera.widthPx / 2;
    const cameraCenterY = camera.yPx + camera.heightPx / 2;

    // Calculate output center
    const outputCenterX = outputSize.width / 2;
    const outputCenterY = outputSize.height / 2;

    // Determine quadrant
    const isLeft = cameraCenterX < outputCenterX;
    const isTop = cameraCenterY < outputCenterY;

    if (isTop && isLeft) return 'top-left';
    if (isTop && !isLeft) return 'top-right';
    if (!isTop && isLeft) return 'bottom-left';
    return 'bottom-right';
}

/**
 * Scales camera settings while maintaining anchor position.
 * The specified corner will stay fixed while the camera shrinks/grows.
 */
export function scaleCameraSettings<T extends Pick<CameraSettings, 'xPx' | 'yPx' | 'widthPx' | 'heightPx'>>(
    settings: T,
    scale: number,
    anchor: CameraAnchor
): T {
    const newWidth = settings.widthPx * scale;
    const newHeight = settings.heightPx * scale;

    const deltaW = settings.widthPx - newWidth;
    const deltaH = settings.heightPx - newHeight;

    let newX = settings.xPx;
    let newY = settings.yPx;

    // Adjust position based on anchor to keep corner fixed
    switch (anchor) {
        case 'top-left':
            // Top-left corner stays fixed, no adjustment needed
            break;
        case 'top-right':
            // Top-right corner stays fixed, shift x by deltaW
            newX += deltaW;
            break;
        case 'bottom-left':
            // Bottom-left corner stays fixed, shift y by deltaH
            newY += deltaH;
            break;
        case 'bottom-right':
            // Bottom-right corner stays fixed, shift both
            newX += deltaW;
            newY += deltaH;
            break;
    }

    return {
        ...settings,
        widthPx: newWidth,
        heightPx: newHeight,
        xPx: newX,
        yPx: newY,
    };
}

/**
 * Checks if a viewport rect represents a full-screen (no zoom) state.
 */
function isFullScreen(rect: Rect, outputSize: Size): boolean {
    return Math.abs(rect.x) < 1 &&
        Math.abs(rect.y) < 1 &&
        Math.abs(rect.width - outputSize.width) < 1 &&
        Math.abs(rect.height - outputSize.height) < 1;
}


/**
 * Calculates the effective camera state at a given time based on viewport motions.
 * 
 * Derives camera shrink from the authoritative viewport interpolator
 * (getViewportStateAtTime), so the camera scale is always proportional to
 * and perfectly synchronized with the viewport zoom level — including the
 * gap-based zoom-out transitions that have no explicit ZoomSegment.
 * 
 * @param actions - Array of zoom segments from the timeline
 * @param currentTimeMs - Current playback time in milliseconds (OUTPUT time)
 * @param outputSize - The output video size
 * @param shrinkScale - Target scale when fully shrunk (e.g., 0.5 for 50%)
 * @param zoomSettings - Zoom settings (transitionDurationMs, easing)
 * @returns The current camera state including scale factor
 */
export function getCameraStateAtTime(
    actions: ZoomSegment[],
    currentTimeMs: number,
    outputSize: Size,
    shrinkScale: number,
    zoomSettings: ZoomSettings
): CameraMotionState {
    if (actions.length === 0) {
        return { sizeScale: 1.0, isTransitioning: false };
    }

    // Use the same interpolation engine as the viewport itself
    const viewport = getViewportStateAtTime(actions, currentTimeMs, outputSize, zoomSettings);

    if (isFullScreen(viewport, outputSize)) {
        return { sizeScale: 1.0, isTransitioning: false };
    }

    // Calculate how zoomed-in the viewport is (1.0 = full screen, 0 = infinitely zoomed)
    const zoomRatio = viewport.width / outputSize.width;

    // Map zoom ratio to camera scale: full screen → 1.0, fully zoomed → shrinkScale
    const sizeScale = shrinkScale + (1.0 - shrinkScale) * zoomRatio;

    return {
        sizeScale,
        isTransitioning: zoomRatio > 0.01 && zoomRatio < 0.99,
    };
}


// ==========================================
// RESOLVED CAMERA STATE (Layout Blocks + Auto-Shrink)
// ==========================================

/**
 * Fully resolved camera state at a given time, combining layout blocks,
 * transitions, and auto-shrink into a single renderable state.
 */
export interface ResolvedCameraState {
    /** Final position/size after layout block + auto-shrink */
    xPx: number;
    yPx: number;
    widthPx: number;
    heightPx: number;
    /** Shape hint for bounding box constraints (rendering uses borderRadiusPx) */
    shape: 'circle' | 'rect' | 'square';
    /** Border radius for rendering (circles bake min(w,h)/2 on shape change) */
    borderRadiusPx: number;
    /** Opacity (0 = hidden, 1 = visible, fractional = transitioning) */
    opacity: number;
    /** Whether auto-shrink is actively scaling */
    isAutoShrunk: boolean;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Bake borderRadiusPx for circles — painter renders purely on radius */
function bakedBorderRadius(shape: string, borderRadiusPx: number, widthPx: number, heightPx: number): number {
    return shape === 'circle' ? Math.min(widthPx, heightPx) / 2 : borderRadiusPx;
}

/**
 * Resolves the camera state at a given output time, accounting for:
 * 1. Camera layout blocks (position/size overrides with transitions)
 * 2. Auto-shrink from zoom state
 *
 * Shape is only used as a UI hint for bounding box constraints.
 * Rendering uses borderRadiusPx exclusively — shapes bake their radius on change.
 */
export function getResolvedCameraStateAtTime(
    cameraSettings: CameraSettings,
    cameraLayoutSegments: CameraLayoutSegment[],
    zoomSegments: ZoomSegment[],
    currentTimeMs: number,
    outputSize: Size,
    zoomSettings: ZoomSettings
): ResolvedCameraState {
    // Default camera state (bake borderRadius for circles)
    let x = cameraSettings.xPx;
    let y = cameraSettings.yPx;
    let w = cameraSettings.widthPx;
    let h = cameraSettings.heightPx;
    let shape = cameraSettings.shape;
    let borderRadius = bakedBorderRadius(cameraSettings.shape, cameraSettings.borderRadiusPx, cameraSettings.widthPx, cameraSettings.heightPx);
    let opacity = 1;

    // Helper: compute auto-shrunk position/size at a specific time
    const getAutoShrunkRect = (timeMs: number, rect: { x: number; y: number; w: number; h: number }) => {
        if (!cameraSettings.autoShrink) return rect;
        const state = getCameraStateAtTime(zoomSegments, timeMs, outputSize, cameraSettings.shrinkScale ?? 0.5, zoomSettings);
        if (state.sizeScale >= 1.0) return rect;
        const anchor = getCameraAnchor({ xPx: rect.x, yPx: rect.y, widthPx: rect.w, heightPx: rect.h }, outputSize);
        const scaled = scaleCameraSettings({ xPx: rect.x, yPx: rect.y, widthPx: rect.w, heightPx: rect.h }, state.sizeScale, anchor);
        return { x: scaled.xPx, y: scaled.yPx, w: scaled.widthPx, h: scaled.heightPx };
    };

    const visibleSegments = (cameraLayoutSegments || []).filter(s => s.visible !== false);
    let insideLayoutBlock = false;

    if (visibleSegments.length > 0) {
        const activeSegment = visibleSegments.find(
            s => currentTimeMs >= s.outputStartTimeMs && currentTimeMs <= s.outputEndTimeMs
        );

        if (activeSegment) {
            insideLayoutBlock = true;
            const td = activeSegment.transitionDurationMs;
            const elapsed = currentTimeMs - activeSegment.outputStartTimeMs;
            const remaining = activeSegment.outputEndTimeMs - currentTimeMs;

            if (activeSegment.hidden) {
                // Hidden block: maintain previous visible block's position, transition opacity
                const prevVisible = [...visibleSegments]
                    .filter(s => !s.hidden && s.outputEndTimeMs <= activeSegment.outputStartTimeMs)
                    .pop();
                if (prevVisible) {
                    x = prevVisible.xPx;
                    y = prevVisible.yPx;
                    w = prevVisible.widthPx;
                    h = prevVisible.heightPx;
                    shape = prevVisible.shape;
                    borderRadius = bakedBorderRadius(prevVisible.shape, prevVisible.borderRadiusPx, prevVisible.widthPx, prevVisible.heightPx);
                }

                const duration = activeSegment.outputEndTimeMs - activeSegment.outputStartTimeMs;
                const halfDuration = duration / 2;

                // Compute fade progress (0 = fully visible, 1 = fully hidden)
                // Mirrors spotlightAnimator: pivot at half for short blocks.
                let fadeProgress: number;

                if (duration < td * 2) {
                    if (elapsed <= halfDuration) {
                        fadeProgress = elapsed / td;
                    } else {
                        const peakProgress = halfDuration / td;
                        const fadeOutElapsed = elapsed - halfDuration;
                        fadeProgress = peakProgress - (fadeOutElapsed / td) * peakProgress;
                    }
                } else if (elapsed < td) {
                    fadeProgress = elapsed / td;
                } else if (remaining < td) {
                    fadeProgress = remaining / td;
                } else {
                    fadeProgress = 1.0;
                }

                const t = applyEasing(Math.min(1, Math.max(0, fadeProgress)), activeSegment.easing);
                opacity = lerp(1, 0, t);

                // During fade-in from hidden, interpolate toward auto-shrunk post-block state
                if (elapsed > halfDuration && t < 1.0) {
                    const shrunk = getAutoShrunkRect(activeSegment.outputEndTimeMs + 1, { x, y, w, h });
                    const reverseT = 1 - t; // How far we are from fully hidden
                    x = lerp(x, shrunk.x, reverseT);
                    y = lerp(y, shrunk.y, reverseT);
                    w = lerp(w, shrunk.w, reverseT);
                    h = lerp(h, shrunk.h, reverseT);
                }
            } else {
                // Active visible block — self-contained transitions from/to defaults
                const segBR = bakedBorderRadius(activeSegment.shape, activeSegment.borderRadiusPx, activeSegment.widthPx, activeSegment.heightPx);
                const duration = activeSegment.outputEndTimeMs - activeSegment.outputStartTimeMs;
                const halfDuration = duration / 2;

                // Compute animation progress (0 = defaults, 1 = fully at segment values)
                // Mirrors spotlightAnimator: pivot at half for short blocks.
                let animationProgress: number;

                if (duration < td * 2) {
                    // Short block: fade in until halfway, then reverse from peak
                    if (elapsed <= halfDuration) {
                        animationProgress = elapsed / td;
                    } else {
                        const peakProgress = halfDuration / td;
                        const fadeOutElapsed = elapsed - halfDuration;
                        animationProgress = peakProgress - (fadeOutElapsed / td) * peakProgress;
                    }
                } else if (elapsed < td) {
                    // Transition IN
                    animationProgress = elapsed / td;
                } else if (remaining < td) {
                    // Transition OUT
                    animationProgress = remaining / td;
                } else {
                    // Steady state
                    animationProgress = 1.0;
                }

                const t = applyEasing(Math.min(1, Math.max(0, animationProgress)), activeSegment.easing);

                if (t >= 1.0) {
                    // Fully at segment values
                    x = activeSegment.xPx;
                    y = activeSegment.yPx;
                    w = activeSegment.widthPx;
                    h = activeSegment.heightPx;
                    shape = activeSegment.shape;
                    borderRadius = segBR;
                } else {
                    // Transitioning — interpolate between auto-shrunk defaults and segment
                    // Use pre-block shrink for transition-in, post-block for transition-out
                    const peekTime = elapsed < halfDuration
                        ? activeSegment.outputStartTimeMs - 1
                        : activeSegment.outputEndTimeMs + 1;
                    const shrunkDefault = getAutoShrunkRect(peekTime, { x, y, w, h });

                    x = lerp(shrunkDefault.x, activeSegment.xPx, t);
                    y = lerp(shrunkDefault.y, activeSegment.yPx, t);
                    w = lerp(shrunkDefault.w, activeSegment.widthPx, t);
                    h = lerp(shrunkDefault.h, activeSegment.heightPx, t);
                    borderRadius = lerp(borderRadius, segBR, t);
                    shape = activeSegment.shape;
                }
            }
        }
    }

    // Apply auto-shrink outside layout blocks
    let isAutoShrunk = false;
    if (cameraSettings.autoShrink && !insideLayoutBlock) {
        const shrunk = getAutoShrunkRect(currentTimeMs, { x, y, w, h });
        if (shrunk.x !== x || shrunk.y !== y || shrunk.w !== w || shrunk.h !== h) {
            isAutoShrunk = true;
            x = shrunk.x;
            y = shrunk.y;
            w = shrunk.w;
            h = shrunk.h;
        }
    }

    return { xPx: x, yPx: y, widthPx: w, heightPx: h, shape, borderRadiusPx: borderRadius, opacity, isAutoShrunk };
}

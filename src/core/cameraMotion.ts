import { type ViewportMotion, type Size, type Rect, type CameraSettings } from './types';

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
    camera: Pick<CameraSettings, 'x' | 'y' | 'width' | 'height'>,
    outputSize: Size
): CameraAnchor {
    // Calculate camera center
    const cameraCenterX = camera.x + camera.width / 2;
    const cameraCenterY = camera.y + camera.height / 2;

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
export function scaleCameraSettings<T extends Pick<CameraSettings, 'x' | 'y' | 'width' | 'height'>>(
    settings: T,
    scale: number,
    anchor: CameraAnchor
): T {
    const newWidth = settings.width * scale;
    const newHeight = settings.height * scale;

    const deltaW = settings.width - newWidth;
    const deltaH = settings.height - newHeight;

    let newX = settings.x;
    let newY = settings.y;

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
        width: newWidth,
        height: newHeight,
        x: newX,
        y: newY,
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
 * Ease-in-out easing function (same as viewportMotion.ts).
 */
function applyEasing(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Calculates the effective camera state at a given time based on viewport motions.
 * 
 * The camera will automatically shrink during zoom-in periods and grow back
 * during zoom-out periods, using the same transition timing as the viewport.
 * 
 * @param motions - Array of viewport motions from the timeline
 * @param currentTimeMs - Current playback time in milliseconds
 * @param outputSize - The output video size
 * @param shrinkScale - Target scale when shrunk (e.g., 0.5 for 50%)
 * @returns The current camera state including scale factor
 */
export function getCameraStateAtTime(
    motions: ViewportMotion[],
    currentTimeMs: number,
    outputSize: Size,
    shrinkScale: number
): CameraMotionState {
    if (motions.length === 0) {
        return { sizeScale: 1.0, isTransitioning: false };
    }

    // Find first zoom-in motion (viewport becomes smaller than full screen)
    const firstZoomIn = motions.find(m => !isFullScreen(m.rect, outputSize));

    if (!firstZoomIn) {
        // No zoom-ins found, camera stays full size
        return { sizeScale: 1.0, isTransitioning: false };
    }

    const zoomInStartMs = firstZoomIn.outputEndTimeMs - firstZoomIn.durationMs;
    const zoomInEndMs = firstZoomIn.outputEndTimeMs;

    // PHASE 1: Before first zoom-in starts → Full size
    if (currentTimeMs < zoomInStartMs) {
        return { sizeScale: 1.0, isTransitioning: false };
    }

    // PHASE 2: During first zoom-in transition → Shrinking
    if (currentTimeMs >= zoomInStartMs && currentTimeMs < zoomInEndMs) {
        const progress = (currentTimeMs - zoomInStartMs) / firstZoomIn.durationMs;
        const eased = applyEasing(progress);
        const scale = 1.0 - (1.0 - shrinkScale) * eased;
        return { sizeScale: scale, isTransitioning: true };
    }

    // Find first zoom-out to full screen (after a zoom-in has occurred)
    // We look for the first motion that returns to full screen AND comes after the first zoom-in
    const firstZoomOutToFull = motions.find(m =>
        isFullScreen(m.rect, outputSize) &&
        m.outputEndTimeMs > zoomInEndMs
    );

    if (!firstZoomOutToFull) {
        // No zoom-out to full found, camera stays shrunk forever
        return { sizeScale: shrinkScale, isTransitioning: false };
    }

    const zoomOutStartMs = firstZoomOutToFull.outputEndTimeMs - firstZoomOutToFull.durationMs;
    const zoomOutEndMs = firstZoomOutToFull.outputEndTimeMs;

    // PHASE 3: Between zoom-in end and zoom-out start → Shrunk (static)
    if (currentTimeMs >= zoomInEndMs && currentTimeMs < zoomOutStartMs) {
        return { sizeScale: shrinkScale, isTransitioning: false };
    }

    // PHASE 4: During zoom-out transition → Growing back
    if (currentTimeMs >= zoomOutStartMs && currentTimeMs < zoomOutEndMs) {
        const progress = (currentTimeMs - zoomOutStartMs) / firstZoomOutToFull.durationMs;
        const eased = applyEasing(progress);
        const scale = shrinkScale + (1.0 - shrinkScale) * eased;
        return { sizeScale: scale, isTransitioning: true };
    }

    // PHASE 5: After zoom-out completes → Full size
    return { sizeScale: 1.0, isTransitioning: false };
}

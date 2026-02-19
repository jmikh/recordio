import { type ZoomSegment, type Size, type Rect, type CameraSettings, type ZoomSettings } from '../../types';
import { getViewportStateAtTime } from './zoomAnimator';

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


import { type ZoomSegment, type Size, type Rect, type CameraSettings, type ZoomSettings } from '../../types';
import { TimeMapper } from '../mappers/timeMapper';
import { prepareZoomSegmentsForInterpolation } from './zoomAnimator';
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
 * The camera will automatically shrink during zoom-in periods and grow back
 * during zoom-out periods, using the same transition timing as the viewport.
 * 
 * @param actions - Array of zoom actions from the timeline
 * @param currentTimeMs - Current playback time in milliseconds (OUTPUT time)
 * @param outputSize - The output video size
 * @param shrinkScale - Target scale when shrunk (e.g., 0.5 for 50%)
 * @param timeMapper - TimeMapper for source to output conversion
 * @param zoomSettings - Zoom settings for duration calculation
 * @returns The current camera state including scale factor
 */
export function getCameraStateAtTime(
    actions: ZoomSegment[],
    currentTimeMs: number,
    outputSize: Size,
    shrinkScale: number,
    timeMapper: TimeMapper,
    zoomSettings: ZoomSettings
): CameraMotionState {
    if (actions.length === 0) {
        return { sizeScale: 1.0, isTransitioning: false };
    }

    // Prepare actions with output times and durations
    const preparedActions = prepareZoomSegmentsForInterpolation(actions, timeMapper, zoomSettings);

    // Find first zoom-in motion (viewport becomes smaller than full screen)
    const firstZoomIn = preparedActions.find(m => !isFullScreen(m.rectPx, outputSize));

    if (!firstZoomIn) {
        // No zoom-ins found, camera stays full size
        return { sizeScale: 1.0, isTransitioning: false };
    }

    const zoomInStartMs = firstZoomIn.outputStartTime;
    const zoomInEndMs = firstZoomIn.outputEndTime;
    const zoomInDuration = firstZoomIn.duration;

    // PHASE 1: Before first zoom-in starts → Full size
    if (currentTimeMs < zoomInStartMs) {
        return { sizeScale: 1.0, isTransitioning: false };
    }

    // PHASE 2: During first zoom-in transition → Shrinking
    if (currentTimeMs >= zoomInStartMs && currentTimeMs < zoomInEndMs) {
        const progress = (currentTimeMs - zoomInStartMs) / zoomInDuration;
        const eased = applyEasing(progress, zoomSettings.easing ?? 'ease-in-out');
        const scale = 1.0 - (1.0 - shrinkScale) * eased;
        return { sizeScale: scale, isTransitioning: true };
    }

    // Find first zoom-out to full screen (after a zoom-in has occurred)
    const firstZoomOutToFull = preparedActions.find(m =>
        isFullScreen(m.rectPx, outputSize) &&
        m.outputEndTime > zoomInEndMs
    );

    if (!firstZoomOutToFull) {
        // No zoom-out to full found, camera stays shrunk forever
        return { sizeScale: shrinkScale, isTransitioning: false };
    }

    const zoomOutStartMs = firstZoomOutToFull.outputStartTime;
    const zoomOutEndMs = firstZoomOutToFull.outputEndTime;
    const zoomOutDuration = firstZoomOutToFull.duration;

    // PHASE 3: Between zoom-in end and zoom-out start → Shrunk (static)
    if (currentTimeMs >= zoomInEndMs && currentTimeMs < zoomOutStartMs) {
        return { sizeScale: shrinkScale, isTransitioning: false };
    }

    // PHASE 4: During zoom-out transition → Growing back
    if (currentTimeMs >= zoomOutStartMs && currentTimeMs < zoomOutEndMs) {
        const progress = (currentTimeMs - zoomOutStartMs) / zoomOutDuration;
        const eased = applyEasing(progress, zoomSettings.easing ?? 'ease-in-out');
        const scale = shrinkScale + (1.0 - shrinkScale) * eased;
        return { sizeScale: scale, isTransitioning: true };
    }

    // PHASE 5: After zoom-out completes → Full size
    return { sizeScale: 1.0, isTransitioning: false };
}

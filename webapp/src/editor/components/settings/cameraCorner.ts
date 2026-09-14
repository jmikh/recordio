import type { CameraSettings, Size } from '@shared/types';
import { applyCameraShape } from '@shared/utils/cameraShape';

/**
 * Camera placement helpers for the Personal Settings page
 * (plans/user-default-project-settings §3.6). In the editor the bubble is
 * positioned and resized by dragging on the canvas; the defaults page has a
 * still preview, so it offers a size slider that keeps the bubble in the
 * corner it already sits in.
 */
export type CameraCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Margin from the frame edge — the factory default is 25 px at 1080p. */
export function cameraCornerMargin(outputSize: Size): number {
    return Math.round(outputSize.height * 25 / 1080);
}

export function nearestCameraCorner(camera: CameraSettings, outputSize: Size): CameraCorner {
    const right = camera.xPx + camera.widthPx / 2 > outputSize.width / 2;
    const bottom = camera.yPx + camera.heightPx / 2 > outputSize.height / 2;
    return `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`;
}

export function placeCameraAtCorner(camera: CameraSettings, corner: CameraCorner, outputSize: Size): CameraSettings {
    const margin = cameraCornerMargin(outputSize);
    const xPx = corner.endsWith('right') ? outputSize.width - camera.widthPx - margin : margin;
    const yPx = corner.startsWith('bottom') ? outputSize.height - camera.heightPx - margin : margin;
    return { ...camera, xPx: Math.max(0, xPx), yPx: Math.max(0, yPx) };
}

/**
 * Resize to a fraction of the output height, keeping the shape's aspect
 * (rect follows the camera source) and the corner the bubble sits in.
 */
export function resizeCameraKeepingCorner(
    camera: CameraSettings,
    heightFraction: number,
    cameraSourceSize: Size | undefined,
    outputSize: Size,
): CameraSettings {
    const corner = nearestCameraCorner(camera, outputSize);
    const heightPx = Math.round(outputSize.height * heightFraction);
    const resized = applyCameraShape({ ...camera, heightPx, widthPx: heightPx }, camera.shape, cameraSourceSize, outputSize);
    return placeCameraAtCorner(resized, corner, outputSize);
}

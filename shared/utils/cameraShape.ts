import type { CameraSettings, Size } from '../types';

export type CameraShape = CameraSettings['shape'];

/**
 * Keeps the camera bubble inside the output frame.
 */
export function clampCameraToOutput(camera: CameraSettings, outputSize: Size): CameraSettings {
    return {
        ...camera,
        xPx: Math.max(0, Math.min(camera.xPx, outputSize.width - camera.widthPx)),
        yPx: Math.max(0, Math.min(camera.yPx, outputSize.height - camera.heightPx)),
    };
}

/**
 * Re-derives the bubble's width/height for its shape from the camera
 * source's aspect ratio ('rect' follows the source; 'square'/'circle'
 * collapse to the smaller side), then clamps it into the output frame.
 * Used when the shape changes in the editor and when personal default
 * settings meet a real recording's camera (the defaults were authored
 * against a sample camera whose aspect may differ).
 */
export function fitCameraToSource(
    camera: CameraSettings,
    cameraSourceSize: Size | undefined,
    outputSize: Size,
): CameraSettings {
    const next: CameraSettings = { ...camera };
    if (next.shape === 'rect') {
        if (cameraSourceSize && cameraSourceSize.height > 0) {
            next.widthPx = next.heightPx * (cameraSourceSize.width / cameraSourceSize.height);
        }
    } else {
        const size = Math.min(next.widthPx, next.heightPx);
        next.widthPx = size;
        next.heightPx = size;
    }
    return clampCameraToOutput(next, outputSize);
}

/**
 * Applies a new shape: bakes borderRadiusPx (the painter renders purely
 * on radius — a circle is a square with radius = half its side), then
 * refits the size to the source aspect and clamps.
 */
export function applyCameraShape(
    camera: CameraSettings,
    shape: CameraShape,
    cameraSourceSize: Size | undefined,
    outputSize: Size,
): CameraSettings {
    const next: CameraSettings = { ...camera, shape };
    if (shape === 'circle') {
        next.borderRadiusPx = Math.min(next.widthPx, next.heightPx) / 2;
    } else {
        next.borderRadiusPx = 10;
    }
    return fitCameraToSource(next, cameraSourceSize, outputSize);
}

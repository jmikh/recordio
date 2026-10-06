import type { CameraMatteMetadata } from '../types/core';
import type { Project } from '../types/project';

/**
 * The person mask the camera layer applies right now: present only while
 * "Remove background" is on AND the mask has been computed. Toggling the
 * setting is just a flip once the mask exists.
 */
export function getActiveCameraMatte(project: Project): CameraMatteMetadata | null {
    if (!project.settings.camera?.removeBackground) return null;
    return project.cameraSource?.matte ?? null;
}

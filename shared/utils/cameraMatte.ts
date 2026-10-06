import type { CameraMatteMetadata } from '../types/core';
import type { Project } from '../types/project';

/**
 * The person mask the camera layer may apply: present only while some part
 * of the video removes the background — the "Remove background" setting or
 * an enabled camera layout block that turns it on — AND the mask has been
 * computed. Toggling either is just a flip once the mask exists. How much
 * of it is drawn at a given time comes from getResolvedCameraStateAtTime.
 */
export function getActiveCameraMatte(project: Project): CameraMatteMetadata | null {
    const matte = project.cameraSource?.matte;
    if (!matte) return null;
    if (project.settings.camera?.removeBackground) return matte;
    const cameraMoveEnabled = project.settings.cameraMove?.enabled ?? true;
    const anyBlock = cameraMoveEnabled && (project.timeline.cameraMoveSegments || [])
        .some(s => s.visible !== false && !s.hidden && s.removeBackground);
    return anyBlock ? matte : null;
}

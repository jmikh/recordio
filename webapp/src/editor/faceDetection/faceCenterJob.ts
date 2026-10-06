/**
 * Finds the user's face in the loaded project's camera recording and saves
 * it as `camera.faceCenter`, the anchor the camera crop centers on. The
 * editor starts it once a project's media has loaded; a project that already
 * has an anchor is left alone. When no face is found nothing is saved, so the
 * next load tries again.
 *
 * One job at a time, owned by a project; leaving the project aborts it.
 */
import { useProjectStore } from '../stores/useProjectStore';
import { useMediaUrlStore } from '../../storage/useMediaUrlStore';
import { captureError } from '../../lib/sentry';
import { getImpersonation } from '../../auth/impersonation';
import { detectFaceCenter } from './detectFaceCenter';

let active: { projectId: string; controller: AbortController } | null = null;

/** Start the job for the loaded project unless it has a face anchor or a job is already running. */
export function ensureFaceCenter(): void {
    const { project, templateMode } = useProjectStore.getState();
    const camera = project.cameraSource;
    // Impersonation is read-only: no project change
    if (templateMode || getImpersonation() || !camera || !project.settings.camera || project.settings.camera.faceCenter) return;
    if (active?.projectId === project.id) return;

    cancelFaceCenter();
    const controller = new AbortController();
    active = { projectId: project.id, controller };
    runJob(project.id, camera.storagePath, camera.durationMs, controller.signal).finally(() => {
        if (active?.controller === controller) active = null;
    });
}

/** Abort the running job. */
export function cancelFaceCenter(): void {
    active?.controller.abort();
    active = null;
}

async function runJob(projectId: string, cameraPath: string, durationMs: number, signal: AbortSignal): Promise<void> {
    try {
        const cameraUrl = useMediaUrlStore.getState().urls[cameraPath];
        if (!cameraUrl) throw new Error('Camera video is not loaded');

        const center = await detectFaceCenter(cameraUrl, durationMs, signal);
        if (signal.aborted) return;
        if (!center) {
            console.info('[faceCenter] No face found in the camera recording');
            return;
        }

        // Guarded by abort-on-leave, but never write to a different project
        // or over an anchor that appeared while detecting
        const { project, setCameraFaceCenter } = useProjectStore.getState();
        if (project.id !== projectId || !project.settings.camera || project.settings.camera.faceCenter) return;
        setCameraFaceCenter(center);
    } catch (err) {
        if (signal.aborted) return;
        console.error('[faceCenter] Detection failed:', err);
        captureError(err, { flow: 'face_center', projectId });
    }
}

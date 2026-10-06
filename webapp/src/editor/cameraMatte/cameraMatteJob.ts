/**
 * Runs the one-time camera background-removal job for the loaded project:
 * compute the person-mask video, upload it next to the camera recording,
 * then attach it to the project. The editor starts it once a project's
 * media has loaded, so "Remove background" is a flip.
 *
 * One job at a time, owned by a project; leaving the project aborts it.
 */
import { useProjectStore } from '../stores/useProjectStore';
import { IDLE_CAMERA_MATTE_JOB } from '../stores/slices/cameraMatteSlice';
import { useMediaUrlStore } from '../../storage/useMediaUrlStore';
import { BlobCache } from '../../storage/blobCache';
import { CloudStorage } from '../../storage/cloudStorage';
import { AuthManager } from '../../auth/AuthManager';
import { captureError } from '../../lib/sentry';
import { getImpersonation } from '../../auth/impersonation';
import { cloudStoragePath, PROJECT_MEDIA_BUCKET } from '@shared/utils/projectMedia';
import { computeCameraMatte } from './computeCameraMatte';

let active: { projectId: string; controller: AbortController } | null = null;

/** Start the job for the loaded project unless its matte exists or a job is already running. */
export function ensureCameraMatte(): void {
    const { project, templateMode } = useProjectStore.getState();
    const camera = project.cameraSource;
    // Impersonation is read-only: no upload, no project change
    if (templateMode || getImpersonation() || !camera || camera.matte) return;
    if (active?.projectId === project.id) return;

    cancelCameraMatte();
    const controller = new AbortController();
    active = { projectId: project.id, controller };
    runJob(project.id, camera.storagePath, controller.signal).finally(() => {
        if (active?.controller === controller) active = null;
    });
}

/** Abort the running job (only if it belongs to `projectId`, when given) and clear its status. */
export function cancelCameraMatte(projectId?: string): void {
    if (active && projectId && active.projectId !== projectId) return;
    active?.controller.abort();
    active = null;
    useProjectStore.getState().setCameraMatteJob(IDLE_CAMERA_MATTE_JOB);
}

async function runJob(projectId: string, cameraPath: string, signal: AbortSignal): Promise<void> {
    const setJob = useProjectStore.getState().setCameraMatteJob;
    // Progress arrives per frame; re-render only when the whole percent changes.
    // The first frame's report also moves the status on from 'preparing'.
    let lastPercent = -1;
    const progress = (status: 'processing' | 'uploading') => (fraction: number) => {
        const percent = Math.floor(fraction * 100);
        if (percent === lastPercent || signal.aborted) return;
        lastPercent = percent;
        setJob({ status, progress: fraction, error: null });
    };

    try {
        setJob({ status: 'preparing', progress: 0, error: null });
        const cameraUrl = useMediaUrlStore.getState().urls[cameraPath];
        if (!cameraUrl) throw new Error('Camera video is not loaded');

        const blob = await computeCameraMatte(cameraUrl, { signal, onProgress: progress('processing') });

        lastPercent = -1;
        setJob({ status: 'uploading', progress: 0, error: null });
        const session = await AuthManager.getSession();
        if (!session) throw new Error('Not signed in');
        const storagePath = cloudStoragePath(session.user.id, projectId, 'cameraMatte');
        await CloudStorage.uploadBlobResumable(PROJECT_MEDIA_BUCKET, storagePath, blob, 'video/webm', progress('uploading'));
        if (signal.aborted) return;

        await BlobCache.put(storagePath, blob);
        useMediaUrlStore.getState().setUrl(storagePath, URL.createObjectURL(blob));

        // Guarded by abort-on-leave, but never attach to a different project
        if (useProjectStore.getState().project.id !== projectId) return;
        useProjectStore.getState().setCameraMatte({ storagePath });
        setJob(IDLE_CAMERA_MATTE_JOB);
    } catch (err) {
        if (signal.aborted) return;
        console.error('[cameraMatte] Job failed:', err);
        captureError(err, { flow: 'camera_matte', projectId });
        setJob({ status: 'error', progress: 0, error: err instanceof Error ? err.message : String(err) });
    }
}

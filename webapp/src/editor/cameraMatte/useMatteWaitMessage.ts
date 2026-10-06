import { useProjectStore } from '../stores/useProjectStore';

/**
 * "No background" waits for the camera's mask, computed in the background
 * once the project has loaded. Until then the option is disabled and this
 * is its tooltip; '' once it can be picked. `matteFailed`: the wait is
 * an error (announce it as an alert).
 */
export function useMatteWaitMessage(): { matteWaitMessage: string; matteFailed: boolean } {
    const hasMatte = useProjectStore(s => !!s.project.cameraSource?.matte);
    const cameraMatteJob = useProjectStore(s => s.cameraMatteJob);

    const mattePercent = Math.floor(cameraMatteJob.progress * 100);
    const matteFailed = cameraMatteJob.status === 'error' && !hasMatte;
    const matteWaitMessage = cameraMatteJob.status === 'processing' ? `Computing background mask… ${mattePercent}%`
        : cameraMatteJob.status === 'uploading' ? `Saving background mask… ${mattePercent}%`
            : matteFailed ? "Couldn't compute the background mask. Reopen the project to try again."
                : cameraMatteJob.status === 'preparing' || !hasMatte ? 'Computing background mask…'
                    : '';
    return { matteWaitMessage, matteFailed };
}

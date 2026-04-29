import { useEffect, useRef, useCallback } from 'react';
import { CloudProjectService } from '../storage/cloudProjectService';
import { usePendingUploadStore } from '../storage/pendingUploadStore';
import { useSyncStatusStore } from '../storage/syncStatusStore';

/**
 * Manages background media upload after import.
 *
 * On mount, checks if there are pending blobs for the given project.
 * If so, kicks off the upload, tracks progress via syncStatusStore,
 * and registers a beforeunload warning. On completion, triggers a
 * project save to flush any buffered edits.
 *
 * @param projectId - The project to check for pending uploads
 * @param onUploadComplete - Called when all media is uploaded; use to flush edits
 */
export function useBackgroundUpload(
    projectId: string | null,
    onUploadComplete?: () => void,
) {
    const uploadStarted = useRef(false);

    const startUpload = useCallback(async () => {
        const { pending, clear } = usePendingUploadStore.getState();
        if (!pending || pending.projectId !== projectId || uploadStarted.current) return;

        uploadStarted.current = true;

        try {
            // Build blobs list matching the upload targets
            const blobs: { fileType: string; blob: Blob }[] = [
                { fileType: 'screen', blob: pending.screenBlob },
            ];
            if (pending.cameraBlob) blobs.push({ fileType: 'camera', blob: pending.cameraBlob });
            if (pending.micBlob) blobs.push({ fileType: 'mic', blob: pending.micBlob });

            await CloudProjectService.uploadMedia(
                pending.projectId,
                pending.uploads,
                blobs,
            );

            clear();
            onUploadComplete?.();
        } catch (e) {
            // Error state is already set in syncStatusStore by uploadMedia
            console.error('[useBackgroundUpload] Upload failed:', e);
            // Allow retry
            uploadStarted.current = false;
        }
    }, [projectId, onUploadComplete]);

    // Start upload on mount if there are pending blobs
    useEffect(() => {
        startUpload();
    }, [startUpload]);

    // beforeunload warning while upload is in progress
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            const { pendingMediaUploads } = useSyncStatusStore.getState();
            if (pendingMediaUploads > 0) {
                e.preventDefault();
            }
        };

        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, []);

    // Expose retry for the SyncFailedModal
    const retry = useCallback(() => {
        uploadStarted.current = false;
        useSyncStatusStore.getState().setIdle();
        startUpload();
    }, [startUpload]);

    return { retry };
}

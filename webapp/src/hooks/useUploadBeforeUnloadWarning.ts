import { useEffect } from 'react';
import { useSyncStatusStore } from '../storage/syncStatusStore';

/**
 * Registers a `beforeunload` listener while a media upload is in flight,
 * so the browser shows its native "Leave site?" confirmation if the user
 * tries to close the tab / navigate away. The actual prompt text is
 * controlled by the browser and can't be customized.
 *
 * Without this, a refresh during upload silently kills the upload and
 * orphans the project (since the upload promise lives only in this tab).
 */
export function useUploadBeforeUnloadWarning() {
    const currentUpload = useSyncStatusStore(s => s.currentUpload);
    const isUploading = currentUpload !== null && currentUpload.type === 'media' && currentUpload.progress < 1;

    useEffect(() => {
        if (!isUploading) return;

        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            // Legacy browsers required setting returnValue to a non-empty string
            e.returnValue = '';
            return '';
        };

        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isUploading]);
}

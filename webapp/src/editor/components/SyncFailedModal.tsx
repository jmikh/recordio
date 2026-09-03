import { Modal, Button } from '@shared/components';
import { useSyncStatusStore } from '../../storage/syncStatusStore';
import { TbCloudOff } from 'react-icons/tb';

/**
 * Blocking modal shown when media upload fails after retries.
 * Cannot be dismissed — user must retry or the upload must succeed.
 */
export function SyncFailedModal({ onRetry }: { onRetry: () => void }) {
    const error = useSyncStatusStore(s => s.error);
    const status = useSyncStatusStore(s => s.status);

    if (status !== 'error' || !error) return null;

    return (
        <Modal isOpen onClose={() => {}} maxWidth="max-w-[460px]">
            <div className="flex items-center gap-3 mb-4">
                <TbCloudOff className="icon-lg text-destructive shrink-0" />
                <h2 className="heading-2">
                    Failed to sync project
                </h2>
            </div>

            <p className="text-sm text-text-main mb-2">
                Your project media could not be uploaded to the cloud.
            </p>

            <div className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-[var(--radius-sm)] text-xs mb-6">
                {error}
            </div>

            <p className="text-xs text-text-muted mb-6">
                Your recording is safe locally. Please check your connection and try again.
            </p>

            <Button variant="primary" onClick={onRetry} className="w-full">
                Retry sync
            </Button>
        </Modal>
    );
}

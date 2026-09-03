import { Button } from '@shared/components';
import { useSyncStatusStore } from './syncStatusStore';

/**
 * Floating bottom-right toast that surfaces the in-flight media upload.
 * Reads from useSyncStatusStore — the upload itself is kicked off in
 * CloudProjectService.startMediaUpload and runs independently of any page.
 *
 * Shows progress while uploading; flips to an error card with a retry button
 * on terminal failure. Auto-hides once the upload completes (currentUpload
 * cleared by uploadMediaV2).
 */
export function UploadProgressToast() {
    const currentUpload = useSyncStatusStore(s => s.currentUpload);
    const mediaUploadError = useSyncStatusStore(s => s.mediaUploadError);

    if (mediaUploadError) {
        return (
            <div className="fixed bottom-4 right-4 z-50 w-80 bg-surface-raised border border-destructive/30 rounded-[var(--radius-lg)] shadow-float p-4">
                <div className="text-sm text-text-highlighted truncate">
                    Upload failed
                </div>
                <div className="text-xs text-text-muted truncate mt-1">
                    {mediaUploadError.projectName ?? 'Recording'}
                </div>
                <div className="text-xs text-destructive mt-2 line-clamp-2">
                    {mediaUploadError.message}
                </div>
                <div className="flex justify-end gap-2 mt-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => useSyncStatusStore.getState().setMediaUploadError(null)}
                    >
                        Dismiss
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                            const retry = mediaUploadError.onRetry;
                            useSyncStatusStore.getState().setMediaUploadError(null);
                            retry();
                        }}
                    >
                        Retry
                    </Button>
                </div>
            </div>
        );
    }

    if (!currentUpload || currentUpload.type !== 'media') return null;

    const pct = Math.round(currentUpload.progress * 100);

    return (
        <div className="fixed bottom-4 right-4 z-50 w-80 bg-surface-raised border border-border rounded-[var(--radius-lg)] shadow-float p-4">
            <div className="text-sm text-text-highlighted truncate">
                Uploading recording
            </div>
            <div className="text-xs text-text-muted truncate mt-1">
                {currentUpload.projectName ?? 'Recording'}
            </div>
            <div className="mt-3 h-1.5 w-full bg-state-inactive rounded-full overflow-hidden">
                <div
                    className="h-full bg-primary transition-[width] duration-200"
                    style={{ width: `${pct}%` }}
                />
            </div>
            <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-text-muted">{pct}%</span>
                <span className="text-xs text-text-muted">Don't close this tab</span>
            </div>
        </div>
    );
}

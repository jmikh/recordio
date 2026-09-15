/**
 * Forced-choice modal when an autosave loses the compare-and-set: load
 * the cloud version (drops local edits + history) or overwrite it.
 * Screenshot counterpart of editor/components/ConflictModal.
 */
import { useState } from 'react';
import { LuCloudDownload, LuCloudUpload } from 'react-icons/lu';
import { Modal } from '@shared/components';
import { useSyncStatusStore } from '../../storage/syncStatusStore';
import { captureError } from '../../lib/sentry';
import { ScreenshotService } from '../screenshotService';
import { replaceScreenshotDoc, useScreenshotStore } from '../store/useScreenshotStore';
import { useScreenshotMetaStore } from '../store/useScreenshotMetaStore';
import { useScreenshotUIStore } from '../store/useScreenshotUIStore';

export function ScreenshotConflictModal() {
    const conflict = useSyncStatusStore(s => s.screenshotConflict);
    const [loading, setLoading] = useState<'load' | 'overwrite' | null>(null);

    if (!conflict) return null;
    const { screenshotId } = conflict;

    const handleLoadCloud = async () => {
        setLoading('load');
        try {
            const result = await ScreenshotService.loadScreenshot({ screenshotId });
            if (result) {
                URL.revokeObjectURL(result.imageUrl); // the editor keeps its own copy of the source
                replaceScreenshotDoc(result.doc, result.meta.name);
                useScreenshotMetaStore.getState().setMeta(result.meta);
                useScreenshotUIStore.getState().select(null);
            }
            useSyncStatusStore.getState().clearScreenshotConflict();
        } catch (err) {
            captureError(err, { flow: 'screenshot_conflict', phase: 'load_cloud', extra: { screenshotId } });
        } finally {
            setLoading(null);
        }
    };

    const handleOverwriteCloud = async () => {
        setLoading('overwrite');
        try {
            const doc = useScreenshotStore.getState().doc;
            if (doc) {
                const version = await ScreenshotService.forceSave(doc);
                useScreenshotMetaStore.getState().setCloudVersion(version);
            }
            useSyncStatusStore.getState().clearScreenshotConflict();
        } catch (err) {
            captureError(err, { flow: 'screenshot_conflict', phase: 'overwrite', extra: { screenshotId } });
        } finally {
            setLoading(null);
        }
    };

    const optionClass = 'flex items-center gap-3 w-full px-4 py-3 bg-surface-raised hover:bg-state-hover text-text-highlighted rounded-[var(--radius-interactive)] border border-border transition-colors disabled:opacity-50 text-left cursor-pointer';

    // onClose is a no-op — the modal cannot be dismissed without choosing
    return (
        <Modal isOpen onClose={() => {}} maxWidth="max-w-[460px]" ariaLabel="Sync conflict">
            <div className="mb-2">
                <h2 className="heading-2">Sync conflict</h2>
            </div>
            <p className="text-sm text-text-main mb-6">
                Your changes could not be saved because this screenshot was modified elsewhere. Choose how to resolve:
            </p>
            <div className="flex flex-col gap-3">
                <button type="button" onClick={handleLoadCloud} disabled={loading !== null} className={optionClass}>
                    <LuCloudDownload className="icon-lg shrink-0 text-primary" />
                    <div>
                        <div className="text-sm">{loading === 'load' ? 'Loading...' : 'Load cloud version'}</div>
                        <div className="text-xs text-text-muted mt-0.5">Discard your local changes and use the other version</div>
                    </div>
                </button>
                <button type="button" onClick={handleOverwriteCloud} disabled={loading !== null} className={optionClass}>
                    <LuCloudUpload className="icon-lg shrink-0 text-text-muted" />
                    <div>
                        <div className="text-sm">{loading === 'overwrite' ? 'Saving...' : 'Overwrite cloud'}</div>
                        <div className="text-xs text-text-muted mt-0.5">Keep your local changes and replace the cloud version</div>
                    </div>
                </button>
            </div>
        </Modal>
    );
}

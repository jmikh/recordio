import { useState } from 'react';
import { Modal } from '@shared/components';
import { useSyncStatusStore } from '../../storage/syncStatusStore';
import { CloudProjectService } from '../../storage/cloudProjectService';
import { useProjectStore } from '../stores/useProjectStore';
import { useUserStore } from '../stores/useUserStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { navigate } from '../../navigate';
import { captureError } from '../../utils/sentry';
import { TbCloudDown, TbCloudUp } from 'react-icons/tb';

/**
 * Forced-choice modal shown when a cloud sync write fails due to version conflict.
 * Cannot be dismissed — user must choose to load cloud version or overwrite it.
 * If a pending navigation was set (user was leaving the editor), navigates after resolution.
 */
export function ConflictModal() {
    const conflict = useSyncStatusStore(s => s.conflict);
    const [loading, setLoading] = useState<'load' | 'overwrite' | null>(null);

    if (!conflict) return null;

    const afterResolve = () => {
        const nav = useSyncStatusStore.getState().pendingNavigation;
        if (nav) {
            navigate(nav);
        }
    };

    const handleLoadCloud = async () => {
        setLoading('load');
        try {
            const result = await CloudProjectService.resolveConflictReload(conflict.projectId);
            if (result) {
                useProjectStore.getState().loadProject(result.project, result.name);
            }
            afterResolve();
        } catch (err) {
            captureError(err, { flow: 'conflict', phase: 'load_cloud', projectId: conflict.projectId });
        } finally {
            setLoading(null);
        }
    };

    const handleOverwriteCloud = async () => {
        setLoading('overwrite');
        try {
            const { project, userEvents } = useProjectStore.getState();
            const fullProject = { ...project, userEvents };
            const { userId } = useUserStore.getState();
            if (userId) {
                await CloudProjectService.resolveConflictForce(fullProject, userId);
            }
            afterResolve();
        } catch (err) {
            captureError(err, { flow: 'conflict', phase: 'overwrite', projectId: conflict.projectId });
        } finally {
            setLoading(null);
        }
    };

    // onClose is a no-op — modal cannot be dismissed without choosing
    return (
        <Modal isOpen onClose={() => {}} maxWidth="max-w-[460px]">
            <div className="mb-2">
                <h2 className="text-lg font-semibold text-text-highlighted">
                    Sync conflict
                </h2>
            </div>

            <p className="text-sm text-text-main mb-6">
                Failed to sync your local changes because
                the project was modified on another device. Choose how to resolve:
            </p>

            <div className="flex flex-col gap-3">
                <button
                    onClick={handleLoadCloud}
                    disabled={loading !== null}
                    className="flex items-center gap-3 w-full px-4 py-3 bg-surface-raised hover:bg-state-hover text-text-highlighted rounded-[var(--radius-interactive)] border border-border transition-colors disabled:opacity-50 text-left"
                >
                    <TbCloudDown className="icon-lg shrink-0 text-primary" />
                    <div>
                        <div className="text-sm font-medium">
                            {loading === 'load' ? 'Loading...' : 'Load cloud version'}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">
                            Discard your local changes and use the version from the other device
                        </div>
                    </div>
                </button>

                <button
                    onClick={handleOverwriteCloud}
                    disabled={loading !== null}
                    className="flex items-center gap-3 w-full px-4 py-3 bg-surface-raised hover:bg-state-hover text-text-highlighted rounded-[var(--radius-interactive)] border border-border transition-colors disabled:opacity-50 text-left"
                >
                    <TbCloudUp className="icon-lg shrink-0 text-text-muted" />
                    <div>
                        <div className="text-sm font-medium">
                            {loading === 'overwrite' ? 'Saving...' : 'Overwrite cloud'}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">
                            Keep your local changes and replace the cloud version
                        </div>
                    </div>
                </button>
            </div>
        </Modal>
    );
}

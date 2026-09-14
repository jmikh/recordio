import { useState, useCallback } from 'react';
import { useProjectData, useProjectName, useProjectHistory } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { LuCloudUpload, LuDownload, LuRedo2, LuShare2, LuUndo2 } from 'react-icons/lu';

import { AuthModal } from '../../../auth/AuthModal';
import { SupportModal } from '../../../components/SupportModal';
import { ProUpgradeModal } from '../../../billing/ProUpgradeModal';
import { UserMenu } from '../../../components/UserMenu';
import { useUserStore } from '../../../auth/useUserStore';

import { trackDownloadClicked } from '../../../analytics';
import { useEntitlements } from '../../../billing/useEntitlements';
import { useSyncStatusStore } from '../../../storage/syncStatusStore';
import { useCloudRender } from '../settings/useCloudRender';
import { DownloadModal } from '../settings/DownloadModal';
import { SetAsDefaultsButton } from './SetAsDefaultsButton';
import { ProjectNameField } from './ProjectNameField';

import { Button, Tooltip } from '@shared/components';
import type { ExportQuality } from '@shared/utils/exportQuality';
import { useToast } from '../../../components/Toast';
import { ShareModal } from '../../../share/ShareModal';
import { useProjectMetaStore } from '../../../share/useProjectMetaStore';

function SyncIndicator() {
    const pendingMediaUploads = useSyncStatusStore(s => s.pendingMediaUploads);
    const uploadProgress = useSyncStatusStore(s => s.currentUpload?.progress);

    if (pendingMediaUploads <= 0) return null;

    const pct = uploadProgress != null ? `${Math.round(uploadProgress * 100)}%` : '';
    const tooltipText = pct ? `Syncing to cloud... ${pct}` : 'Syncing to cloud...';

    return (
        <Tooltip text={tooltipText}>
            <div className="flex items-center">
                <LuCloudUpload className="icon-md text-primary animate-pulse" />
            </div>
        </Tooltip>
    );
}

export const Header = () => {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const [isProModalOpen, setIsProModalOpen] = useState(false);
    const { isAuthenticated } = useUserStore();
    const entitlements = useEntitlements();
    const isSyncingMedia = useSyncStatusStore(s => s.pendingMediaUploads) > 0;

    const { addToast } = useToast();

    const project = useProjectData();
    const projectName = useProjectName();

    // Cloud render hook
    const cloudRender = useCloudRender({ onToast: addToast });
    const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

    const handleDownload = () => {
        trackDownloadClicked(project.id);
        if (cloudRender.isActive) {
            setIsDownloadModalOpen(true);
            return;
        }
        if (!isAuthenticated) {
            setIsAuthModalOpen(true);
            return;
        }
        setIsDownloadModalOpen(true);
    };

    const handleStartCloudRender = useCallback((quality: ExportQuality) => {
        cloudRender.startCloudRender(project.id, projectName, quality);
    }, [cloudRender.startCloudRender, project.id, projectName]);

    const downloadBusy = cloudRender.isActive || isSyncingMedia;
    const progressPct = Math.round(cloudRender.progress * 100);

    // Share modal (share-access model) — settings + copy link live there
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const shareReady = useProjectMetaStore(s => s.meta !== null);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const pastStates = useProjectHistory(state => state.pastStates);
    const futureStates = useProjectHistory(state => state.futureStates);

    return (
        <div id="editor-header" className="bg-surface border border-border rounded-xl mt-1 mr-1 flex flex-col shrink-0 z-[var(--z-index-navbar)] select-none">
            {/* Top Row: Main Controls */}
            <div className="h-header flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            icon={LuUndo2}
                            onClick={() => undo()}
                            disabled={pastStates.length === 0}
                            title="Undo (Cmd+Z)"
                        />
                        <Button
                            variant="ghost"
                            icon={LuRedo2}
                            onClick={() => redo()}
                            disabled={futureStates.length === 0}
                            title="Redo (Cmd+Shift+Z)"
                        />
                    </div>

                    {/* Personal defaults (plans/user-default-project-settings) */}
                    <div className="h-4 w-[1px] bg-border"></div>
                    <SetAsDefaultsButton />

                    {import.meta.env.MODE !== 'production' && (
                        <>
                            <div className="h-4 w-[1px] bg-border mx-2"></div>

                            {<Button
                                variant="ghost"
                                onClick={() => useUIStore.getState().toggleDebugBar()}
                                title="Toggle Debug Bar"
                                className="px-2 py-1 h-auto"
                            >
                                Debug
                            </Button>}
                        </>
                    )}
                </div>

                {/* Project Name (Centered) */}
                <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    <SyncIndicator />
                    <ProjectNameField />
                </div>

                <div className="flex items-center gap-3">
                    <Tooltip text={isSyncingMedia ? "Syncing to cloud..." : ""}>
                        <div className="relative">
                            <Button
                                variant="base"
                                onClick={handleDownload}
                                disabled={downloadBusy}
                                className="text-sm px-3"
                            >
                                {cloudRender.phase === 'rendering' || cloudRender.phase === 'queued' || cloudRender.phase === 'saving' ? (
                                    <>
                                        <div className="h-4 w-4 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin" />
                                        Rendering...
                                    </>
                                ) : cloudRender.phase === 'downloading' ? (
                                    <>
                                        <div className="h-4 w-4 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin" />
                                        Downloading...
                                    </>
                                ) : (
                                    <>
                                        <LuDownload className="icon-sm" />
                                        Download
                                    </>
                                )}
                            </Button>
                            {cloudRender.isActive && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border-default rounded-b overflow-hidden">
                                    <div
                                        className="h-full bg-primary transition-all duration-300"
                                        style={{ width: `${progressPct}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    </Tooltip>

                    <Button
                        variant="primary"
                        icon={LuShare2}
                        disabled={entitlements.canShare && !shareReady}
                        onClick={() => (entitlements.canShare ? setIsShareModalOpen(true) : setIsProModalOpen(true))}
                    >
                        Share
                    </Button>

                    {isAuthenticated ? (
                        <div className="ml-1">
                            <UserMenu
                                onOpenSupportModal={() => setIsSupportModalOpen(true)}
                            />
                        </div>
                    ) : (
                        <Button variant="ghost" onClick={() => setIsAuthModalOpen(true)} title="Sign in to unlock Pro features">
                            Sign In
                        </Button>
                    )}
                </div>
            </div>

            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
                onAuthSuccess={() => { }}
            />
            <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
            <ShareModal
                isOpen={isShareModalOpen}
                onClose={() => setIsShareModalOpen(false)}
                projectName={projectName}
            />
            <ProUpgradeModal
                isOpen={isProModalOpen}
                onClose={() => setIsProModalOpen(false)}
                feature="publishing"
                reason="share"
            />

            <DownloadModal
                isOpen={isDownloadModalOpen}
                onClose={() => setIsDownloadModalOpen(false)}
                cloudPhase={cloudRender.phase}
                cloudProgress={cloudRender.progress}
                onStartCloudRender={handleStartCloudRender}
            />
        </div>
    );
};


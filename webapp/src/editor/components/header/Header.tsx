import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectStore, useProjectData, useProjectName, useProjectHistory } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { LuUndo2, LuRedo2 } from 'react-icons/lu';

import { AuthModal } from '../../../auth/AuthModal';
import { SupportModal } from '../../../components/SupportModal';
import { ProUpgradeModal } from '../../../billing/ProUpgradeModal';
import { navigate } from '../../../lib/navigate';
import { UserMenu } from '../../../components/UserMenu';
import { useUserStore } from '../../../auth/useUserStore';

import { trackDownloadClicked } from '../../../analytics';
import { useEntitlements } from '../../../billing/useEntitlements';
import { CloudProjectService } from '../../../storage/cloudProjectService';
import { useSyncStatusStore } from '../../../storage/syncStatusStore';
import { useCloudRender } from '../settings/useCloudRender';
import { DownloadModal } from '../settings/DownloadModal';

import { TbCloudUpload, TbDownload, TbShare2 } from 'react-icons/tb';
import { Dropdown, Button, Tooltip, LogoLink, type DropdownOption } from '@shared/components';
import { ASPECT_RATIO_PRESETS, findPreset, type AspectRatioPreset } from '@shared/utils/aspectRatio';
import type { ExportQuality } from '@shared/utils/exportQuality';
import { useToast } from '../../../components/Toast';
import { ShareModal } from './ShareModal';
import { useProjectMetaStore } from '../../stores/useProjectMetaStore';

const aspectRatioOptions: DropdownOption<AspectRatioPreset>[] = ASPECT_RATIO_PRESETS.map(preset => ({
    value: preset,
    label: preset.label,
    suffix: preset.orientation ? <span className="text-text-muted text-xs">{preset.orientation}</span> : undefined,
}));

function SyncIndicator() {
    const pendingMediaUploads = useSyncStatusStore(s => s.pendingMediaUploads);
    const uploadProgress = useSyncStatusStore(s => s.currentUpload?.progress);

    if (pendingMediaUploads <= 0) return null;

    const pct = uploadProgress != null ? `${Math.round(uploadProgress * 100)}%` : '';
    const tooltipText = pct ? `Syncing to cloud... ${pct}` : 'Syncing to cloud...';

    return (
        <Tooltip text={tooltipText}>
            <div className="flex items-center">
                <TbCloudUpload className="icon-md text-primary animate-pulse" />
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
    const updateProjectName = useProjectStore(s => s.updateProjectName);
    const [localName, setLocalName] = useState(projectName);
    const localNameRef = useRef(localName);
    localNameRef.current = localName;

    // Sync local state when store name changes externally (e.g. project load)
    useEffect(() => { setLocalName(projectName); }, [projectName]);

    const outputSize = useProjectStore(s => s.project.settings.outputSize);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const resetZooms = useProjectStore(s => s.resetZooms);
    const resetSpotlights = useProjectStore(s => s.resetSpotlights);
    const currentPreset = findPreset(outputSize);

    const handleAspectRatioChange = (preset: AspectRatioPreset) => {
        updateSettings({ outputSize: { width: preset.width, height: preset.height } });
        resetZooms();
        resetSpotlights();

        const store = useProjectStore.getState().project.timeline;
        const hasZooms = store.zoomSegments.length > 0;
        const hasSpotlights = store.spotlightSegments.length > 0;
        if (hasZooms || hasSpotlights) {
            const parts = [hasZooms && 'zooms', hasSpotlights && 'spotlights'].filter(Boolean);
            addToast({ type: 'info', title: 'Recalculated', message: `Auto ${parts.join(' & ')} updated for new aspect ratio` });
        }
    };
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const pastStates = useProjectHistory(state => state.pastStates);
    const futureStates = useProjectHistory(state => state.futureStates);

    const handleGoToDashboard = async () => {
        const { userId } = useUserStore.getState();
        if (userId) {
            const { project: proj, userEvents } = useProjectStore.getState();
            const fullProject = { ...proj, userEvents };
            await CloudProjectService.saveProject(fullProject, userId);

            if (useSyncStatusStore.getState().conflict) {
                useSyncStatusStore.getState().setPendingNavigation('/');
                return;
            }
        }
        navigate('/');
    };



    return (
        <div id="editor-header" className="bg-surface border-b border-border flex flex-col shrink-0 z-[var(--z-index-navbar)] select-none">
            {/* Top Row: Main Controls */}
            <div className="h-header flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        onClick={handleGoToDashboard}
                        aria-label="Back to Dashboard"
                        title="Back to Dashboard"
                    >
                        <LogoLink imgClassName="h-6" />
                    </Button>
                    <div className="h-4 w-[1px] bg-border mx-2"></div>

                    <div className="flex items-center gap-1">
                        <Button
                            variant="icon"
                            icon={LuUndo2}
                            onClick={() => undo()}
                            disabled={pastStates.length === 0}
                            title="Undo (Cmd+Z)"
                        />
                        <Button
                            variant="icon"
                            icon={LuRedo2}
                            onClick={() => redo()}
                            disabled={futureStates.length === 0}
                            title="Redo (Cmd+Shift+Z)"
                        />
                        {true && <span className="text-2xs text-text-muted ml-1 tabular-nums">
                            {pastStates.length}/{pastStates.length + futureStates.length}
                        </span>}
                    </div>

                    {import.meta.env.MODE !== 'production' && (
                        <>
                            <div className="h-4 w-[1px] bg-border mx-2"></div>

                            {<Button
                                variant="ghost"
                                size="sm"
                                onClick={() => useUIStore.getState().toggleDebugBar()}
                                title="Toggle Debug Bar"
                                className="px-2 py-1 h-auto"
                            >
                                Debug
                            </Button>}
                        </>
                    )}
                </div>

                {/* Project Name + Aspect Ratio + Share Link (Centered) */}
                <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    <SyncIndicator />
                    <input
                        id="project-name-input"
                        type="text"
                        value={localName}
                        onChange={(e) => setLocalName(e.target.value)}
                        onBlur={() => {
                            if (localNameRef.current !== projectName) {
                                updateProjectName(localNameRef.current);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        maxLength={40}
                        className="h-9 bg-state-inactive text-text-main text-sm text-center border border-border focus:text-text-highlighted hover:bg-state-hover hover:border-border-highlighted focus:bg-state-hover focus:border-border-highlighted rounded-[var(--radius-interactive)] px-2 transition-colors placeholder-text-main w-[240px] focus-ring"
                        placeholder="Untitled Project"
                    />
                    <Dropdown
                        options={aspectRatioOptions}
                        value={currentPreset}
                        onChange={handleAspectRatioChange}
                        fullWidth={false}
                        buttonClassName="px-2 text-xs"
                        hideSuffixInTrigger
                    />
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
                                        <TbDownload className="icon-sm" />
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
                        icon={TbShare2}
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
            <ShareModal isOpen={isShareModalOpen} onClose={() => setIsShareModalOpen(false)} />
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


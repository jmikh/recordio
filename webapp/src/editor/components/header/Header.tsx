import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectStore, useProjectData, useProjectName, useProjectHistory } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { LuUndo2, LuRedo2 } from 'react-icons/lu';

import { AuthModal } from './AuthModal';
import { SupportModal } from '../../../components/SupportModal';
import { navigate } from '../../../navigate';
import { UserMenu } from '../../../components/UserMenu';
import { UpgradeModal } from './UpgradeModal';
import { useUserStore } from '../../stores/useUserStore';
import { CloudProjectService } from '../../../storage/cloudProjectService';
import { useSyncStatusStore } from '../../../storage/syncStatusStore';
import { useCloudRender } from '../settings/useCloudRender';
import { DownloadModal } from '../settings/DownloadModal';

import { TbCloudUpload, TbDownload, TbLink } from 'react-icons/tb';
import { Dropdown, Button, Tooltip, type DropdownOption } from '@shared/components';
import { ASPECT_RATIO_PRESETS, findPreset, type AspectRatioPreset } from '@shared/utils/aspectRatio';
import { useToast } from '../Toast';
import { supabase } from '../../../auth/AuthManager';
import { EDITOR_ORIGIN_PROD } from '@shared/types/bridge';

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

const VIDEO_BASE_URL = import.meta.env.PROD
    ? `${EDITOR_ORIGIN_PROD}/video`
    : 'http://localhost:3001/video';

export const Header = () => {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const { isAuthenticated, isPro, hasProAccess } = useUserStore();
    const isSyncingMedia = useSyncStatusStore(s => s.pendingMediaUploads) > 0;

    const { addToast } = useToast();

    const project = useProjectData();
    const projectName = useProjectName();

    // Cloud render hook
    const cloudRender = useCloudRender({ onToast: addToast });
    const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

    const handleDownload = () => {
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

    const handleStartCloudRender = useCallback(() => {
        cloudRender.startCloudRender(project.id, projectName, isPro);
    }, [cloudRender.startCloudRender, project.id, projectName, isPro]);

    const downloadBusy = cloudRender.isActive || isSyncingMedia;
    const progressPct = Math.round(cloudRender.progress * 100);

    // Share/publish state
    const [shareSlug, setShareSlug] = useState<string | null>(null);
    const [isSharing, setIsSharing] = useState(false);

    useEffect(() => {
        if (!isAuthenticated || !project?.id || !supabase) return;
        supabase
            .rpc('project_get', { p_project_id: project.id })
            .then(({ data }) => {
                if (data?.share_slug) setShareSlug(data.share_slug);
            });
    }, [isAuthenticated, project?.id]);

    const copyShareLink = async (slug: string) => {
        const url = `${VIDEO_BASE_URL}/${slug}`;
        try {
            await navigator.clipboard.writeText(url);
            addToast({ type: 'success', title: 'Link copied to clipboard' });
        } catch {
            addToast({ type: 'error', title: 'Failed to copy link' });
        }
    };

    const handleShare = async () => {
        if (!supabase || !project?.id || isSharing) return;
        setIsSharing(true);
        try {
            let slug = shareSlug;
            if (!slug) {
                const { data, error } = await supabase
                    .rpc('project_share', { p_project_id: project.id })
                    .single() as { data: { slug: string; is_new: boolean } | null; error: any };
                if (error || !data) throw error;
                slug = data.slug;
                setShareSlug(slug);
            }
            await copyShareLink(slug);
            const cloudVersion = CloudProjectService.getCloudVersion(project.id);
            if (cloudVersion !== undefined) {
                supabase.functions.invoke('mux-video-create', {
                    body: { projectId: project.id, cloudVersion },
                }).catch(err => console.error('[Share] mux-video-create failed:', err));
            }
        } catch (e: any) {
            console.error('[Share] Failed:', e);
            addToast({ type: 'error', title: 'Share failed', message: e?.message || 'Unknown error' });
        } finally {
            setIsSharing(false);
        }
    };
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
        const { userId, isPro } = useUserStore.getState();
        if (userId) {
            const { project: proj, userEvents } = useProjectStore.getState();
            const fullProject = { ...proj, userEvents };
            await CloudProjectService.saveProject(fullProject, userId, isPro);

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
            <div className="h-12 flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <button onClick={handleGoToDashboard} className="cursor-pointer opacity-90 hover:opacity-100 transition-opacity duration-200">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 628 628">
                            <path d="M305.5024 628H322.4976C412.1471 628 465.9367 628 501.7965 613.029 553.4915 594.2136 594.2136 553.4915 613.029 501.7965 628 465.9367 628 412.1471 628 322.4976V305.5024C628 215.8529 628 162.0633 613.029 126.2035 594.2136 74.50852 553.4915 33.78641 501.7965 14.97098 465.9367 0 412.1471 0 322.4976 0H305.5024C215.8529 0 162.0633 0 126.2035 14.97098 74.50852 33.78641 33.78641 74.50852 14.97098 126.2035 0 162.0633 0 215.8529 0 305.5024V322.4976C0 412.1471 0 465.9367 14.97098 501.7965 33.78641 553.4915 74.50852 594.2136 126.2035 613.029 162.0633 628 215.8529 628 305.5024 628Z" fill="#7d5ee0"/>
                            <path transform="matrix(1,0,0,-1,0,628)" d="M130.1325 536 205.0049 461.8536H156.5268C153.8046 461.8639 151.0693 461.6751 148.3698 461.3226 119.8525 457.5993 97.08818 435.6359 92.66317 407.223 92.2433 404.5269 92.04774 401.8528 92 399.1246V239.6137H218.0031C220.0154 239.665 222.0323 240.004 223.9716 240.543 231.5277 242.643 237.6641 248.0974 240.0868 255.4785 240.6015 257.0476 240.9533 258.6775 241.0815 260.3242V388.3711H365.1614C368.0465 388.4573 370.9029 389.0265 373.5837 390.0969 379.863 392.6044 384.7985 397.4691 387.3777 403.5721 388.2811 405.7098 388.9062 407.9703 389.1683 410.2764V536H130.1325Z" fill="#f8f6eb"/>
                            <path transform="matrix(1,0,0,-1,0,628)" d="M497.8675 92 422.9951 166.1464H471.4732C474.1954 166.1361 476.9307 166.325 479.6302 166.6774 508.1475 170.4007 530.9118 192.3641 535.3368 220.777 535.7567 223.4731 535.9523 226.1472 536 228.8754V388.3863H409.9969C407.9846 388.335 405.9677 387.996 404.0284 387.457 396.4723 385.357 390.3359 379.9026 387.9132 372.5215 387.3985 370.9524 387.0467 369.3225 386.9185 367.6758V239.6289H262.8386C259.9535 239.5427 257.0971 238.9735 254.4163 237.9031 248.137 235.3956 243.2015 230.5309 240.6223 224.4279 239.7189 222.2902 239.0938 220.0297 238.8317 217.7236V92H497.8675Z" fill="#f8f6eb"/>
                        </svg>
                    </button>
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
                        {true && <span className="text-[10px] text-text-muted ml-1 tabular-nums">
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

                    <div className="flex rounded-[var(--radius-interactive)] overflow-hidden">
                        <button
                            onClick={hasProAccess() ? handleShare : () => setIsUpgradeModalOpen(true)}
                            disabled={isSharing || isSyncingMedia}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-3 text-sm font-medium border-none cursor-pointer transition-colors
                                bg-primary text-white hover:bg-primary-highlighted
                                ${(isSharing || isSyncingMedia) ? 'opacity-50 cursor-not-allowed' : ''}
                            `}
                        >
                            {isSharing ? 'Publishing...' : shareSlug ? 'Republish' : 'Publish'}
                        </button>
                        <button
                            onClick={() => hasProAccess() ? (shareSlug && copyShareLink(shareSlug)) : setIsUpgradeModalOpen(true)}
                            disabled={hasProAccess() && !shareSlug}
                            className={`flex items-center justify-center px-2 py-1.5 border-none cursor-pointer transition-colors border-l border-white/20
                                ${shareSlug
                                    ? 'bg-primary/80 text-white hover:bg-primary'
                                    : 'bg-primary/40 text-white/50 cursor-not-allowed'}
                            `}
                        >
                            <TbLink className="icon-sm" />
                        </button>
                    </div>

                    {isAuthenticated ? (
                        <div className="ml-1">
                            <UserMenu
                                onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)}
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
            <UpgradeModal
                isOpen={isUpgradeModalOpen}
                onClose={() => setIsUpgradeModalOpen(false)}
                onSignInRequest={() => setIsAuthModalOpen(true)}
            />
            <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />

            <DownloadModal
                isOpen={isDownloadModalOpen}
                onClose={() => setIsDownloadModalOpen(false)}
                hasProAccess={hasProAccess()}
                cloudPhase={cloudRender.phase}
                cloudProgress={cloudRender.progress}
                onStartCloudRender={handleStartCloudRender}
                onUpgrade={() => setIsUpgradeModalOpen(true)}
            />
        </div>
    );
};


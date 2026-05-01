import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { BackgroundSettings } from './BackgroundSettings';
import { ScreenSettings } from './ScreenSettings';
import { EffectsSettings } from './EffectsSettings';
import { CameraSettings } from './CameraSettings';
import { CaptionsSettings } from './CaptionsSettings';
import { AudioSettingsPanel } from './AudioSettings';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';
import { Scrollbar, Button, Tooltip } from '@shared/components';
import { useProjectStore, useProjectName } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import { useSyncStatusStore } from '../../../storage/syncStatusStore';
import type { SettingsPanelTab } from '../../stores/useUIStore';
import { ClipInspector } from './ClipInspector';
import { SpotlightInspector } from './SpotlightInspector';
import { ZoomInspector } from './ZoomInspector';
import { CameraMoveInspector } from './CameraMoveInspector';
import { OverlayInspector } from './OverlayInspector';
import { TbDeviceDesktop, TbBackground, TbArticle, TbMusic, TbClick, TbLink, TbDownload } from 'react-icons/tb';
import { PiWebcamBold } from 'react-icons/pi';
import { LuChevronRight } from 'react-icons/lu';
import { supabase } from '../../../auth/AuthManager';
import { useToast } from '../Toast';
import { CloudProjectService } from '../../../storage/cloudProjectService';
import { AuthModal } from '../header/AuthModal';



// Reusable button for settings panel actions (e.g., "Crop Screen", "Edit Camera")
interface SettingsPanelButtonProps {
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
    label?: string;
    className?: string;
    variant?: 'default' | 'primary';
}

export const SettingsPanelButton: React.FC<SettingsPanelButtonProps> = ({
    icon, isActive, onClick, label, className = '', variant = 'default'
}) => {
    const isPrimary = variant === 'primary';

    return (
        <button
            onClick={onClick}
            className={`
                group flex items-center gap-4 py-3 px-4 border-none rounded-lg cursor-pointer transition-colors duration-200
                ${isPrimary
                    ? isActive
                        ? 'bg-primary text-white'
                        : 'bg-primary/80 text-white hover:bg-primary'
                    : isActive
                        ? 'bg-primary/15 text-primary'
                        : 'bg-state-inactive text-text-muted hover:bg-state-hover hover:text-text-main'}
                ${className}
            `}
        >
            <span className="flex">{icon}</span>
            {label && <span className="text-base font-medium">{label}</span>}
            {isActive && <LuChevronRight className={`icon-sm ${isPrimary ? 'text-white ml-auto' : 'text-primary ml-auto'}`} />}
        </button>
    );
};

const VIDEO_BASE_URL = import.meta.env.PROD
    ? 'https://app.recordio.cc/video'
    : 'http://localhost:3001/video';

export const SettingsPanel = () => {
    const { addToast } = useToast();
    const activeTab = useUIStore(s => s.settingsPanelActiveTab);
    const setActiveTab = useUIStore(s => s.setSettingsPanelActiveTab);
    const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
    const [accentTop, setAccentTop] = useState(0);
    const [accentHeight, setAccentHeight] = useState(0);
    const navRef = useRef<HTMLElement>(null);

    // Tooltip state for disabled tabs
    const [hoveredDisabledTab, setHoveredDisabledTab] = useState<string | null>(null);
    const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });

    const project = useProjectStore(s => s.project);
    const projectName = useProjectName();
    const deselectAllSegments = useUIStore(s => s.deselectAllSegments);
    const hasCameraSource = !!project.cameraSource;
    const isSyncingMedia = useSyncStatusStore(s => s.pendingMediaUploads) > 0;
    const hasMicrophone = !!project.microphoneSource;
    const { isAuthenticated, isPro } = useUserStore();

    // Auth modal for download gating
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

    // ─── Cloud render download ─────────────────────────────────
    const [isRendering, setIsRendering] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [renderProgress, setRenderProgress] = useState(0);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const cleanupRender = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        setIsRendering(false);
        setRenderProgress(0);
    }, []);

    const downloadRender = async (storagePath: string) => {
        setIsRendering(false);
        setIsDownloading(true);
        try {
            const { data, error } = await supabase!.functions.invoke('storage-download-url', {
                body: { storagePath },
            });
            if (error || data?.error) {
                addToast({ type: 'error', title: 'Download failed', message: data?.error || error?.message });
                return;
            }
            const resp = await fetch(data.signedUrl);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectName || 'render'}.mp4`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e: any) {
            addToast({ type: 'error', title: 'Download failed', message: e?.message || 'Unknown error' });
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDownload = async () => {
        if (isRendering || isDownloading) return;

        if (!isAuthenticated) {
            setIsAuthModalOpen(true);
            return;
        }

        setIsRendering(true);
        setRenderProgress(0);

        try {
            // Save to cloud so cloud_version is current
            const userId = useUserStore.getState().userId;
            if (userId) {
                const fullProject = { ...project, userEvents: useProjectStore.getState().userEvents };
                await CloudProjectService.saveProject(fullProject, userId, isPro);
            }

            const cloudVersion = CloudProjectService.getCloudVersion(project.id);
            if (cloudVersion === undefined) {
                addToast({ type: 'error', title: 'Download failed', message: 'Project must be saved to the cloud first.' });
                cleanupRender();
                return;
            }

            // Start render job
            const { data, error } = await supabase!.functions.invoke('render-job-create', {
                body: { projectId: project.id, cloudVersion },
            });

            if (error || data?.error) {
                const msg = data?.message || data?.error || error?.message || 'Failed to start render';
                addToast({ type: 'error', title: 'Render failed', message: msg, duration: 0 });
                cleanupRender();
                return;
            }

            const { jobId, status, renderStoragePath } = data;

            // Cache hit — download immediately
            if (status === 'completed' && renderStoragePath) {
                await downloadRender(renderStoragePath);
                cleanupRender();
                return;
            }

            // Pending — poll for progress
            addToast({ type: 'info', title: 'Rendering video in the cloud' });

            pollRef.current = setInterval(async () => {
                const { data: job } = await supabase!
                    .from('render_jobs')
                    .select('status, progress, error, render_storage_path')
                    .eq('id', jobId)
                    .maybeSingle();

                if (!job) return;
                setRenderProgress(job.progress ?? 0);

                if (job.status === 'completed') {
                    cleanupRender();
                    await downloadRender(job.render_storage_path);
                } else if (job.status === 'failed' || job.status === 'canceled') {
                    cleanupRender();
                    addToast({
                        type: 'error',
                        title: 'Render failed',
                        message: job.error || `Render ${job.status}`,
                        duration: 0,
                    });
                }
            }, 3000);
        } catch (e: any) {
            addToast({ type: 'error', title: 'Render error', message: e?.message || 'Connection failed', duration: 0 });
            cleanupRender();
        }
    };

    const downloadBusy = isRendering || isDownloading || isSyncingMedia;
    const progressPct = Math.round(renderProgress * 100);

    // Share state
    const [shareSlug, setShareSlug] = useState<string | null>(null);
    const [isSharing, setIsSharing] = useState(false);

    // Load existing share slug from project_get data (comes via share_slug field)
    useEffect(() => {
        if (!isAuthenticated || !project?.id || !supabase) return;
        supabase
            .rpc('project_get', { p_project_id: project.id })
            .then(({ data }) => {
                if (data?.share_slug) setShareSlug(data.share_slug);
            });
    }, [isAuthenticated, project?.id]);

    const handleShare = async () => {
        if (!supabase || !project?.id || isSharing) return;

        setIsSharing(true);
        try {
            // 1. Create share link if needed (URL available immediately)
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

            // 2. Get cloudVersion and kick off mux-video-create pipeline
            const cloudVersion = CloudProjectService.getCloudVersion(project.id);
            if (cloudVersion !== undefined) {
                supabase.functions.invoke('mux-video-create', {
                    body: { projectId: project.id, cloudVersion },
                }).catch(err => {
                    console.error('[Share] mux-video-create failed:', err);
                });
            }
        } catch (e: any) {
            console.error('[Share] Failed:', e);
            addToast({ type: 'error', title: 'Share failed', message: e?.message || 'Unknown error' });
        } finally {
            setIsSharing(false);
        }
    };

    const copyShareLink = async (slug: string) => {
        const url = `${VIDEO_BASE_URL}/${slug}`;
        try {
            await navigator.clipboard.writeText(url);
            addToast({ type: 'success', title: 'Link copied to clipboard' });
        } catch {
            addToast({ type: 'error', title: 'Failed to copy link' });
        }
    };

    const handleTabChange = (tab: SettingsPanelTab) => {
        deselectAllSegments();
        setActiveTab(tab);
    };

    const navItems = useMemo(() => {
        const items: { id: SettingsPanelTab; label: string; icon: React.ReactNode; disabled?: boolean; disabledTooltip?: string }[] = [

            { id: 'background', label: 'Background', icon: <TbBackground className="icon-lg" /> },
            { id: 'screen', label: 'Screen', icon: <TbDeviceDesktop className="icon-lg" /> },
            { id: 'effects', label: 'Effects', icon: <TbClick className="icon-lg" /> },
            {
                id: 'camera',
                label: 'Camera',
                icon: <PiWebcamBold className="icon-lg" />,
                disabled: !hasCameraSource,
                disabledTooltip: 'No camera detected'
            },
            {
                id: 'captions',
                label: 'Captions',
                icon: <TbArticle className="icon-lg" />,
            },
            {
                id: 'audio',
                label: 'Audio',
                icon: <TbMusic className="icon-lg" />,
            },
        ];
        return items;
    }, [hasCameraSource, hasMicrophone]);

    // Calculate accent bar position when active tab changes
    useEffect(() => {
        if (!navRef.current) return;
        const activeButton = navRef.current.querySelector(`[data-tab="${activeTab}"]`) as HTMLElement;
        if (activeButton) {
            setAccentTop(activeButton.offsetTop);
            setAccentHeight(activeButton.offsetHeight);
        }
    }, [activeTab, navItems]);

    // Check if any timeline item is selected
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const selectedWindowId = useUIStore(s => s.selectedWindowId);
    const selectedCameraMoveId = useUIStore(s => s.selectedCameraMoveId);
    const selectedOverlaySegmentId = useUIStore(s => s.selectedOverlaySegmentId);
    const hasSelection = !!(selectedZoomId || selectedSpotlightId || selectedWindowId || selectedCameraMoveId || selectedOverlaySegmentId);

    const zoomSegments = useProjectStore(s => s.project.timeline.zoomSegments);
    const spotlightSegments = useProjectStore(s => s.project.timeline.spotlightSegments);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    const cameraMoveSegments = useProjectStore(s => s.project.timeline.cameraMoveSegments);

    const selectedZoom = selectedZoomId ? zoomSegments.find(z => z.id === selectedZoomId) : null;
    const selectedSpotlight = selectedSpotlightId ? spotlightSegments.find(s => s.id === selectedSpotlightId) : null;
    const selectedWindow = selectedWindowId ? outputWindows.find(w => w.id === selectedWindowId) : null;
    const selectedCameraMove = selectedCameraMoveId ? (cameraMoveSegments || []).find(s => s.id === selectedCameraMoveId) : null;

    const overlaySegments = useProjectStore(s => s.project.timeline.overlaySegments);
    const selectedOverlaySegment = selectedOverlaySegmentId ? (overlaySegments || []).find(b => b.id === selectedOverlaySegmentId) : null;

    return (
        <div id="settings-panel" className="flex flex-col h-full border-r border-border bg-surface">
            <div className="flex flex-1 min-h-0">
            {/* Sidebar Navigation */}
            <nav id="settings-nav" ref={navRef} className="relative w-44 flex flex-col py-6 pl-0 pr-3 border-r border-border">
                <div className="flex flex-col gap-0.5 flex-1">
                {/* Sliding accent bar — hidden when inspector is active */}
                {!hasSelection && (
                    <div
                        className="absolute left-0 w-[3px] bg-primary rounded-r-sm transition-all duration-200 ease-out"
                        style={{ top: accentTop, height: accentHeight }}
                    />
                )}

                {navItems.map((item) => {
                    const isActive = activeTab === item.id;
                    const isDisabled = item.disabled;

                    const showActive = isActive && !hasSelection;

                    return (
                        <button
                            key={item.id}
                            data-tab={item.id}
                            onClick={() => !isDisabled && handleTabChange(item.id)}
                            onMouseEnter={(e) => {
                                if (isDisabled && item.disabledTooltip) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setTooltipPosition({
                                        left: rect.right + 8,
                                        top: rect.top + rect.height / 2
                                    });
                                    setHoveredDisabledTab(item.id);
                                }
                            }}
                            onMouseLeave={() => setHoveredDisabledTab(null)}
                            className={`group flex items-center gap-4 py-3 px-4 border-none rounded-r-lg transition-colors duration-200 ${isDisabled
                                ? 'opacity-50 bg-transparent'
                                : showActive
                                    ? 'bg-primary/15 cursor-pointer'
                                    : 'bg-transparent cursor-pointer hover:bg-surface-hover'
                                }`}
                        >
                            <span className={`flex transition-all ${isDisabled
                                ? 'text-text-disabled'
                                : showActive
                                    ? 'text-primary scale-110'
                                    : 'text-text-muted group-hover:text-text-main'
                                }`}>
                                {item.icon}
                            </span>
                            <span className={`text-sm transition-colors ${isDisabled
                                ? 'text-text-disabled font-medium'
                                : showActive
                                    ? 'text-text-highlighted font-semibold'
                                    : 'text-text-muted font-medium group-hover:text-text-main'
                                }`}>
                                {item.label}
                            </span>
                        </button>
                    );
                })}

                <div className="mt-2 mx-3 flex flex-col gap-2">
                    <Tooltip text={isSyncingMedia ? "Syncing to cloud..." : ""}>
                        <div className="relative">
                            <Button
                                variant="base"
                                fullWidth
                                onClick={handleDownload}
                                className="text-sm"
                                disabled={downloadBusy}
                            >
                                {isRendering ? (
                                    <>
                                        <div className="h-4 w-4 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin" />
                                        Rendering...
                                    </>
                                ) : isDownloading ? (
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
                            {isRendering && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border-default rounded-b overflow-hidden">
                                    <div
                                        className="h-full bg-primary transition-all duration-300"
                                        style={{ width: `${progressPct}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    </Tooltip>

                    {/* Share split button */}
                    <div className="flex rounded-lg overflow-hidden">
                        <button
                            onClick={handleShare}
                            disabled={isSharing || isSyncingMedia}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium border-none cursor-pointer transition-colors
                                bg-primary text-white hover:bg-primary-highlighted
                                ${(isSharing || isSyncingMedia) ? 'opacity-50 cursor-not-allowed' : ''}
                            `}
                        >
                            {isSharing ? 'Publishing...' : 'Publish'}
                        </button>
                        <button
                            onClick={() => shareSlug && copyShareLink(shareSlug)}
                            disabled={!shareSlug}
                            className={`flex items-center justify-center px-3 py-2 border-none cursor-pointer transition-colors border-l border-white/20
                                ${shareSlug
                                    ? 'bg-primary/80 text-white hover:bg-primary'
                                    : 'bg-primary/40 text-white/50 cursor-not-allowed'}
                            `}
                        >
                            <TbLink className="icon-md" />
                        </button>
                    </div>
                </div>
                </div>
            </nav>

            {/* Content Area */}
            <div id="settings-content" className="w-80 flex flex-row relative h-full bg-surface-body">
                <div
                    ref={setScrollContainer}
                    className="p-2 flex-1 overflow-y-auto text-text-main custom-scrollbar scrollbar-hide"
                >
                    {hasSelection ? (
                        <>
                            {selectedZoom && <ZoomInspector segment={selectedZoom} />}
                            {selectedSpotlight && <SpotlightInspector segment={selectedSpotlight} />}
                            {selectedWindow && <ClipInspector window={selectedWindow} />}
                            {selectedCameraMove && <CameraMoveInspector segment={selectedCameraMove} />}
                            {selectedOverlaySegment && <OverlayInspector block={selectedOverlaySegment} />}
                        </>
                    ) : (
                        <>

                            {activeTab === 'background' && <BackgroundSettings />}
                            {activeTab === 'screen' && <ScreenSettings />}
                            {activeTab === 'camera' && <CameraSettings />}
                            {activeTab === 'effects' && <EffectsSettings />}
                            {activeTab === 'captions' && <CaptionsSettings />}
                            {activeTab === 'audio' && <AudioSettingsPanel />}
                        </>
                    )}
                </div>
                <Scrollbar
                    container={scrollContainer}
                    orientation="vertical"
                    dependency={activeTab}
                />
            </div>
            </div>

            {/* Preload Device Frames */}
            <div className="hidden">
                {DEVICE_FRAMES.map(frame => (
                    <img key={frame.id} src={frame.thumbnailUrl} alt="" />
                ))}
            </div>

            {/* Auth/Upgrade modals for download gating */}
            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
                onAuthSuccess={() => { }}
            />

            {/* Disabled tab tooltip - rendered via portal */}
            {hoveredDisabledTab && createPortal(
                <div
                    className="fixed z-[999999] bg-surface-raised border border-border rounded-md shadow-float px-3 py-2 text-xs text-text-main whitespace-nowrap"
                    style={{
                        left: tooltipPosition.left,
                        top: tooltipPosition.top,
                        transform: 'translateY(-50%)'
                    }}
                >
                    {navItems.find(item => item.id === hoveredDisabledTab)?.disabledTooltip}
                </div>,
                document.body
            )}
        </div>
    );
};

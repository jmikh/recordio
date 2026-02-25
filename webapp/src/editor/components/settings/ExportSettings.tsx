import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { BiCrown } from 'react-icons/bi';
import { TbSettings2, TbBoxAlignTopLeft, TbBoxAlignTopRight, TbBoxAlignBottomLeft, TbBoxAlignBottomRight, TbLink, TbDownload } from 'react-icons/tb';
import { CollapsibleCard, MultiToggle, Dropdown, Toggle, Tooltip } from '@shared/components';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import { ExportManager } from '../../export/ExportManager';
import type { ExportQuality, ExportFps } from '../../export/ExportManager';
import type { WatermarkPosition } from '../../../core/painters/watermarkPainter';
import { trackExportCompleted } from '../../../core/analytics';
import { TimeMapper } from '../../../core/mappers/timeMapper';
import { useToast } from '../Toast';
import { ShareService, type SharedVideo, MAX_SHARED_VIDEOS } from '../../services/ShareService';

import { AuthModal } from '../header/AuthModal';
import { UpgradeModal } from '../header/UpgradeModal';



const QUALITY_OPTIONS: { value: ExportQuality; label: string; proOnly: boolean }[] = [
    { value: '480p', label: '480p', proOnly: false },
    { value: '720p', label: '720p', proOnly: false },
    { value: '1080p', label: '1080p', proOnly: true },
    { value: '2K', label: '2K', proOnly: true },
    { value: '4K', label: '4K', proOnly: true },
];

const FPS_OPTIONS: { value: ExportFps; label: string; proOnly: boolean }[] = [
    { value: 30, label: '30 fps', proOnly: false },
    { value: 60, label: '60 fps', proOnly: true },
];

const WATERMARK_POSITIONS: { value: WatermarkPosition; label: string; icon: React.ReactNode }[] = [
    { value: 'top-left', label: 'Top Left', icon: <TbBoxAlignTopLeft size={18} /> },
    { value: 'top-right', label: 'Top Right', icon: <TbBoxAlignTopRight size={18} /> },
    { value: 'bottom-left', label: 'Bottom Left', icon: <TbBoxAlignBottomLeft size={18} /> },
    { value: 'bottom-right', label: 'Bottom Right', icon: <TbBoxAlignBottomRight size={18} /> },
];

/** Format remaining trial time as a human-readable string */
function formatTrialRemaining(freeTrialUntil: string): string {
    const remaining = new Date(freeTrialUntil).getTime() - Date.now();
    if (remaining <= 0) return '';
    const days = Math.ceil(remaining / (1000 * 60 * 60 * 24));
    if (days === 1) return '1 day left';
    return `${days} days left`;
}

export function ExportSettings() {
    const { addToast } = useToast();

    const [selectedQuality, setSelectedQuality] = useState<ExportQuality>('720p');
    const [selectedFps, setSelectedFps] = useState<ExportFps>(30);
    const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>('bottom-right');
    const [showWatermark, setShowWatermark] = useState<boolean | null>(null);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

    // Share state
    const [existingShare, setExistingShare] = useState<SharedVideo | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishedCount, setPublishedCount] = useState(0);

    const { isAuthenticated, isPro, hasProAccess, hasFreeTrial, freeTrialUntil } = useUserStore();
    const proAccess = hasProAccess();
    const activeTrial = hasFreeTrial();

    // Watermark defaults: OFF for pro/trial, ON for everyone else
    const effectiveShowWatermark = showWatermark ?? !proAccess;

    // Sync watermark preview to canvas via UIStore
    const setWatermarkPreviewPosition = useUIStore(s => s.setWatermarkPreviewPosition);
    useEffect(() => {
        setWatermarkPreviewPosition(effectiveShowWatermark ? watermarkPosition : null);
    }, [effectiveShowWatermark, watermarkPosition]);

    // Clean up watermark preview on unmount
    useEffect(() => {
        return () => setWatermarkPreviewPosition(null);
    }, []);

    const project = useProjectData();
    const setExportState = useProjectStore(s => s.setExportState);
    const isExporting = useProjectStore(s => s.exportState.isExporting);

    // Check for existing share and quota on mount
    useEffect(() => {
        if (isAuthenticated && project?.id) {
            ShareService.getShareForProject(project.id).then(setExistingShare);
            ShareService.getSharedVideos().then(videos => setPublishedCount(videos.length));
        }
    }, [isAuthenticated, project?.id]);

    // ─── Download ───────────────────────────────────────────────

    const handleDownload = () => {
        if (isExporting) return;

        const needsProFeature = (selectedQuality === '1080p' || selectedQuality === '2K' || selectedQuality === '4K' || selectedFps === 60);

        if (proAccess || !needsProFeature) {
            startDownload(selectedQuality, selectedFps, { watermarkPosition: effectiveShowWatermark ? watermarkPosition : undefined });
            return;
        }

        setIsUpgradeModalOpen(true);
    };

    const startDownload = async (quality: ExportQuality, fps: ExportFps, options?: { watermarkPosition?: WatermarkPosition }) => {
        useUIStore.getState().setIsPlaying(false);
        setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null });

        const manager = new ExportManager();
        const onProgress = (state: any) => setExportState(state);

        try {
            (window as any).__activeExportManager = manager;
            await manager.exportProject(project, quality, fps, onProgress, options);

            const totalDurationMs = new TimeMapper(project.timeline.outputWindows).outputDuration;
            trackExportCompleted({
                quality,
                fps,
                duration_seconds: Math.floor(totalDurationMs / 1000),
                is_authenticated: isAuthenticated,
                is_pro: isPro,
            });
        } catch (e: any) {
            if (e?.message === 'Export cancelled') return;
            console.error(e);
            if (e?.message) {
                addToast({ type: 'error', title: 'Export Failed', message: e.message });
            }
        } finally {
            setExportState({ isExporting: false });
            (window as any).__activeExportManager = null;
        }
    };

    // ─── Publish ────────────────────────────────────────────────

    const handlePublish = async () => {
        if (isExporting || isPublishing) return;

        // Auth gate
        if (!isAuthenticated) {
            setIsAuthModalOpen(true);
            return;
        }

        // Pro gate (defense-in-depth — UI also disables the button)
        if (!proAccess) {
            setIsUpgradeModalOpen(true);
            return;
        }

        // Pre-flight quota check (skip if re-publishing same project)
        if (!existingShare) {
            const quota = await ShareService.checkQuota(project.id);
            if (!quota.canShare) {
                addToast({
                    type: 'error',
                    title: 'Publish Limit Reached',
                    message: `You've used ${quota.current} of ${quota.max} published video slots. Unpublish an existing video to free up a slot.`,
                });
                return;
            }
        }

        // Export (skip download) then upload
        setIsPublishing(true);
        useUIStore.getState().setIsPlaying(false);
        setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null });

        const manager = new ExportManager();
        const onProgress = (state: any) => setExportState(state);

        try {
            (window as any).__activeExportManager = manager;
            const blob = await manager.exportProject(project, selectedQuality, selectedFps, onProgress, {
                watermarkPosition: effectiveShowWatermark ? watermarkPosition : undefined,
                skipDownload: true,
            });

            // Upload to Cloudflare Stream
            setExportState({ isExporting: true, progress: 0.95, timeRemainingSeconds: null });
            const result = await ShareService.shareVideo(blob, project.id, project.name);

            // Try to copy URL to clipboard (non-blocking)
            let linkCopied = false;
            try {
                await navigator.clipboard.writeText(result.shareUrl);
                linkCopied = true;
            } catch {
                // Clipboard may fail if dev tools or another window is focused — not a publish failure
            }

            // Refresh state
            const updatedShare = await ShareService.getShareForProject(project.id);
            setExistingShare(updatedShare);
            const videos = await ShareService.getSharedVideos();
            setPublishedCount(videos.length);

            // Notify Header
            window.dispatchEvent(new Event('share-updated'));

            addToast({
                type: 'success',
                title: result.isUpdate ? 'Video Republished' : 'Video Published!',
                message: linkCopied ? 'Link copied to clipboard' : 'Published successfully',
            });
        } catch (e: any) {
            if (e?.message === 'Export cancelled') return;
            console.error('[Publish] Failed:', e);
            Sentry.captureException(e, { extra: { projectId: project.id, phase: 'publish' } });
            addToast({
                type: 'error',
                title: 'Publish Failed',
                message: e?.message || 'Something went wrong. Please try again.',
            });
        } finally {
            setIsPublishing(false);
            setExportState({ isExporting: false });
            (window as any).__activeExportManager = null;
        }
    };

    // Determine if currently selected options require Pro
    const selectedQualityOption = QUALITY_OPTIONS.find(o => o.value === selectedQuality);
    const selectedFpsOption = FPS_OPTIONS.find(o => o.value === selectedFps);
    const needsProFeature = (selectedQualityOption?.proOnly || selectedFpsOption?.proOnly) && !proAccess;

    // Inline trial/auth status badge
    const statusBadge = !isPro ? (
        activeTrial && freeTrialUntil ? (
            <span className="text-[10px] text-primary font-semibold flex items-center gap-1">
                <BiCrown size={10} />
                Trial · {formatTrialRemaining(freeTrialUntil)}
            </span>
        ) : !isAuthenticated ? (
            <button
                onClick={() => setIsAuthModalOpen(true)}
                className="text-[10px] text-primary hover:text-primary-highlighted underline cursor-pointer font-medium"
            >
                Free trial →
            </button>
        ) : (
            <span className="text-[10px] text-text-muted">Trial expired · <button onClick={() => setIsUpgradeModalOpen(true)} className="underline text-primary hover:text-primary-highlighted cursor-pointer">Upgrade</button></span>
        )
    ) : null;

    const proBadge = (
        <span className="bg-primary text-text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none uppercase">
            Pro
        </span>
    );

    const busy = isExporting || isPublishing;

    return (
        <div className="flex flex-col gap-3 text-sm text-text-main">
            <CollapsibleCard
                title="Export Settings"
                icon={<TbSettings2 size={16} />}
                notCollapsible
            >
                <div className="flex flex-col gap-4">
                    {/* Quality Selection */}
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-text-muted w-1/3 shrink-0">Quality</span>
                        <Dropdown
                            options={QUALITY_OPTIONS.map(opt => ({
                                value: opt.value,
                                label: opt.label,
                                suffix: opt.proOnly && !isPro ? proBadge : undefined,
                            }))}
                            value={selectedQuality}
                            onChange={(val) => setSelectedQuality(val)}
                        />
                    </div>

                    {/* FPS Selection */}
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-text-muted w-1/3 shrink-0">Frame Rate</span>
                        <Dropdown
                            options={FPS_OPTIONS.map(opt => ({
                                value: opt.value,
                                label: opt.label,
                                suffix: opt.proOnly && !isPro ? proBadge : undefined,
                            }))}
                            value={selectedFps}
                            onChange={(val) => setSelectedFps(val)}
                        />
                    </div>

                    {/* Watermark */}
                    {proAccess ? (
                        <div className="flex flex-col gap-2">
                            <Toggle
                                label="Recordio Watermark"
                                value={effectiveShowWatermark}
                                onChange={(val) => setShowWatermark(val)}
                            />
                            {effectiveShowWatermark && (
                                <MultiToggle
                                    options={WATERMARK_POSITIONS.map(pos => ({
                                        value: pos.value,
                                        icon: pos.icon,
                                        tooltip: pos.label,
                                    }))}
                                    value={watermarkPosition}
                                    onChange={(val) => setWatermarkPosition(val as WatermarkPosition)}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-text-muted">Recordio Watermark</span>
                                <span className="text-[10px] text-text-disabled">Pro to remove</span>
                            </div>
                            <MultiToggle
                                options={WATERMARK_POSITIONS.map(pos => ({
                                    value: pos.value,
                                    icon: pos.icon,
                                    tooltip: pos.label,
                                }))}
                                value={watermarkPosition}
                                onChange={(val) => setWatermarkPosition(val as WatermarkPosition)}
                            />
                        </div>
                    )}

                    {/* Download Button */}
                    <Tooltip text={needsProFeature ? 'Pro settings selected — upgrade to export' : ''}>
                        <button
                            onClick={handleDownload}
                            className="interactive-base flex items-center justify-center gap-2 w-full text-sm font-medium"
                            disabled={busy || needsProFeature}
                        >
                            <TbDownload size={16} />
                            Download
                        </button>
                    </Tooltip>

                    {/* Publish / Republish Button (Primary) */}
                    {(() => {
                        const quotaFull = proAccess && publishedCount >= MAX_SHARED_VIDEOS && !existingShare;
                        const publishDisabled = busy || !proAccess || quotaFull;
                        const tooltipText = !proAccess
                            ? 'Shareable links are a Pro feature'
                            : quotaFull
                                ? `You've used all ${MAX_SHARED_VIDEOS} slots. Delist a shared video from the dashboard to free up a slot.`
                                : '';

                        return (
                            <div className="flex flex-col items-center gap-1.5">
                                <Tooltip text={tooltipText} className="w-full">
                                    <button
                                        onClick={proAccess ? handlePublish : () => setIsUpgradeModalOpen(true)}
                                        className={`interactive-primary flex items-center justify-center gap-2 w-full text-sm font-medium ${publishDisabled ? 'pointer-events-none' : ''}`}
                                        disabled={publishDisabled}
                                    >
                                        <TbLink size={16} />
                                        {isPublishing ? 'Publishing...' : existingShare ? 'Republish' : 'Publish'}
                                    </button>
                                </Tooltip>
                                {proAccess && !existingShare && (
                                    <span className="subtext">{publishedCount} of {MAX_SHARED_VIDEOS} published</span>
                                )}
                            </div>
                        );
                    })()}

                    {/* Inline status badge */}
                    {statusBadge && (
                        <div className="flex justify-center">
                            {statusBadge}
                        </div>
                    )}
                </div>
            </CollapsibleCard>

            {/* Modals */}
            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
                onAuthSuccess={() => { }}
            />
            <UpgradeModal
                isOpen={isUpgradeModalOpen}
                onClose={() => setIsUpgradeModalOpen(false)}
                onSignInRequest={() => setIsAuthModalOpen(true)}
                selectedQuality={selectedQuality}
            />
        </div>
    );
}

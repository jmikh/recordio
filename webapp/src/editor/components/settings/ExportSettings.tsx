import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { BiCrown } from 'react-icons/bi';
import { TbSettings2, TbBoxAlignTopLeft, TbBoxAlignTopRight, TbBoxAlignBottomLeft, TbBoxAlignBottomRight, TbLink, TbCopy } from 'react-icons/tb';
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
import { ShareService, type SharedVideo } from '../../services/ShareService';

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
    const [isSharing, setIsSharing] = useState(false);

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

    // Check for existing share on mount
    useEffect(() => {
        if (isAuthenticated && project?.id) {
            ShareService.getShareForProject(project.id).then(setExistingShare);
        }
    }, [isAuthenticated, project?.id]);

    const handleExport = () => {
        if (isExporting) return;

        const needsProFeature = (selectedQuality === '1080p' || selectedQuality === '2K' || selectedQuality === '4K' || selectedFps === 60);

        if (proAccess || !needsProFeature) {
            startExport(selectedQuality, selectedFps, { watermarkPosition: effectiveShowWatermark ? watermarkPosition : undefined });
            return;
        }

        setIsUpgradeModalOpen(true);
    };

    const handleShare = async () => {
        if (isExporting || isSharing) return;

        // Auth gate
        if (!isAuthenticated) {
            setIsAuthModalOpen(true);
            return;
        }

        // Pre-flight quota check (before expensive export)
        const quota = await ShareService.checkQuota(project.id);
        if (!quota.canShare) {
            addToast({
                type: 'error',
                title: 'Share Limit Reached',
                message: `You've used ${quota.current} of ${quota.max} shared video slots. Delete an existing share to free up a slot.`,
            });
            return;
        }

        // Export the video (skip download — we'll upload instead)
        setIsSharing(true);
        try {
            const blob = await startExportForShare(selectedQuality, selectedFps, {
                watermarkPosition: effectiveShowWatermark ? watermarkPosition : undefined,
            });

            if (!blob) return; // cancelled

            // Upload to Cloudflare Stream
            setExportState({ isExporting: true, progress: 0.95, timeRemainingSeconds: null });

            const result = await ShareService.shareVideo(blob, project.id, project.name);

            // Copy URL to clipboard
            await navigator.clipboard.writeText(result.shareUrl);

            // Refresh the existing share state
            const updatedShare = await ShareService.getShareForProject(project.id);
            setExistingShare(updatedShare);

            addToast({
                type: 'success',
                title: result.isUpdate ? 'Shared Link Updated' : 'Video Shared!',
                message: `Link copied to clipboard`,
            });
        } catch (e: any) {
            if (e?.message === 'Export cancelled') return;
            console.error('[Share] Failed:', e);
            Sentry.captureException(e, { extra: { projectId: project.id, phase: 'share' } });
            addToast({
                type: 'error',
                title: 'Share Failed',
                message: e?.message || 'Something went wrong while sharing. Please try again.',
            });
        } finally {
            setIsSharing(false);
            setExportState({ isExporting: false });
            (window as any).__activeExportManager = null;
        }
    };

    const startExport = async (quality: ExportQuality, fps: ExportFps, options?: { watermarkPosition?: WatermarkPosition }) => {
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

    /** Export variant that returns the blob for sharing (skips download) */
    const startExportForShare = async (
        quality: ExportQuality,
        fps: ExportFps,
        options?: { watermarkPosition?: WatermarkPosition },
    ): Promise<Blob | null> => {
        useUIStore.getState().setIsPlaying(false);
        setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null });

        const manager = new ExportManager();
        const onProgress = (state: any) => setExportState(state);

        try {
            (window as any).__activeExportManager = manager;
            const blob = await manager.exportProject(project, quality, fps, onProgress, {
                ...options,
                skipDownload: true,
            });
            return blob;
        } catch (e: any) {
            if (e?.message === 'Export cancelled') return null;
            throw e;
        }
    };

    const copyShareLink = async () => {
        if (!existingShare) return;
        const url = ShareService.getShareUrl(existingShare.id);
        await navigator.clipboard.writeText(url);
        addToast({ type: 'success', title: 'Link Copied', message: url });
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
            <span className="text-[10px] text-text-muted">Trial expired</span>
        )
    ) : null;

    const proBadge = (
        <span className="bg-primary text-text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none uppercase">
            Pro
        </span>
    );

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

                    {/* Export Button */}
                    <Tooltip text={needsProFeature ? 'Pro settings selected — upgrade to export' : ''}>
                        <button
                            onClick={handleExport}
                            className="interactive-primary flex items-center justify-center gap-2 w-full"
                            disabled={isExporting || needsProFeature}
                        >
                            Export
                        </button>
                    </Tooltip>

                    {/* Already-shared indicator */}
                    {existingShare && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                            <TbLink size={14} className="text-primary shrink-0" />
                            <span className="text-xs text-primary truncate flex-1">
                                This project has a shared link
                            </span>
                            <button
                                onClick={copyShareLink}
                                className="text-primary hover:text-primary-highlighted transition-colors cursor-pointer"
                                title="Copy link"
                            >
                                <TbCopy size={14} />
                            </button>
                        </div>
                    )}

                    {/* Share Button */}
                    <button
                        onClick={handleShare}
                        className="interactive-base flex items-center justify-center gap-2 w-full text-sm font-medium"
                        disabled={isExporting || isSharing}
                    >
                        <TbLink size={16} />
                        {existingShare ? 'Update Shared Link' : 'Share Link'}
                    </button>

                    {/* Upgrade Button */}
                    {!proAccess && (
                        <button
                            onClick={() => setIsUpgradeModalOpen(true)}
                            className="flex items-center justify-center gap-2 w-full py-2 text-sm font-medium text-primary border border-primary/30 rounded-[var(--radius-interactive)] hover:bg-primary/10 transition-colors cursor-pointer"
                        >
                            <BiCrown size={14} />
                            Upgrade to Pro
                        </button>
                    )}

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

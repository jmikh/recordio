import React, { useState, useEffect } from 'react';
import { timeAgo } from '../../../utils/timeAgo';
import * as Sentry from '@sentry/react';

import { TbSettings2, TbLink, TbDownload, TbCopy } from 'react-icons/tb';
import { MultiToggle, Dropdown, Toggle, Tooltip, Button, ProBadge, Modal, XButton } from '@shared/components';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import { ExportManager } from '../../export/ExportManager';
import type { ExportQuality, ExportCodecInfo } from '../../export/ExportManager';

import { trackExportStarted, trackExportCompleted, trackVideoPublished, extractProjectProperties } from '../../../core/analytics';
import { useToast } from '../Toast';
import { ShareService, type SharedVideo } from '../../services/ShareService';

import { AuthModal } from '../header/AuthModal';
import { UpgradeModal } from '../header/UpgradeModal';
import { ReviewModal, shouldShowReviewModal } from '../header/ReviewModal';



const QUALITY_OPTIONS: { value: ExportQuality; label: string; proOnly: boolean }[] = [
    { value: '480p', label: '480p', proOnly: false },
    { value: '720p', label: '720p', proOnly: false },
    { value: '1080p', label: '1080p', proOnly: true },
    { value: '2K', label: '2K', proOnly: true },
    { value: '4K', label: '4K', proOnly: true },
];


/** Format remaining trial time as a human-readable string */
function formatTrialRemaining(endDate: Date | null): string {
    if (!endDate) return '';
    const remaining = endDate.getTime() - Date.now();
    if (remaining <= 0) return '';
    const days = Math.ceil(remaining / (1000 * 60 * 60 * 24));
    if (days === 1) return '1 day left';
    return `${days} days left`;
}

export function ExportModal() {
    const { addToast } = useToast();
    const isOpen = useUIStore(s => s.isExportModalOpen);
    const setExportModalOpen = useUIStore(s => s.setExportModalOpen);

    const [selectedQuality, setSelectedQuality] = useState<ExportQuality>('720p');
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

    // Share state
    const [existingShare, setExistingShare] = useState<SharedVideo | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);

    const { isAuthenticated, isPro, hasProAccess, hasFreeTrial } = useUserStore();
    const proAccess = hasProAccess();
    const activeTrial = hasFreeTrial();

    const project = useProjectData();
    const setExportState = useProjectStore(s => s.setExportState);
    const isExporting = useProjectStore(s => s.exportState.isExporting);

    // Check for existing share and quota on mount
    useEffect(() => {
        if (isAuthenticated && project?.id) {
            ShareService.getShareForProject(project.id).then(setExistingShare);
        }
    }, [isAuthenticated, project?.id]);

    // ─── Download ───────────────────────────────────────────────

    const handleDownload = () => {
        if (isExporting) return;

        const needsProFeature = (selectedQuality === '1080p' || selectedQuality === '2K' || selectedQuality === '4K');

        if (proAccess || !needsProFeature) {
            startDownload(selectedQuality);
            return;
        }

        setIsUpgradeModalOpen(true);
    };

    const startDownload = async (quality: ExportQuality) => {
        useUIStore.getState().setIsPlaying(false);
        setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null, phase: 'exporting' });

        const manager = new ExportManager();
        const onProgress = (state: any) => setExportState(state);

        // Re-attach userEvents (stored separately from project for undo/redo perf)
        const fullProject = { ...project, userEvents: useProjectStore.getState().userEvents };
        const exportStart = Date.now();

        trackExportStarted({
            ...extractProjectProperties(fullProject),
            quality,
            fps: 30,
            export_type: 'download',
        });

        try {
            (window as any).__activeExportManager = manager;
            const { blob, codecs, videoDecodeMode, videoDecodeFallback } = await manager.exportProject(fullProject, quality, onProgress);
            const exportDuration = Date.now() - exportStart;

            trackExportCompleted({
                ...extractProjectProperties(fullProject),
                quality,
                fps: 30,
                export_duration_ms: exportDuration,
                success: true,
                video_codec: codecs.video.encoder,
                video_codec_fallback: codecs.video.fallback,
                video_codecs_tried: codecs.video.tried,
                audio_codec: codecs.audio.encoder,
                audio_codec_fallback: codecs.audio.fallback,
                video_decode_mode: videoDecodeMode,
                video_decode_fallback: videoDecodeFallback,
            });
            if (shouldShowReviewModal()) setTimeout(() => setIsReviewModalOpen(true), 5000);
        } catch (e: any) {
            if (e?.message === 'Export cancelled') return;
            console.error(e);
            trackExportCompleted({
                ...extractProjectProperties(fullProject),
                quality,
                fps: 30,
                export_duration_ms: Date.now() - exportStart,
                success: false,
                error: e?.message || 'Unknown error',
                video_codec: 'unknown',
                video_codec_fallback: false,
                video_codecs_tried: [],
                audio_codec: 'unknown',
                audio_codec_fallback: false,
                video_decode_mode: 'hardware',
                video_decode_fallback: false,
            });
            addToast({
                type: 'error',
                title: 'Export Failed',
                message: 'Something went wrong. Please keep this tab active during export and try again. If the issue persists, reach out — we\'ll address it within 24 hours.',
                duration: 0,
                action: { label: 'Report a Bug', href: 'mailto:support@recordio.cc' },
            });
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

        // Export (skip download) then upload
        setIsPublishing(true);
        useUIStore.getState().setIsPlaying(false);
        setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null, phase: 'exporting' });

        const manager = new ExportManager();
        const onProgress = (state: any) => setExportState(state);

        // Re-attach userEvents (stored separately from project for undo/redo perf)
        const fullProject = { ...project, userEvents: useProjectStore.getState().userEvents };
        const exportStart = Date.now();

        trackExportStarted({
            ...extractProjectProperties(fullProject),
            quality: selectedQuality,
            fps: 30,
            export_type: 'publish',
        });

        let exportCodecs: ExportCodecInfo | null = null;
        let exportDecodeMode: 'hardware' | 'software' = 'hardware';
        let exportDecodeFallback = false;
        let exportDuration = 0;
        try {
            (window as any).__activeExportManager = manager;
            const { blob, codecs, videoDecodeMode, videoDecodeFallback } = await manager.exportProject(fullProject, selectedQuality, onProgress, {
                skipDownload: true,
            });
            exportDuration = Date.now() - exportStart;
            exportCodecs = codecs;
            exportDecodeMode = videoDecodeMode;
            exportDecodeFallback = videoDecodeFallback;

            // Fire export_completed immediately after render
            trackExportCompleted({
                ...extractProjectProperties(fullProject),
                quality: selectedQuality,
                fps: 30,
                export_duration_ms: exportDuration,
                success: true,
                video_codec: codecs.video.encoder,
                video_codec_fallback: codecs.video.fallback,
                video_codecs_tried: codecs.video.tried,
                audio_codec: codecs.audio.encoder,
                audio_codec_fallback: codecs.audio.fallback,
                video_decode_mode: videoDecodeMode,
                video_decode_fallback: videoDecodeFallback,
            });

            // Upload to Cloudflare Stream
            setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null, phase: 'uploading' });
            const uploadStart = Date.now();
            const result = await ShareService.shareVideo(blob, project.id, project.name, {
                onUploadProgress: (fraction) => setExportState({ progress: fraction }),
            });
            const uploadDuration = Date.now() - uploadStart;

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

            // Notify Header
            window.dispatchEvent(new Event('share-updated'));

            trackVideoPublished({
                ...extractProjectProperties(fullProject),
                quality: selectedQuality,
                fps: 30,
                export_duration_ms: exportDuration,
                upload_duration_ms: uploadDuration,
                success: true,
                video_codec: codecs.video.encoder,
                video_codec_fallback: codecs.video.fallback,
                video_codecs_tried: codecs.video.tried,
                audio_codec: codecs.audio.encoder,
                audio_codec_fallback: codecs.audio.fallback,
                video_decode_mode: videoDecodeMode,
                video_decode_fallback: videoDecodeFallback,
            });

            addToast({
                type: 'success',
                title: result.isUpdate ? 'Video Republished' : 'Video Published!',
                message: linkCopied ? 'Link copied to clipboard' : 'Published successfully',
            });
            if (shouldShowReviewModal()) setTimeout(() => setIsReviewModalOpen(true), 5000);
        } catch (e: any) {
            if (e?.message === 'Export cancelled') return;
            console.error('[Publish] Failed:', e);
            Sentry.captureException(e, { extra: { projectId: project.id, phase: 'publish' } });

            if (exportCodecs) {
                // Export succeeded but upload failed — fire video_published with failure
                trackVideoPublished({
                    ...extractProjectProperties(fullProject),
                    quality: selectedQuality,
                    fps: 30,
                    export_duration_ms: exportDuration,
                    upload_duration_ms: Date.now() - exportStart - exportDuration,
                    success: false,
                    error: e?.message || 'Unknown error',
                    video_codec: exportCodecs.video.encoder,
                    video_codec_fallback: exportCodecs.video.fallback,
                    video_codecs_tried: exportCodecs.video.tried,
                    audio_codec: exportCodecs.audio.encoder,
                    audio_codec_fallback: exportCodecs.audio.fallback,
                    video_decode_mode: exportDecodeMode,
                    video_decode_fallback: exportDecodeFallback,
                });
            } else {
                // Export itself failed
                trackExportCompleted({
                    ...extractProjectProperties(fullProject),
                    quality: selectedQuality,
                    fps: 30,
                    export_duration_ms: Date.now() - exportStart,
                    success: false,
                    error: e?.message || 'Unknown error',
                    video_codec: 'unknown',
                    video_codec_fallback: false,
                    video_codecs_tried: [],
                    audio_codec: 'unknown',
                    audio_codec_fallback: false,
                    video_decode_mode: 'hardware',
                    video_decode_fallback: false,
                });
            }
            addToast({
                type: 'error',
                title: 'Publish Failed',
                message: 'Something went wrong. Please keep this tab active during export and try again. If the issue persists, reach out — we\'ll address it within 24 hours.',
                duration: 0,
                action: { label: 'Report a Bug', href: 'mailto:support@recordio.cc' },
            });
        } finally {
            setIsPublishing(false);
            setExportState({ isExporting: false });
            (window as any).__activeExportManager = null;
        }
    };

    // Determine if currently selected options require Pro
    const selectedQualityOption = QUALITY_OPTIONS.find(o => o.value === selectedQuality);
    const needsProFeature = selectedQualityOption?.proOnly && !proAccess;

    // Inline trial/auth status badge — only show when user doesn't have pro access
    const statusBadge = proAccess ? null : (
        !isAuthenticated ? (
            <span className="text-[10px] text-text-muted">
                <button
                    onClick={() => setIsAuthModalOpen(true)}
                    className="underline text-primary hover:text-primary-highlighted cursor-pointer font-medium"
                >
                    Log in
                </button>
                {' '}to claim free pro trial
            </span>
        ) : (
            <span className="text-[10px] text-text-muted">Trial expired · <button onClick={() => setIsUpgradeModalOpen(true)} className="underline text-primary hover:text-primary-highlighted cursor-pointer">Upgrade</button></span>
        )
    );

    const proBadge = <ProBadge />;

    const busy = isExporting || isPublishing;

    return (
        <Modal isOpen={isOpen} onClose={() => setExportModalOpen(false)} maxWidth="max-w-[480px]">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
                    <TbDownload className="icon-lg" />
                    Export Project
                </h2>
                <XButton onClick={() => setExportModalOpen(false)} />
            </div>

            <div className="flex flex-col gap-6 text-sm text-text-main overflow-y-auto max-h-[70vh] custom-scrollbar pr-2">
                <div className="flex flex-col gap-5">
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

                    {/* Publish / Republish Button */}
                    {(() => {
                        const publishDisabled = busy || !proAccess;
                        const tooltipText = !proAccess
                            ? 'Shareable links are a Pro feature'
                            : '';

                        return (
                            <div className="flex flex-col items-center gap-1.5">
                                <Tooltip text={tooltipText} className="w-full">
                                    <Button
                                        onClick={proAccess ? handlePublish : () => setIsUpgradeModalOpen(true)}
                                        fullWidth
                                        className={`text-sm font-medium ${publishDisabled ? 'pointer-events-none' : ''}`}
                                        disabled={publishDisabled}
                                    >
                                        <TbLink className="icon-md" />
                                        {isPublishing ? 'Sharing...' : existingShare ? 'Reshare' : 'Share'}
                                    </Button>
                                </Tooltip>
                                {existingShare && (
                                    <>
                                        <Button
                                            fullWidth
                                            className="text-sm font-medium"
                                            onClick={async () => {
                                                try {
                                                    await navigator.clipboard.writeText(ShareService.getShareUrl(existingShare.id));
                                                    addToast({ type: 'success', title: 'Link copied to clipboard' });
                                                } catch {
                                                    addToast({ type: 'error', title: 'Failed to copy link' });
                                                }
                                            }}
                                        >
                                            <TbCopy className="icon-md" />
                                            Copy Link
                                        </Button>
                                        <span className="subtext">Published {timeAgo(existingShare.updated_at)}</span>
                                    </>
                                )}
                            </div>
                        );
                    })()}

                    {/* Download Button (Primary) */}
                    <Tooltip text={needsProFeature ? 'Pro settings selected — upgrade to export' : ''}>
                        <Button
                            variant="primary"
                            onClick={handleDownload}
                            fullWidth
                            className="text-sm font-medium"
                            disabled={busy || needsProFeature}
                        >
                            <TbDownload className="icon-md" />
                            Download
                        </Button>
                    </Tooltip>

                    {/* Inline status badge */}
                    {statusBadge && (
                        <div className="flex justify-center">
                            {statusBadge}
                        </div>
                    )}
                </div>

                <div className="h-[1px] w-full bg-border opacity-50 my-1" />

                {/* Advanced Settings */}
                <div className="flex flex-col gap-4">
                    <h3 className="font-medium text-text-highlighted flex items-center gap-2">
                        <TbSettings2 className="icon-md" />
                        Advanced
                    </h3>
                    <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-text-muted shrink-0">Video Decoding</span>
                            <MultiToggle
                                options={[
                                    { value: 'cpu', label: 'CPU' },
                                    { value: 'gpu', label: 'GPU' },
                                ]}
                                value={useUIStore((s) => s.videoDecodePreference)}
                                onChange={(val) => useUIStore.getState().setVideoDecodePreference(val as 'gpu' | 'cpu')}
                            />
                        </div>
                        <p className="text-[11px] text-text-disabled leading-snug">
                            Controls how video frames are decoded during export — <span className="font-semibold text-text-muted">this has no effect on the final video quality.</span> CPU works best for most machines. GPU may speed things up on high-end hardware, but some browser and OS combinations don't support it reliably. When in doubt, leave it on CPU.
                        </p>
                    </div>
                    </div>
                </div>
            </div>

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
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
            />
        </Modal>
    );
}

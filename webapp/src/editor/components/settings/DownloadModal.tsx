import { useState, useEffect, useRef } from 'react';
import { Modal, XButton, Button, MultiToggle, Toggle, type MultiToggleOption } from '@shared/components';
import { HiOutlineBolt } from 'react-icons/hi2';
import { TbLock } from 'react-icons/tb';
import { useProjectStore, useProjectName } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useToast } from '../../../components/Toast';
import { useLocalRender } from './useLocalRender';
import { ProUpgradeModal } from '../../../billing/ProUpgradeModal';
import { useEntitlements } from '../../../billing/useEntitlements';
import type { CloudRenderPhase } from './useCloudRender';
import type { ExportQuality } from '@shared/utils/exportQuality';
import { trackRenderInCloudClicked, trackRenderLocallyClicked, trackRenderLocallyCompleted, trackRenderLocallyFailed, type UpgradeModalReason } from '../../../analytics';
import { maybeOpenLeaveReviewModal } from '../../../components/LeaveReviewModal';

/** Whole minutes, rounded up — 3.4 min shows as "4 min". */
function formatDurationLabel(ms: number): string {
    return `${Math.max(1, Math.ceil(ms / 60000))} min`;
}

/** Selectable output qualities — 2K/4K are pro-gated (entitlements.can4k). */
type RenderQuality = Extract<ExportQuality, '1080p' | '2K' | '4K'>;

const QUALITY_LABELS: Record<RenderQuality, string> = {
    '1080p': '1080p',
    '2K': '1440p',
    '4K': '4K',
};

/** Rough estimate for local render time based on video duration */
function estimateLocalTime(durationMs: number): string {
    const minutes = Math.max(1, Math.ceil(durationMs / 1000 / 60 * 3));
    if (minutes === 1) return '~1 min';
    return `~${minutes} min on this device`;
}

type ModalView = 'choose' | 'local' | 'cloud';

interface DownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
    cloudPhase: CloudRenderPhase;
    cloudProgress: number;
    onStartCloudRender: (quality: ExportQuality) => void;
}

export function DownloadModal({
    isOpen,
    onClose,
    cloudPhase,
    cloudProgress,
    onStartCloudRender,
}: DownloadModalProps) {
    // If cloud render is already in progress, skip choice screen
    const cloudActive = cloudPhase !== 'idle' && cloudPhase !== 'completed' && cloudPhase !== 'failed';
    const [view, setView] = useState<ModalView>(cloudActive ? 'cloud' : 'choose');

    const project = useProjectStore(s => s.project);
    const entitlements = useEntitlements();
    // Any setting is freely selectable; entitlements are checked on Export
    const [quality, setQuality] = useState<RenderQuality>('1080p');
    const [cloudExport, setCloudExport] = useState(true);
    const [isProModalOpen, setIsProModalOpen] = useState(false);
    const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>();
    const [upgradeReason, setUpgradeReason] = useState<UpgradeModalReason>('export');

    // Reset view when modal reopens, and clear stale view on close
    useEffect(() => {
        if (isOpen) {
            setView(cloudActive ? 'cloud' : 'choose');
        } else {
            setView('choose');
        }
    }, [isOpen, cloudActive]);

    // Background export finished (fires even with the modal closed — the
    // component stays mounted) — follow with the review ask
    useEffect(() => {
        if (cloudPhase === 'completed') void maybeOpenLeaveReviewModal('export_completed');
    }, [cloudPhase]);

    if (!isOpen) return null;

    if (view === 'local') {
        return (
            <LocalRenderView
                isOpen={isOpen}
                onClose={onClose}
                onBack={() => setView('choose')}
                quality={quality}
            />
        );
    }

    if (view === 'cloud') {
        return (
            <CloudRenderView
                isOpen={isOpen}
                onClose={onClose}
                phase={cloudPhase}
                progress={cloudProgress}
                onStartRender={() => onStartCloudRender(quality)}
            />
        );
    }

    // ─── Choice Screen ───────────────────────────────────────

    const durationMs = project.timeline.durationMs;
    const durationLabel = formatDurationLabel(durationMs);
    const resolutionLabel = QUALITY_LABELS[quality];
    const localEstimate = estimateLocalTime(durationMs);

    const lockIcon = entitlements.can4k ? undefined : <TbLock className="icon-sm" />;
    const qualityOptions: MultiToggleOption<RenderQuality>[] = [
        { value: '1080p', label: '1080p', tooltip: 'Full HD' },
        { value: '2K', label: '1440p', icon: lockIcon, tooltip: entitlements.can4k ? 'QHD' : 'QHD — Pro' },
        { value: '4K', label: '4K', icon: lockIcon, tooltip: entitlements.can4k ? 'Ultra HD' : 'Ultra HD — Pro' },
    ];

    // Entitlements gate on Export, not on selection: pick anything, and if
    // the combination needs Pro the upgrade modal names what's missing
    const handleExport = () => {
        const needsHiRes = quality !== '1080p' && !entitlements.can4k;
        const needsCloud = cloudExport && !entitlements.canBackgroundExport;
        if (needsHiRes || needsCloud) {
            setUpgradeFeature(
                needsHiRes && needsCloud ? undefined
                    : needsHiRes ? 'high-resolution exports'
                    : 'cloud exports',
            );
            setUpgradeReason(
                needsHiRes && needsCloud ? 'export'
                    : needsHiRes ? 'export_4k'
                    : 'background_export',
            );
            setIsProModalOpen(true);
            return;
        }
        if (cloudExport) {
            trackRenderInCloudClicked(project.id);
            setView('cloud');
        } else {
            trackRenderLocallyClicked(project.id);
            setView('local');
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-lg">
            <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="heading-2">Download video</h2>
                        <p className="text-sm text-text-muted mt-0.5">
                            {durationLabel} · {resolutionLabel} · MP4
                        </p>
                    </div>
                    <XButton onClick={onClose} title="Close" />
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-sm text-text-main">Resolution</span>
                    <MultiToggle
                        options={qualityOptions}
                        value={quality}
                        onChange={setQuality}
                    />
                </div>

                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-text-main">Cloud export</span>
                        <Toggle
                            value={cloudExport}
                            onChange={setCloudExport}
                            aria-label="Cloud export"
                        />
                    </div>
                    <p className="subtext leading-relaxed">
                        {cloudExport
                            ? "Keep working while we make your video — we'll notify you when it's ready."
                            : `Your video is made in this tab — keep it open and in focus (${localEstimate}).`}
                    </p>
                </div>

                <Button
                    variant="primary"
                    onClick={handleExport}
                    className="w-full"
                >
                    Export video
                </Button>
            </div>

            <ProUpgradeModal
                isOpen={isProModalOpen}
                onClose={() => setIsProModalOpen(false)}
                feature={upgradeFeature}
                reason={upgradeReason}
            />
        </Modal>
    );
}

// ─── Cloud Render View ───────────────────────────────────────

function CloudRenderView({
    isOpen,
    onClose,
    phase,
    progress,
    onStartRender,
}: {
    isOpen: boolean;
    onClose: () => void;
    phase: CloudRenderPhase;
    progress: number;
    onStartRender: () => void;
}) {
    const startedRef = useRef(false);

    useEffect(() => {
        if (isOpen && !startedRef.current && (phase === 'idle' || phase === 'failed')) {
            startedRef.current = true;
            onStartRender();
        }
        if (!isOpen) {
            startedRef.current = false;
        }
    }, [isOpen, phase, onStartRender]);

    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
    const isQueued = phase === 'saving' || phase === 'queued';
    const isRendering = phase === 'rendering';
    const isDownloading = phase === 'downloading';
    const isCompleted = phase === 'completed';

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-md">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h2 className="heading-2">Cloud Rendering</h2>
                    <XButton onClick={onClose} title="Close" />
                </div>

                <div className="flex flex-col gap-3">
                    {isQueued && (
                        <div className="flex items-center gap-3 py-4">
                            <div className="h-5 w-5 border-2 border-border-hover border-t-primary rounded-full animate-spin" />
                            <span className="text-sm text-text-main">Queued — waiting for render worker...</span>
                        </div>
                    )}

                    {isRendering && (
                        <>
                            <div className="h-2 bg-surface rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-300 ease-out"
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between text-xs text-text-main">
                                <span>{pct}%</span>
                                <span>Rendering...</span>
                            </div>
                        </>
                    )}

                    {isDownloading && (
                        <div className="flex items-center gap-3 py-4">
                            <div className="h-5 w-5 border-2 border-border-hover border-t-primary rounded-full animate-spin" />
                            <span className="text-sm text-text-main">Downloading your video...</span>
                        </div>
                    )}

                    {isCompleted && (
                        <div className="flex items-center gap-3 py-4">
                            <span className="text-sm text-text-highlighted">Download complete!</span>
                        </div>
                    )}

                    {phase === 'failed' && (
                        <div className="flex items-center gap-3 py-4">
                            <span className="text-sm text-destructive">Render failed. Please try again.</span>
                        </div>
                    )}
                </div>

                {(isQueued || isRendering) && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-border text-xs text-text-muted">
                        <HiOutlineBolt className="icon-lg text-primary shrink-0" />
                        <span>You can close this dialog. We'll notify you when your file is ready.</span>
                    </div>
                )}

                <div className="flex justify-end pt-1">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-surface hover:bg-surface-hover text-text-highlighted text-sm rounded transition-colors border border-border"
                    >
                        Close
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ─── Local Render View ───────────────────────────────────────

function LocalRenderView({
    isOpen,
    onClose,
    onBack,
    quality,
}: {
    isOpen: boolean;
    onClose: () => void;
    onBack: () => void;
    quality: ExportQuality;
}) {
    const { addToast } = useToast();
    const project = useProjectStore(s => s.project);
    const projectName = useProjectName();
    const videoDecodePreference = useUIStore(s => s.videoDecodePreference);
    const setVideoDecodePreference = useUIStore(s => s.setVideoDecodePreference);

    const { localRenderProgress, startOrCancel } = useLocalRender({
        project,
        projectName,
        quality,
        videoDecodePreference,
        onDecodeFallback: () => setVideoDecodePreference('cpu'),
    });

    const startedRef = useRef(false);

    const renderStartRef = useRef(0);

    useEffect(() => {
        if (isOpen && !startedRef.current) {
            startedRef.current = true;
            renderStartRef.current = performance.now();
            (async () => {
                const result = await startOrCancel();
                if (result.success) {
                    addToast({ type: 'success', title: 'Export complete' });
                    const renderDurationS = Math.round((performance.now() - renderStartRef.current) / 1000);
                    trackRenderLocallyCompleted({
                        project_id: project.id,
                        video_duration_s: Math.round(project.timeline.durationMs / 1000),
                        render_duration_s: renderDurationS,
                        input_resolution: `${project.screenSource.size.width}x${project.screenSource.size.height}`,
                        output_resolution: `${project.settings.outputSize.width}x${project.settings.outputSize.height}`,
                        quality,
                    });
                    onClose();
                    void maybeOpenLeaveReviewModal('export_completed');
                } else if (result.error) {
                    trackRenderLocallyFailed({
                        project_id: project.id,
                        error: result.error,
                        error_name: result.errorName,
                        error_stack: result.errorStack,
                        phase: result.phase,
                        is_offline: !navigator.onLine,
                        video_duration_s: Math.round(project.timeline.durationMs / 1000),
                        input_resolution: `${project.screenSource.size.width}x${project.screenSource.size.height}`,
                        output_resolution: `${project.settings.outputSize.width}x${project.settings.outputSize.height}`,
                    });
                    addToast({ type: 'error', title: 'Export failed', message: result.error });
                    onBack();
                }
            })();
        }
        if (!isOpen) {
            startedRef.current = false;
        }
    }, [isOpen]);

    const phase = localRenderProgress?.phase;
    const pct = Math.max(0, Math.min(100, Math.round((localRenderProgress?.progress ?? 0) * 100)));

    const handleCancel = async () => {
        await startOrCancel();
        onBack();
    };

    return (
        <Modal isOpen={isOpen} maxWidth="max-w-md">
            <div className="flex flex-col gap-4">
                <h2 className="heading-2">Exporting Video</h2>

                <div className="flex flex-col gap-2">
                    {phase === 'preparing' ? (
                        <div className="flex items-center gap-3 py-4">
                            <div className="h-5 w-5 border-2 border-border-hover border-t-primary rounded-full animate-spin" />
                            <span className="text-sm text-text-main">Preparing...</span>
                        </div>
                    ) : (
                        <>
                            <div className="h-2 bg-surface rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-300 ease-out"
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between text-xs text-text-main">
                                <span>{pct}%</span>
                                <span>Rendering locally...</span>
                            </div>
                        </>
                    )}

                    <div className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-border text-xs text-text-main">
                        <HiOutlineBolt className="icon-lg text-primary shrink-0" />
                        <span>Do not switch tabs during export for best performance</span>
                    </div>
                </div>

                <div className="flex justify-end pt-1">
                    <button
                        onClick={handleCancel}
                        className="px-4 py-2 bg-surface hover:bg-surface-hover text-text-highlighted text-sm rounded transition-colors border border-border"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </Modal>
    );
}

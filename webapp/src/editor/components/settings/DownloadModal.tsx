import { useState, useEffect, useRef } from 'react';
import { Modal, XButton, Button, MultiToggle, Toggle, type MultiToggleOption } from '@shared/components';
import { LuLock, LuZap } from 'react-icons/lu';
import { useProjectStore, useProjectName } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useToast } from '../../../components/Toast';
import { useLocalRender } from './useLocalRender';
import { ProUpgradeModal } from '../../../billing/ProUpgradeModal';
import { useEntitlements } from '../../../billing/useEntitlements';
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

type ModalView = 'choose' | 'local';

interface DownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStartCloudRender: (quality: ExportQuality) => void;
}

export function DownloadModal({
    isOpen,
    onClose,
    onStartCloudRender,
}: DownloadModalProps) {
    const [view, setView] = useState<ModalView>('choose');

    const project = useProjectStore(s => s.project);
    const entitlements = useEntitlements();
    // Any setting is freely selectable; entitlements are checked on Export
    const [quality, setQuality] = useState<RenderQuality>('1080p');
    const [cloudExport, setCloudExport] = useState(true);
    const [isProModalOpen, setIsProModalOpen] = useState(false);
    const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>();
    const [upgradeReason, setUpgradeReason] = useState<UpgradeModalReason>('export');

    // Closing rewinds to the choice screen, so reopening never lands mid-flow
    const handleClose = () => {
        setView('choose');
        onClose();
    };

    // A cloud export has no view of its own: it starts in the background and
    // the editor goes back to the project. Progress shows on the Download
    // button, and ActivityToasts announces the end (and the review ask) even
    // if the user has left the editor by then. Local renders still need this
    // tab, so LocalRenderView below keeps its progress modal.

    if (!isOpen) return null;

    if (view === 'local') {
        return (
            <LocalRenderView
                isOpen={isOpen}
                onClose={handleClose}
                onBack={() => setView('choose')}
                quality={quality}
            />
        );
    }

    // ─── Choice Screen ───────────────────────────────────────

    const durationMs = project.timeline.durationMs;
    const durationLabel = formatDurationLabel(durationMs);
    const resolutionLabel = QUALITY_LABELS[quality];
    const localEstimate = estimateLocalTime(durationMs);

    const lockIcon = entitlements.can4k ? undefined : <LuLock className="icon-sm" />;
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
            onStartCloudRender(quality);
            handleClose();
        } else {
            trackRenderLocallyClicked(project.id);
            setView('local');
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} maxWidth="max-w-lg">
            <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="heading-2">Download video</h2>
                        <p className="text-sm text-text-muted mt-0.5">
                            {durationLabel} · {resolutionLabel} · MP4
                        </p>
                    </div>
                    <XButton onClick={handleClose} title="Close" />
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
                    <p className="text-label leading-relaxed">
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
                        <LuZap className="icon-lg text-primary shrink-0" />
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

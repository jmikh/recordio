import { useState, useEffect, useRef } from 'react';
import { Modal, XButton, Button } from '@shared/components';
import { HiOutlineBolt } from 'react-icons/hi2';
import { TbDeviceDesktop, TbCloud } from 'react-icons/tb';
import { PiWarningFill } from 'react-icons/pi';
import { useProjectStore, useProjectName } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useToast } from '../Toast';
import { useLocalRender } from './useLocalRender';
import type { CloudRenderPhase } from './useCloudRender';

function formatDurationLabel(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    if (m === 0) return `${s} sec`;
    if (s === 0) return `${m} min`;
    return `${m} min ${s} sec`;
}

function formatResolution(height: number): string {
    if (height >= 2160) return '4K';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    return `${height}p`;
}

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
    hasNonFreeAccess: boolean;
    cloudPhase: CloudRenderPhase;
    cloudProgress: number;
    onStartCloudRender: () => void;
    onUpgrade: () => void;
}

export function DownloadModal({
    isOpen,
    onClose,
    hasNonFreeAccess,
    cloudPhase,
    cloudProgress,
    onStartCloudRender,
    onUpgrade,
}: DownloadModalProps) {
    // If cloud render is already in progress, skip choice screen
    const cloudActive = cloudPhase !== 'idle' && cloudPhase !== 'completed' && cloudPhase !== 'failed';
    const [view, setView] = useState<ModalView>(cloudActive ? 'cloud' : 'choose');

    const project = useProjectStore(s => s.project);

    // Reset view when modal reopens, and clear stale view on close
    useEffect(() => {
        if (isOpen) {
            setView(cloudActive ? 'cloud' : 'choose');
        } else {
            setView('choose');
        }
    }, [isOpen, cloudActive]);

    if (!isOpen) return null;

    if (view === 'local') {
        return (
            <LocalRenderView
                isOpen={isOpen}
                onClose={onClose}
                onBack={() => setView('choose')}
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
                onStartRender={onStartCloudRender}
            />
        );
    }

    // ─── Choice Screen ───────────────────────────────────────

    const durationMs = project.timeline.durationMs;
    const outputHeight = project.settings.outputSize.height;
    const durationLabel = formatDurationLabel(durationMs);
    const resolutionLabel = formatResolution(outputHeight);
    const localEstimate = estimateLocalTime(durationMs);

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-lg">
            <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-text-highlighted font-semibold text-lg">Download video</h2>
                        <p className="text-sm text-text-muted mt-0.5">
                            {durationLabel} · {resolutionLabel} · MP4
                        </p>
                    </div>
                    <XButton onClick={onClose} title="Close" />
                </div>

                <div className="flex flex-col gap-3">
                    {/* Cloud card */}
                    <div className="relative rounded-lg border-2 border-primary p-5">
                        <span className="absolute -top-2.5 left-4 bg-primary text-text-on-primary text-xs font-semibold px-2.5 py-0.5 rounded-full">
                            Recommended
                        </span>

                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                                <TbCloud className="text-primary" size={22} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold text-text-highlighted">Cloud render</p>
                                </div>
                                <p className="text-sm text-text-muted mt-1 leading-relaxed">
                                    Renders in the background. Continue your work, get notified when it's ready.
                                </p>

                                {hasNonFreeAccess ? (
                                    <Button
                                        variant="primary"
                                        onClick={() => setView('cloud')}
                                        className="w-full mt-4"
                                    >
                                        Render in cloud
                                    </Button>
                                ) : (
                                    <Button
                                        variant="primary"
                                        onClick={onUpgrade}
                                        className="w-full mt-4"
                                    >
                                        Upgrade
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Local card */}
                    <div className="rounded-lg border border-border p-5">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-md bg-state-inactive flex items-center justify-center shrink-0">
                                <TbDeviceDesktop className="text-text-muted" size={22} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold text-text-highlighted">Local render</p>
                                </div>
                                <p className="text-sm text-text-muted mt-1 leading-relaxed">
                                    Renders right here. Free, but you'll need to keep this tab in focus.
                                </p>

                                <Button
                                    variant="base"
                                    onClick={() => setView('local')}
                                    className="w-full mt-4"
                                >
                                    Render locally
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
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
                    <h2 className="text-text-highlighted font-semibold text-lg">Cloud Rendering</h2>
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
                            <span className="text-sm text-text-highlighted font-medium">Download complete!</span>
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
}: {
    isOpen: boolean;
    onClose: () => void;
    onBack: () => void;
}) {
    const { addToast } = useToast();
    const project = useProjectStore(s => s.project);
    const projectName = useProjectName();
    const videoDecodePreference = useUIStore(s => s.videoDecodePreference);
    const setVideoDecodePreference = useUIStore(s => s.setVideoDecodePreference);

    const { localRenderProgress, startOrCancel } = useLocalRender({
        project,
        projectName,
        videoDecodePreference,
        onDecodeFallback: () => setVideoDecodePreference('cpu'),
    });

    const startedRef = useRef(false);

    useEffect(() => {
        if (isOpen && !startedRef.current) {
            startedRef.current = true;
            (async () => {
                const result = await startOrCancel();
                if (result.success) {
                    addToast({ type: 'success', title: 'Export complete' });
                    onClose();
                } else if (result.error) {
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
                <h2 className="text-text-highlighted font-semibold text-lg">Exporting Video</h2>

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

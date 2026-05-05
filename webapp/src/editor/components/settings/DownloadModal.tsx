import { useState, useEffect, useRef } from 'react';
import { Modal, XButton, Button } from '@shared/components';
import { HiOutlineBolt } from 'react-icons/hi2';
import { TbDeviceDesktop, TbCloud } from 'react-icons/tb';
import { useProjectStore, useProjectName } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useToast } from '../Toast';
import { useLocalRender } from './useLocalRender';
import type { CloudRenderPhase } from './useCloudRender';

type ModalView = 'choose' | 'local' | 'cloud';

interface DownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
    hasProAccess: boolean;
    cloudPhase: CloudRenderPhase;
    cloudProgress: number;
    onStartCloudRender: () => void;
    onUpgrade: () => void;
}

export function DownloadModal({
    isOpen,
    onClose,
    hasProAccess,
    cloudPhase,
    cloudProgress,
    onStartCloudRender,
    onUpgrade,
}: DownloadModalProps) {
    // If cloud render is already in progress, skip choice screen
    const cloudActive = cloudPhase !== 'idle' && cloudPhase !== 'completed' && cloudPhase !== 'failed';
    const [view, setView] = useState<ModalView>(cloudActive ? 'cloud' : 'choose');

    // Reset view when modal reopens
    useEffect(() => {
        if (isOpen) {
            setView(cloudActive ? 'cloud' : 'choose');
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

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-lg">
            <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between">
                    <h2 className="text-text-highlighted font-semibold text-lg">Export Video</h2>
                    <XButton onClick={onClose} title="Close" />
                </div>

                <div className="flex gap-3">
                    {/* Local card */}
                    <button
                        onClick={() => setView('local')}
                        className="flex-1 flex flex-col items-center gap-3 p-5 rounded-lg border border-border bg-surface hover:bg-surface-hover hover:border-primary/50 transition-all cursor-pointer text-center"
                    >
                        <TbDeviceDesktop className="text-primary" size={28} />
                        <div>
                            <p className="text-sm font-semibold text-text-highlighted">Local</p>
                            <p className="text-xs text-text-muted mt-1 leading-relaxed">
                                Can be faster on high-end devices. Must keep tab in focus.
                            </p>
                        </div>
                    </button>

                    {/* Cloud card */}
                    {hasProAccess ? (
                        <button
                            onClick={() => setView('cloud')}
                            className="flex-1 flex flex-col items-center gap-3 p-5 rounded-lg border border-border bg-surface hover:bg-surface-hover hover:border-primary/50 transition-all cursor-pointer text-center"
                        >
                            <TbCloud className="text-primary" size={28} />
                            <div>
                                <p className="text-sm font-semibold text-text-highlighted">Cloud</p>
                                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                                    Runs in the background. We'll notify you when it's done.
                                </p>
                            </div>
                        </button>
                    ) : (
                        <div className="flex-1 flex flex-col items-center gap-3 p-5 rounded-lg border border-border bg-surface text-center">
                            <TbCloud className="text-text-disabled" size={28} />
                            <div>
                                <p className="text-sm font-semibold text-text-muted">Cloud</p>
                                <p className="text-xs text-text-disabled mt-1 leading-relaxed">
                                    Runs in the background. We'll notify you when it's done.
                                </p>
                            </div>
                            <Button
                                variant="primary"
                                onClick={onUpgrade}
                                className="text-xs px-4 py-1.5 mt-1"
                            >
                                Upgrade
                            </Button>
                        </div>
                    )}
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
    const isQueued = phase === 'saving' || phase === 'queued' || (phase === 'rendering' && progress === 0);
    const isRendering = phase === 'rendering' && progress > 0;
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
                        <HiOutlineBolt className="icon-lg text-primary flex-shrink-0" />
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
                        <HiOutlineBolt className="icon-lg text-primary flex-shrink-0" />
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

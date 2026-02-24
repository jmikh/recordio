import React, { useState, useEffect } from 'react';
import { FaCrown } from 'react-icons/fa';
import { TbSettings2, TbBoxAlignTopLeft, TbBoxAlignTopRight, TbBoxAlignBottomLeft, TbBoxAlignBottomRight } from 'react-icons/tb';
import { CollapsibleCard, MultiToggle, Dropdown, Toggle } from '@shared/components';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import { ExportManager } from '../../export/ExportManager';
import type { ExportQuality, ExportFps } from '../../export/ExportManager';
import type { WatermarkPosition } from '../../../core/painters/watermarkPainter';
import { trackExportCompleted } from '../../../core/analytics';
import { TimeMapper } from '../../../core/mappers/timeMapper';
import { useToast } from '../Toast';

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
    const [showWatermark, setShowWatermark] = useState<boolean | null>(null); // null = use default
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

    const { isAuthenticated, isPro, hasProAccess, hasFreeTrial, freeTrialUntil } = useUserStore();
    const proAccess = hasProAccess();
    const activeTrial = hasFreeTrial();

    // Watermark defaults: OFF for pro/trial, ON for everyone else
    const effectiveShowWatermark = showWatermark ?? !proAccess;
    const canToggleWatermark = proAccess;

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

    const handleExport = () => {
        if (isExporting) return;

        const needsProFeature = (selectedQuality === '1080p' || selectedQuality === '2K' || selectedQuality === '4K' || selectedFps === 60);

        // If user has pro access (subscription or trial), export freely
        if (proAccess || !needsProFeature) {
            startExport(selectedQuality, selectedFps, { watermarkPosition: effectiveShowWatermark ? watermarkPosition : undefined });
            return;
        }

        // No access — show upgrade modal
        setIsUpgradeModalOpen(true);
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
            console.error(e);
            if (e?.message) {
                addToast({ type: 'error', title: 'Export Failed', message: e.message });
            }
        } finally {
            setExportState({ isExporting: false });
            (window as any).__activeExportManager = null;
        }
    };

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
                        <span className="text-sm text-text-muted w-1/2 shrink-0">Quality</span>
                        <Dropdown
                            options={QUALITY_OPTIONS.map(opt => ({
                                value: opt.value,
                                label: opt.label,
                                disabled: opt.proOnly && !proAccess,
                                suffix: opt.proOnly && !isPro ? (
                                    <span className="bg-primary text-text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none uppercase">
                                        Pro
                                    </span>
                                ) : undefined,
                            }))}
                            value={selectedQuality}
                            onChange={(val) => setSelectedQuality(val)}
                        />
                    </div>

                    {/* FPS Selection */}
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-text-muted w-1/2 shrink-0">Frame Rate</span>
                        <Dropdown
                            options={FPS_OPTIONS.map(opt => ({
                                value: opt.value,
                                label: opt.label,
                                disabled: opt.proOnly && !proAccess,
                                suffix: opt.proOnly && !isPro ? (
                                    <span className="bg-primary text-text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none uppercase">
                                        Pro
                                    </span>
                                ) : undefined,
                            }))}
                            value={selectedFps}
                            onChange={(val) => setSelectedFps(val)}
                        />
                    </div>

                    {/* Trial / Auth Status */}
                    {!isPro && (
                        activeTrial && freeTrialUntil ? (
                            /* Active trial reminder */
                            <div className="bg-primary/10 border border-primary/20 rounded-md px-3 py-2.5">
                                <p className="text-xs text-primary flex items-center gap-1.5">
                                    <FaCrown className="shrink-0" size={11} />
                                    Pro trial · {formatTrialRemaining(freeTrialUntil)}
                                </p>
                            </div>
                        ) : !isAuthenticated ? (
                            <div className="bg-state-inactive border border-border rounded-md px-3 py-2.5">
                                <p className="text-xs text-text-muted">
                                    <button
                                        onClick={() => setIsAuthModalOpen(true)}
                                        className="text-primary hover:text-primary-highlighted underline font-medium cursor-pointer"
                                    >
                                        Sign in
                                    </button>
                                    {' '}to start your free Pro trial
                                </p>
                            </div>
                        ) : (
                            <div className="bg-state-inactive border border-border rounded-md px-3 py-2.5">
                                <p className="text-xs text-text-muted">
                                    Pro trial expired
                                </p>
                            </div>
                        )
                    )}

                    {/* Watermark Toggle */}
                    <div className="flex flex-col gap-2">
                        <Toggle
                            label="Recordio Watermark"
                            value={effectiveShowWatermark}
                            onChange={(val) => setShowWatermark(val)}
                            disabled={!canToggleWatermark}
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

                    {/* Upgrade Button */}
                    {!isPro && (
                        <button
                            onClick={() => setIsUpgradeModalOpen(true)}
                            className="flex items-center justify-center gap-2 w-full py-2 text-sm font-medium text-primary border border-primary/30 rounded-[var(--radius-interactive)] hover:bg-primary/10 transition-colors cursor-pointer"
                        >
                            <FaCrown size={14} />
                            Upgrade to Pro
                        </button>
                    )}

                    {/* Export Button */}
                    <button
                        onClick={handleExport}
                        className="interactive-primary flex items-center justify-center gap-2 w-full"
                        disabled={isExporting}
                    >
                        Export
                    </button>
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

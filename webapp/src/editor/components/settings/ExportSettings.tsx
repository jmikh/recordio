import React, { useState, useEffect } from 'react';
import { BiCrown } from 'react-icons/bi';
import { TbSettings2, TbBoxAlignTopLeft, TbBoxAlignTopRight, TbBoxAlignBottomLeft, TbBoxAlignBottomRight } from 'react-icons/tb';
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
                    {/* Quality Selection — all selectable, Pro badge as indicator */}
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

                    {/* FPS Selection — all selectable, Pro badge as indicator */}
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

                    {/* Watermark — static line for non-Pro, toggle for Pro */}
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

                    {/* Export Button — disabled when Pro features selected by non-Pro */}
                    <Tooltip text={needsProFeature ? 'Pro settings selected — upgrade to export' : ''}>
                        <button
                            onClick={handleExport}
                            className="interactive-primary flex items-center justify-center gap-2 w-full"
                            disabled={isExporting || needsProFeature}
                        >
                            Export
                        </button>
                    </Tooltip>

                    {/* Upgrade Button — shown when user has no Pro access */}
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

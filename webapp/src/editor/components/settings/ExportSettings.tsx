import React, { useState } from 'react';
import { FaCrown, FaGift } from 'react-icons/fa';
import { TbSettings2, TbBoxAlignTopLeft, TbBoxAlignTopRight, TbBoxAlignBottomLeft, TbBoxAlignBottomRight } from 'react-icons/tb';
import { CollapsibleCard, MultiToggle } from '@shared/components';
import type { PreviewItem } from '@shared/components';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import { ExportManager } from '../../export/ExportManager';
import type { ExportQuality } from '../../export/ExportManager';
import type { WatermarkPosition } from '../../../core/painters/watermarkPainter';
import { trackExportCompleted } from '../../../core/analytics';
import { TimeMapper } from '../../../core/mappers/timeMapper';
import { useToast } from '../Toast';

import { AuthModal } from '../header/AuthModal';
import { UpgradeModal } from '../header/UpgradeModal';
import { FreeExportConfirmModal } from '../header/FreeExportConfirmModal';

const QUALITY_OPTIONS: { value: ExportQuality; label: string; proOnly: boolean }[] = [
    { value: '360p', label: '360p', proOnly: false },
    { value: '720p', label: '720p', proOnly: false },
    { value: '1080p', label: '1080p', proOnly: true },
    { value: '4K', label: '4K', proOnly: true },
];

const WATERMARK_POSITIONS: { value: WatermarkPosition; label: string; icon: React.ReactNode }[] = [
    { value: 'top-left', label: 'Top Left', icon: <TbBoxAlignTopLeft size={18} /> },
    { value: 'top-right', label: 'Top Right', icon: <TbBoxAlignTopRight size={18} /> },
    { value: 'bottom-left', label: 'Bottom Left', icon: <TbBoxAlignBottomLeft size={18} /> },
    { value: 'bottom-right', label: 'Bottom Right', icon: <TbBoxAlignBottomRight size={18} /> },
];

export function ExportSettings() {
    const { addToast } = useToast();

    const [selectedQuality, setSelectedQuality] = useState<ExportQuality>('720p');
    const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>('bottom-right');
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [isFreeExportModalOpen, setIsFreeExportModalOpen] = useState(false);

    const { isAuthenticated, isPro, canExportQuality, hasFreeExportCredit } = useUserStore();
    const hasCredit = hasFreeExportCredit();
    const showWatermarkOptions = !isPro;

    // Collapsible visibility state
    const showCollapsibleExportQuality = useUIStore(s => s.showCollapsibleExportQuality);
    const showCollapsibleExportWatermark = useUIStore(s => s.showCollapsibleExportWatermark);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    const project = useProjectData();
    const setExportState = useProjectStore(s => s.setExportState);
    const isExporting = useProjectStore(s => s.exportState.isExporting);

    const handleExport = () => {
        if (isExporting) return;

        if (!canExportQuality(selectedQuality)) {
            setIsUpgradeModalOpen(true);
            return;
        }

        if (hasFreeExportCredit() && (selectedQuality === '1080p' || selectedQuality === '4K')) {
            setIsFreeExportModalOpen(true);
            return;
        }

        startExport(selectedQuality, { watermarkPosition });
    };

    const startExport = async (quality: ExportQuality, options?: { useFreeCredit?: boolean; watermarkPosition?: WatermarkPosition }) => {
        setIsFreeExportModalOpen(false);
        useUIStore.getState().setIsPlaying(false);
        setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null });

        const manager = new ExportManager();
        const onProgress = (state: any) => setExportState(state);

        try {
            (window as any).__activeExportManager = manager;
            await manager.exportProject(project, quality, onProgress, options);

            const totalDurationMs = new TimeMapper(project.timeline.outputWindows).outputDuration;
            trackExportCompleted({
                quality,
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

    // Build preview items for quality card
    const qualityPreviewItems: PreviewItem[] = [
        { type: 'text', content: selectedQuality },
    ];

    // Build preview items for watermark card
    const watermarkPreviewItems: PreviewItem[] = [
        { type: 'text', content: WATERMARK_POSITIONS.find(p => p.value === watermarkPosition)?.label || watermarkPosition },
    ];

    return (
        <div className="flex flex-col gap-3 text-sm text-text-main">
            {/* Quality Selection */}
            <CollapsibleCard
                title="Quality"
                icon={<TbSettings2 size={16} />}
                previewItems={qualityPreviewItems}
                isExpanded={showCollapsibleExportQuality}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleExportQuality', v)}
            >
                <div className="flex flex-col gap-1">
                    {QUALITY_OPTIONS.map(opt => {
                        const isActive = selectedQuality === opt.value;
                        return (
                            <div
                                key={opt.value}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isActive
                                    ? 'bg-primary/15 text-primary'
                                    : 'bg-transparent text-text-main hover:bg-state-hover'
                                    }`}
                                onClick={() => setSelectedQuality(opt.value)}
                            >
                                <span className="text-sm flex-1">{opt.label}</span>
                                {opt.proOnly && !isPro && (
                                    <span className="bg-primary text-text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none uppercase">
                                        Pro
                                    </span>
                                )}
                                {isActive && (
                                    <span className="text-xs text-primary">●</span>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Free Credit Status */}
                {!isPro && (
                    <div className="bg-state-inactive border border-border rounded-md px-3 py-2.5 mt-3">
                        {!isAuthenticated ? (
                            <p className="text-xs text-text-muted">
                                <button
                                    onClick={() => setIsAuthModalOpen(true)}
                                    className="text-primary hover:text-primary-highlighted underline font-medium cursor-pointer"
                                >
                                    Sign in
                                </button>
                                {' '}to claim your free 4K export credit
                            </p>
                        ) : hasCredit ? (
                            <p className="text-xs text-text-highlighted flex items-center gap-1.5">
                                <FaGift className="text-primary shrink-0" size={12} />
                                Free HD/4K credit available
                            </p>
                        ) : (
                            <p className="text-xs text-text-muted">
                                Free credit used
                            </p>
                        )}
                    </div>
                )}
            </CollapsibleCard>

            {/* Watermark Placement */}
            {showWatermarkOptions && (
                <CollapsibleCard
                    title="Watermark"
                    icon={<TbBoxAlignBottomRight size={16} />}
                    previewItems={watermarkPreviewItems}
                    isExpanded={showCollapsibleExportWatermark}
                    onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleExportWatermark', v)}
                >
                    <MultiToggle
                        options={WATERMARK_POSITIONS.map(pos => ({
                            value: pos.value,
                            icon: pos.icon,
                            tooltip: pos.label,
                        }))}
                        value={watermarkPosition}
                        onChange={(val) => setWatermarkPosition(val as WatermarkPosition)}
                    />
                </CollapsibleCard>
            )}

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
                Export {selectedQuality}
            </button>

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
            <FreeExportConfirmModal
                isOpen={isFreeExportModalOpen}
                onClose={() => setIsFreeExportModalOpen(false)}
                onConfirm={() => startExport(selectedQuality, { useFreeCredit: true, watermarkPosition })}
                selectedQuality={selectedQuality}
            />
        </div>
    );
}

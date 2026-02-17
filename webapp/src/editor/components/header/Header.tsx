import { useState } from 'react';
import { useProjectStore, useProjectData, useProjectHistory } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { ExportManager } from '../../export/ExportManager';
import type { ExportQuality } from '../../export/ExportManager';
import { Dropdown } from '@shared/components';
import type { DropdownOption } from '@shared/components';
import { FaUndo, FaRedo } from 'react-icons/fa';
import { MdDarkMode, MdLightMode } from 'react-icons/md';
import { BiSupport } from 'react-icons/bi';
import { DefaultButton, GhostButton } from '@shared/components';

import { AuthModal } from './AuthModal';
import { SupportModal } from '../../../components/SupportModal';
import { UserMenu } from './UserMenu';
import { UpgradeModal } from './UpgradeModal';
import { FreeExportConfirmModal } from './FreeExportConfirmModal';
import { useUserStore } from '../../stores/useUserStore';
import { LogoLink } from '@shared/components';
import { trackExportCompleted } from '../../../core/analytics';
import { TimeMapper } from '../../../core/mappers/timeMapper';
import { useToast } from '../Toast';


export const Header = () => {
    const { addToast } = useToast();

    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [isFreeExportModalOpen, setIsFreeExportModalOpen] = useState(false);
    const [selectedQuality, setSelectedQuality] = useState<ExportQuality | null>(null);
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const { isAuthenticated, isPro, canExportQuality, hasFreeExportCredit, theme, setTheme } = useUserStore();

    const proPill = (
        <span className="bg-primary text-text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none uppercase">
            Pro
        </span>
    );
    const exportQualityOptions: DropdownOption<ExportQuality>[] = [
        { value: '360p', label: '360p' },
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p', suffix: proPill },
        { value: '4K', label: '4K', suffix: proPill },
    ];
    const project = useProjectData();
    const updateProjectName = useProjectStore(s => s.updateProjectName);
    const isSaving = useProjectStore(s => s.isSaving);
    const setExportState = useProjectStore(s => s.setExportState);
    const isExporting = useProjectStore(s => s.exportState.isExporting);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const pastStates = useProjectHistory(state => state.pastStates);
    const futureStates = useProjectHistory(state => state.futureStates);

    const handleExport = async (quality: ExportQuality) => {
        if (isExporting) return;

        // Check if user can export this quality
        if (!canExportQuality(quality)) {
            setSelectedQuality(quality);
            setIsUpgradeModalOpen(true);
            return;
        }

        // If user has a free credit and this is an HD/4K export, confirm before proceeding
        if (hasFreeExportCredit() && (quality === '1080p' || quality === '4K')) {
            setSelectedQuality(quality);
            setIsFreeExportModalOpen(true);
            return;
        }

        startExport(quality);
    };

    const startExport = async (quality: ExportQuality, options?: { useFreeCredit?: boolean }) => {
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
                auto_zoom: project.settings.zoom.isAuto,
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
        <div className="bg-surface border-b border-border flex flex-col shrink-0 z-[var(--z-index-navbar)] select-none" style={{ boxShadow: 'var(--shadow-panel)' }}>
            {/* Top Row: Main Controls */}
            <div className="h-12 flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <LogoLink className="mr-2" imgClassName="h-7" />
                    <div className="h-4 w-[1px] bg-border mx-2"></div>

                    <div className="flex items-center gap-1">
                        <GhostButton
                            onClick={() => undo()}
                            disabled={pastStates.length === 0}
                            title="Undo (Cmd+Z)"
                            className="p-1.5"
                        >
                            <FaUndo size={14} />
                        </GhostButton>
                        <GhostButton
                            onClick={() => redo()}
                            disabled={futureStates.length === 0}
                            title="Redo (Cmd+Shift+Z)"
                            className="p-1.5"
                        >
                            <FaRedo size={14} />
                        </GhostButton>
                    </div>

                    {import.meta.env.MODE !== 'production' && (
                        <>
                            <div className="h-4 w-[1px] bg-border mx-2"></div>

                            {<button
                                onClick={() => useUIStore.getState().toggleDebugBar()}
                                title="Toggle Debug Bar"
                                className="px-2 py-1 text-[10px] text-text-main hover:text-text-highlighted hover:bg-surface rounded border border-border"
                            >
                                Debug
                            </button>}
                        </>
                    )}
                </div>

                {/* Project Name (Centered in Top Row) */}
                <input
                    type="text"
                    value={project.name}
                    onChange={(e) => updateProjectName(e.target.value)}
                    maxLength={40}
                    className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 bg-state-inactive text-text-main text-sm text-center border border-border focus:text-text-highlighted hover:bg-state-hover hover:border-border-highlighted focus:bg-state-hover focus:border-border-highlighted rounded px-2 py-0.5 transition-colors placeholder-text-main w-[300px] focus-ring"
                    placeholder="Untitled Project"
                />

                <div className="flex items-center gap-4">
                    <Dropdown
                        options={exportQualityOptions}
                        value={null as any}
                        onChange={handleExport}
                        placeholder="Export"
                        fullWidth={false}
                        buttonClassName="!bg-primary !text-text-on-primary hover:!bg-primary-highlighted"
                    />
                    {/* User Authentication */}
                    {isAuthenticated ? (
                        <UserMenu onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)} />
                    ) : (
                        <DefaultButton onClick={() => setIsAuthModalOpen(true)} title="Sign in to unlock Pro features">
                            Sign In
                        </DefaultButton>
                    )}
                    <DefaultButton onClick={() => setIsSupportModalOpen(true)} title="Contact Support">
                        <BiSupport size={18} />
                    </DefaultButton>
                    <DefaultButton
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        {theme === 'dark' ? <MdLightMode size={18} /> : <MdDarkMode size={18} />}
                    </DefaultButton>
                </div>
            </div>

            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
                onAuthSuccess={() => {
                    // If upgrade modal was open before login, re-show it
                    if (selectedQuality) {
                        setIsUpgradeModalOpen(true);
                    }
                }}
            />
            <UpgradeModal
                isOpen={isUpgradeModalOpen}
                onClose={() => setIsUpgradeModalOpen(false)}
                onSignInRequest={() => setIsAuthModalOpen(true)}
                selectedQuality={selectedQuality}
            />
            {selectedQuality && (
                <FreeExportConfirmModal
                    isOpen={isFreeExportModalOpen}
                    onClose={() => setIsFreeExportModalOpen(false)}
                    onConfirm={() => startExport(selectedQuality, { useFreeCredit: true })}
                    selectedQuality={selectedQuality}
                />
            )}
            <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
        </div>
    );
};

import { useState } from 'react';
import { useProjectStore, useProjectData, useProjectHistory } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { ExportManager } from '../../export/ExportManager';
import type { ExportQuality } from '../../export/ExportManager';
import { Dropdown } from '@shared/components';
import type { DropdownOption } from '@shared/components';
import { FaUndo, FaRedo } from 'react-icons/fa';
import { MdBugReport, MdDarkMode, MdLightMode } from 'react-icons/md';
import { DefaultButton } from '@shared/components';
import { BugReportModal } from '../../../components/BugReportModal';
import { AuthModal } from './AuthModal';
import { UserMenu } from './UserMenu';
import { UpgradeModal } from './UpgradeModal';
import { useUserStore } from '../../stores/useUserStore';
import { LogoLink } from '@shared/components';
import { trackExportCompleted } from '../../../core/analytics';

const EXPORT_QUALITY_OPTIONS: DropdownOption<ExportQuality>[] = [
    { value: '360p', label: '360p' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '4K', label: '4K' },
];

export const Header = () => {
    const [isBugReportModalOpen, setIsBugReportModalOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [selectedQuality, setSelectedQuality] = useState<ExportQuality | null>(null);
    const { isAuthenticated, isPro, canExportQuality, theme, setTheme } = useUserStore();
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
            // User needs Pro subscription for this quality
            setSelectedQuality(quality);
            setIsUpgradeModalOpen(true);
            return;
        }

        setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null });

        const manager = new ExportManager();
        const onProgress = (state: any) => setExportState(state);

        try {
            // Assign to global for cancellation (hacky but effective for single active export)
            (window as any).__activeExportManager = manager;

            await manager.exportProject(project, quality, onProgress, isPro);

            // Track successful export
            const totalDurationMs = project.timeline.outputWindows.length > 0
                ? project.timeline.outputWindows[project.timeline.outputWindows.length - 1].endMs
                : 0;

            trackExportCompleted({
                quality,
                duration_seconds: Math.floor(totalDurationMs / 1000),
                auto_zoom: project.settings.zoom.isAuto,
                is_authenticated: isAuthenticated,
                is_pro: isPro,
            });
        } catch (e) {
            console.error(e);
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
                    <LogoLink className="mr-2" imgClassName="h-8" theme={theme} />
                    <div className="h-4 w-[1px] bg-border mx-2"></div>

                    <div className="flex items-center gap-1">
                        <DefaultButton
                            onClick={() => undo()}
                            disabled={pastStates.length === 0}
                            title="Undo (Cmd+Z)"
                            className="p-1.5"
                        >
                            <FaUndo size={14} />
                        </DefaultButton>
                        <DefaultButton
                            onClick={() => redo()}
                            disabled={futureStates.length === 0}
                            title="Redo (Cmd+Shift+Z)"
                            className="p-1.5"
                        >
                            <FaRedo size={14} />
                        </DefaultButton>
                    </div>

                    {import.meta.env.MODE !== 'production' && (
                        <>
                            <div className="h-4 w-[1px] bg-border mx-2"></div>

                            <button
                                onClick={() => useUIStore.getState().toggleDebugBar()}
                                title="Toggle Debug Bar"
                                className="px-2 py-1 text-[10px] text-text-main hover:text-text-highlighted hover:bg-surface rounded border border-border"
                            >
                                Debug
                            </button>
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
                    <div className="text-xs text-text-main flex items-center gap-2">
                        {isSaving ? (
                            <span className="text-primary-fg animate-pulse">Saving...</span>
                        ) : (
                            <span className="text-text-main">All changes saved</span>
                        )}
                    </div>
                    {/* User Profile / Other Actions */}
                    <Dropdown
                        options={EXPORT_QUALITY_OPTIONS}
                        value={null as any}
                        onChange={handleExport}
                        placeholder="Export"
                        fullWidth={false}
                    />
                    {/* User Authentication */}
                    {isAuthenticated ? (
                        <UserMenu onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)} />
                    ) : (
                        <DefaultButton onClick={() => setIsAuthModalOpen(true)} title="Sign in to unlock Pro features">
                            Sign In
                        </DefaultButton>
                    )}
                    <DefaultButton onClick={() => setIsBugReportModalOpen(true)} title="Report a bug">
                        <MdBugReport size={18} />
                    </DefaultButton>
                    <DefaultButton
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        {theme === 'dark' ? <MdLightMode size={18} /> : <MdDarkMode size={18} />}
                    </DefaultButton>
                </div>
            </div>
            <BugReportModal
                isOpen={isBugReportModalOpen}
                onClose={() => setIsBugReportModalOpen(false)}
            />
            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
            />
            <UpgradeModal
                isOpen={isUpgradeModalOpen}
                onClose={() => setIsUpgradeModalOpen(false)}
                selectedQuality={selectedQuality}
            />
        </div>
    );
};

import { useState } from 'react';
import { useProjectStore, useProjectData, useProjectHistory } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { ExportManager } from '../../export/ExportManager';
import type { ExportQuality } from '../../export/ExportManager';
import { Dropdown } from '../../../components/ui/Dropdown';
import type { DropdownOption } from '../../../components/ui/Dropdown';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { FaUndo, FaRedo } from 'react-icons/fa';
import { MdBugReport } from 'react-icons/md';
import { Button } from '../../../components/ui/Button';
import { BugReportModal } from '../../../components/ui/BugReportModal';
import { AuthModal } from './AuthModal';
import { UserMenu } from './UserMenu';
import { UpgradeModal } from './UpgradeModal';
import { useUserStore } from '../../stores/useUserStore';
import logoFull from '../../../assets/fulllogo.png';

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
    const { isAuthenticated, isPro, canExportQuality } = useUserStore();
    const project = useProjectData();
    const sources = useProjectStore(s => s.sources);
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

        // Show watermark warning for free users
        if (!isPro && (quality === '360p' || quality === '720p')) {
            const confirmed = window.confirm(
                'Free exports include a "RECORDIO" watermark.\n\nUpgrade to Pro to remove watermarks and unlock 1080p/4K exports.\n\nContinue with watermark?'
            );
            if (!confirmed) return;
        }

        setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null });

        const manager = new ExportManager();
        const onProgress = (state: any) => setExportState(state);

        try {
            // Assign to global for cancellation (hacky but effective for single active export)
            (window as any).__activeExportManager = manager;

            await manager.exportProject(project, sources, quality, onProgress);
        } catch (e) {
            console.error(e);
        } finally {
            setExportState({ isExporting: false });
            (window as any).__activeExportManager = null;
        }
    };

    return (
        <div className="bg-surface-elevated border-b border-border flex flex-col shrink-0 z-30 select-none">
            {/* Top Row: Main Controls */}
            <div className="h-12 flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <a
                        href="https://recordio.site"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="opacity-70 hover:opacity-100 transition-opacity duration-200"
                    >
                        <img src={logoFull} alt="Recordio" className="h-8" />
                    </a>
                    <div className="h-4 w-[1px] bg-border mx-2"></div>

                    <div className="flex items-center gap-1">
                        <Button
                            onClick={() => undo()}
                            disabled={pastStates.length === 0}
                            title="Undo (Cmd+Z)"
                            className="p-1.5"
                        >
                            <FaUndo size={14} />
                        </Button>
                        <Button
                            onClick={() => redo()}
                            disabled={futureStates.length === 0}
                            title="Redo (Cmd+Shift+Z)"
                            className="p-1.5"
                        >
                            <FaRedo size={14} />
                        </Button>
                    </div>

                    {process.env.NODE_ENV !== 'production' && (
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
                    className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 bg-hover-subtle text-text-main text-sm text-center border border-border focus:text-text-highlighted hover:bg-hover hover:border-border-highlighted focus:bg-hover focus:border-border-highlighted rounded px-2 py-0.5 transition-colors placeholder-text-main w-[300px] focus-ring"
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
                        value={null as any} // No default selection - this is an action dropdown, not a state selector
                        onChange={handleExport}
                        trigger={
                            <PrimaryButton
                                className="px-3 py-1.5 text-xs flex items-center gap-2"
                                disabled={isExporting}
                            >
                                <span>Export</span>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 9l6 6 6-6" />
                                </svg>
                            </PrimaryButton>
                        }
                        direction="down"
                    />
                    {/* User Authentication */}
                    {isAuthenticated ? (
                        <UserMenu onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)} />
                    ) : (
                        <Button onClick={() => setIsAuthModalOpen(true)} title="Sign in to unlock Pro features">
                            Sign In
                        </Button>
                    )}
                    <Button onClick={() => setIsBugReportModalOpen(true)} title="Report a bug">
                        <MdBugReport size={18} />
                    </Button>
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

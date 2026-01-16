import { useState } from 'react';
import { useProjectStore, useProjectData, useProjectHistory } from '../stores/useProjectStore';
import { useUIStore } from '../stores/useUIStore';
import { ExportButton } from './export/ExportButton';
import { FaUndo, FaRedo } from 'react-icons/fa';
import { MdBugReport } from 'react-icons/md';
import { Button } from '../../components/ui/Button';
import { BugReportModal } from '../../components/ui/BugReportModal';

export const Header = () => {
    const [isBugReportModalOpen, setIsBugReportModalOpen] = useState(false);
    const project = useProjectData();
    const updateProjectName = useProjectStore(s => s.updateProjectName);
    const isSaving = useProjectStore(s => s.isSaving);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const pastStates = useProjectHistory(state => state.pastStates);
    const futureStates = useProjectHistory(state => state.futureStates);

    return (
        <div className="bg-surface-elevated border-b border-border flex flex-col shrink-0 z-30 select-none">
            {/* Top Row: Main Controls */}
            <div className="h-12 flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <h1 className="font-bold text-text-highlighted text-sm tracking-wide">RECORDO</h1>
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

                    <div className="h-4 w-[1px] bg-border mx-2"></div>

                    <button
                        onClick={() => useUIStore.getState().toggleDebugBar()}
                        title="Toggle Debug Bar"
                        className="px-2 py-1 text-[10px] text-text-main hover:text-text-highlighted hover:bg-surface rounded border border-border"
                    >
                        Debug
                    </button>
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
                    <Button onClick={() => setIsBugReportModalOpen(true)} title="Report a bug">
                        <MdBugReport size={18} />
                    </Button>
                    <ExportButton />
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-secondary"></div>
                </div>
            </div>
            <BugReportModal
                isOpen={isBugReportModalOpen}
                onClose={() => setIsBugReportModalOpen(false)}
            />
        </div>
    );
};

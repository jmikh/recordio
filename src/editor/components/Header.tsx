import { useProjectStore, useProjectData, useProjectHistory } from '../stores/useProjectStore';
import { ExportButton } from './export/ExportButton';

// Icons
const IconUndo = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7v6h6" />
        <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
);

const IconRedo = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 7v6h-6" />
        <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3.7" />
    </svg>
);

export const Header = () => {
    const project = useProjectData();
    const updateProjectName = useProjectStore(s => s.updateProjectName);
    const isSaving = useProjectStore(s => s.isSaving);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const pastStates = useProjectHistory(state => state.pastStates);
    const futureStates = useProjectHistory(state => state.futureStates);

    return (
        <div className="bg-[#252526] border-b border-[#333] flex flex-col shrink-0 z-30 select-none">
            {/* Top Row: Main Controls */}
            <div className="h-12 flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <h1 className="font-bold text-gray-200 text-sm tracking-wide">RECORDO</h1>
                    <div className="h-4 w-[1px] bg-[#444] mx-2"></div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => undo()}
                            disabled={pastStates.length === 0}
                            title="Undo (Cmd+Z)"
                            className="p-2 text-gray-400 hover:text-white hover:bg-[#333] rounded disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <IconUndo />
                        </button>
                        <button
                            onClick={() => redo()}
                            disabled={futureStates.length === 0}
                            title="Redo (Cmd+Shift+Z)"
                            className="p-2 text-gray-400 hover:text-white hover:bg-[#333] rounded disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <IconRedo />
                        </button>
                    </div>

                    <div className="text-[10px] text-gray-500 ml-4">
                        {pastStates.length} / {futureStates.length}
                    </div>
                </div>

                {/* Project Name (Centered in Top Row) */}
                <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
                    <input
                        type="text"
                        value={project.name}
                        onChange={(e) => updateProjectName(e.target.value)}
                        maxLength={40}
                        className="bg-transparent text-gray-300 text-sm text-center focus:text-white focus:outline-none focus:bg-[#333] rounded px-2 py-0.5 hover:bg-[#333]/50 transition-colors placeholder-gray-600 w-[300px]"
                        placeholder="Untitled Project"
                    />
                </div>

                <div className="flex items-center gap-4">
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                        {isSaving ? (
                            <span className="text-blue-400">Saving...</span>
                        ) : (
                            <span className="text-gray-600">All changes saved</span>
                        )}
                    </div>
                    {/* User Profile / Other Actions */}
                    <ExportButton />
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500"></div>
                </div>
            </div>
        </div>
    );
};

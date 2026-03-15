import { useProjectStore, useProjectData } from '../stores/useProjectStore';
import { useUIStore } from '../stores/useUIStore';
import { exportProjectToZip } from '../../storage/projectTransfer';

export const DebugBar = () => {
    const project = useProjectData();
    const showDebugOverlays = useUIStore(s => s.showDebugOverlays);
    const toggleDebugOverlays = useUIStore(s => s.toggleDebugOverlays);

    return (
        <div className="h-8 flex items-center px-4 gap-2 border-t border-border bg-background">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mr-2">Debug</span>
            <button
                className="px-2 py-0.5 bg-blue-900/50 hover:bg-blue-800 text-blue-200 text-[10px] rounded cursor-pointer border border-blue-800"
                onClick={() => console.log(useProjectStore.getState().project)}
                title={`Project ID: ${project.id}`}
            >
                Log Project
            </button>

            {/* Separator */}
            <div className="w-px h-4 bg-gray-700 mx-2" />

            {/* Toggle Button for Debug Overlays */}
            <button
                className={`px-2 py-0.5 text-[10px] rounded cursor-pointer border ${showDebugOverlays
                    ? 'bg-yellow-600 hover:bg-yellow-700 text-yellow-100 border-yellow-500'
                    : 'bg-gray-700/50 hover:bg-gray-600 text-gray-300 border-gray-600'
                    }`}
                onClick={toggleDebugOverlays}
                title="Toggle focus area debug overlays on canvas"
            >
                {showDebugOverlays ? '🔍 Overlays ON' : '🔍 Overlays OFF'}
            </button>

            {/* Separator */}
            <div className="w-px h-4 bg-gray-700 mx-2" />

            {/* Export Project */}
            <button
                className="px-2 py-0.5 bg-teal-900/50 hover:bg-teal-800 text-teal-200 text-[10px] rounded cursor-pointer border border-teal-800"
                onClick={async () => {
                    try {
                        await exportProjectToZip(project.id);
                    } catch (e) {
                        console.error('Export failed:', e);
                    }
                }}
                title="Download project as .zip (JSON + blobs)"
            >
                📦 Export Project
            </button>
        </div>
    );
};

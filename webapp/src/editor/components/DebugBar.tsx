import { useProjectStore, useProjectData, useUserEvents } from '../stores/useProjectStore';
import { useUIStore } from '../stores/useUIStore';
import { getAllFocusAreas } from '../../core/zoom';
import { getTimeMapper } from '../hooks/useTimeMapper';
import { ProjectDebugExporter } from '../debug';
import { useToast } from './Toast';

export const DebugBar = () => {
    const project = useProjectData();
    const userEvents = useUserEvents();
    const showDebugOverlays = useUIStore(s => s.showDebugOverlays);
    const toggleDebugOverlays = useUIStore(s => s.toggleDebugOverlays);
    const { addToast, updateToast } = useToast();

    const handleExportProject = async () => {
        try {
            await ProjectDebugExporter.exportProject(project);
        } catch (error) {
            console.error('[DebugBar] Export failed:', error);
        }
    };

    const logFocusAreas = () => {
        const screenSource = project.screenSource;
        if (!screenSource.id || !userEvents) {
            console.log('No screen source or events available', { screenSource, userEvents });
            return;
        }

        const timeMapper = getTimeMapper(project.timeline.outputWindows);
        const focusAreas = getAllFocusAreas(userEvents, screenSource.size, screenSource.durationMs);

        console.log('Focus Areas:', focusAreas);
        console.table(focusAreas.map(area => ({
            startTime: area.sourceStartTimeMs,
            endTime: area.sourceEndTimeMs,
            reason: area.reason,
            x: area.rect.x.toFixed(0),
            y: area.rect.y.toFixed(0),
            width: area.rect.width.toFixed(0),
            height: area.rect.height.toFixed(0),
        })));
    };

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
            <button
                className="px-2 py-0.5 bg-green-900/50 hover:bg-green-800 text-green-200 text-[10px] rounded cursor-pointer border border-green-800"
                onClick={() => console.log(userEvents)}
            >
                Log Events
            </button>
            <button
                className="px-2 py-0.5 bg-purple-900/50 hover:bg-purple-800 text-purple-200 text-[10px] rounded cursor-pointer border border-purple-800"
                onClick={() => console.log(project.timeline.zoomActions)}
            >
                Log Zooms
            </button>
            <button
                className="px-2 py-0.5 bg-orange-900/50 hover:bg-orange-800 text-orange-200 text-[10px] rounded cursor-pointer border border-orange-800"
                onClick={() => console.log(useUIStore.getState())}
            >
                Log UI
            </button>
            <button
                className="px-2 py-0.5 bg-pink-900/50 hover:bg-pink-800 text-pink-200 text-[10px] rounded cursor-pointer border border-pink-800"
                onClick={logFocusAreas}
            >
                Log Focus Areas
            </button>
            <button
                className="px-2 py-0.5 bg-amber-900/50 hover:bg-amber-800 text-amber-200 text-[10px] rounded cursor-pointer border border-amber-800"
                onClick={() => console.log(project.timeline.spotlightActions)}
            >
                Log Spotlights
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

            {/* Export Project for Debugging */}
            <button
                className="px-2 py-0.5 bg-cyan-900/50 hover:bg-cyan-800 text-cyan-200 text-[10px] rounded cursor-pointer border border-cyan-800"
                onClick={handleExportProject}
                title="Export project as debug bundle (zip)"
            >
                📦 Export Project
            </button>

            {/* Separator */}
            <div className="w-px h-4 bg-gray-700 mx-2" />

            {/* Toast Demo Buttons */}
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mr-1">Toasts</span>
            <button
                className="px-2 py-0.5 bg-emerald-900/50 hover:bg-emerald-800 text-emerald-200 text-[10px] rounded cursor-pointer border border-emerald-800"
                onClick={() => addToast({ type: 'success', title: 'Success Toast', message: 'This is a success message' })}
            >
                Success
            </button>
            <button
                className="px-2 py-0.5 bg-sky-900/50 hover:bg-sky-800 text-sky-200 text-[10px] rounded cursor-pointer border border-sky-800"
                onClick={() => addToast({ type: 'info', title: 'Info Toast', message: 'This is an info message' })}
            >
                Info
            </button>
            <button
                className="px-2 py-0.5 bg-red-900/50 hover:bg-red-800 text-red-200 text-[10px] rounded cursor-pointer border border-red-800"
                onClick={() => addToast({ type: 'error', title: 'Error Toast', message: 'This is an error message' })}
            >
                Error
            </button>
            <button
                className="px-2 py-0.5 bg-violet-900/50 hover:bg-violet-800 text-violet-200 text-[10px] rounded cursor-pointer border border-violet-800"
                onClick={() => {
                    const id = addToast({ type: 'progress', title: 'Progress Toast', message: 'Processing...', progress: 0 });
                    let p = 0;
                    const interval = setInterval(() => {
                        p += 0.1;
                        if (p >= 1) {
                            clearInterval(interval);
                            updateToast(id, { type: 'success', title: 'Complete!', progress: undefined });
                        } else {
                            updateToast(id, { progress: p });
                        }
                    }, 300);
                }}
            >
                Progress
            </button>
            <button
                className="px-2 py-0.5 bg-rose-900/50 hover:bg-rose-800 text-rose-200 text-[10px] rounded cursor-pointer border border-rose-800"
                onClick={() => addToast({ type: 'info', title: 'No Auto Effects', message: 'Recordio can only capture Chrome window interactions.' })}
            >
                Branding
            </button>
        </div>
    );
};

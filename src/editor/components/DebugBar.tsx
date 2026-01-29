import { useProjectStore, useProjectData, useProjectSources } from '../stores/useProjectStore';
import { useUIStore } from '../stores/useUIStore';
import { getAllFocusAreas } from '../../core/focusManager';
import { getTimeMapper } from '../hooks/useTimeMapper';

export const DebugBar = () => {
    const project = useProjectData();
    const sources = useProjectSources();
    const userEvents = useProjectStore(s => s.userEvents);

    const logFocusAreas = () => {
        const screenSource = sources[project.timeline.screenSourceId];
        if (!screenSource || !userEvents) {
            console.log('No screen source or events available', { screenSourceId: project.timeline.screenSourceId, sources, userEvents });
            return;
        }

        const timeMapper = getTimeMapper(project.timeline.outputWindows);
        const focusAreas = getAllFocusAreas(userEvents, timeMapper, screenSource.size);

        console.log('Focus Areas:', focusAreas);
        console.table(focusAreas.map(area => ({
            timestamp: area.timestamp,
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
                onClick={() => console.log(sources)}
            >
                Log Sources
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
        </div>
    );
};

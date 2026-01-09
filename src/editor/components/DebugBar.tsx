import { useProjectStore, useProjectData, useProjectSources } from '../stores/useProjectStore';
import { useUIStore } from '../stores/useUIStore';

export const DebugBar = () => {
    const project = useProjectData();
    const sources = useProjectSources();
    const userEvents = useProjectStore(s => s.userEvents);


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
            {/* Log buttons remain here */}
        </div>
    );
};

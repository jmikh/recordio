import { useProjectStore, useProjectData } from '../stores/useProjectStore';
import { useUIStore } from '../stores/useUIStore';

import { getAllFocusAreas } from '../zoom';
import { useToast, type ToastType } from '../../components/Toast';

const TOAST_TYPES: { type: ToastType; label: string; emoji: string }[] = [
    { type: 'info', label: 'Info', emoji: 'ℹ️' },
    { type: 'success', label: 'Success', emoji: '✅' },
    { type: 'error', label: 'Error', emoji: '❌' },
    { type: 'progress', label: 'Progress', emoji: '⏳' },
];

export const DebugBar = () => {
    const project = useProjectData();
    const showDebugOverlays = useUIStore(s => s.showDebugOverlays);
    const toggleDebugOverlays = useUIStore(s => s.toggleDebugOverlays);
    const { addToast } = useToast();

    const showTestToast = (type: ToastType) => {
        addToast({
            type,
            title: `Test ${type} toast`,
            message: `This is a sample ${type} toast`,
            duration: 5000,
            ...(type === 'progress' ? { progress: 0.6 } : {}),
        });
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
                className="px-2 py-0.5 bg-blue-900/50 hover:bg-blue-800 text-blue-200 text-[10px] rounded cursor-pointer border border-blue-800"
                onClick={() => console.log('User Events:', useProjectStore.getState().userEvents)}
                title="Log user events from store"
            >
                Log User Events
            </button>

            <button
                className="px-2 py-0.5 bg-blue-900/50 hover:bg-blue-800 text-blue-200 text-[10px] rounded cursor-pointer border border-blue-800"
                onClick={() => {
                    const s = useProjectStore.getState();
                    const areas = getAllFocusAreas(s.userEvents, s.project.screenSource.size, s.project.screenSource.durationMs);
                    console.log('Focus Areas:', areas);
                }}
                title="Log computed focus areas"
            >
                Log Focus Areas
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


            {/* Separator */}
            <div className="w-px h-4 bg-gray-700 mx-2" />

            {/* Toast Test Buttons */}
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Toasts</span>
            {TOAST_TYPES.map(({ type, label, emoji }) => (
                <button
                    key={type}
                    className="px-2 py-0.5 bg-purple-900/50 hover:bg-purple-800 text-purple-200 text-[10px] rounded cursor-pointer border border-purple-800"
                    onClick={() => showTestToast(type)}
                    title={`Show ${type} toast for 5s`}
                >
                    {emoji} {label}
                </button>
            ))}
        </div>
    );
};

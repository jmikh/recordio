import { useProjectStore } from '../../stores/useProjectStore';

const SHAPES = [
    { id: 'rect', label: 'Rectangle', icon: <div className="w-4 h-3 border border-current" /> },
    { id: 'square', label: 'Square', icon: <div className="w-4 h-4 border border-current" /> },
    { id: 'circle', label: 'Circle', icon: <div className="w-4 h-4 rounded-full border border-current" /> },
] as const;

export const CameraSettings = () => {
    const project = useProjectStore(s => s.project);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setEditingCamera = useProjectStore(s => s.setEditingCamera);
    const editingCamera = useProjectStore(s => s.editingCamera);

    const cameraConfig = project.settings.camera;

    const sources = useProjectStore(s => s.sources);
    const recording = project.timeline.recording;
    const cameraSource = recording.cameraSourceId ? sources[recording.cameraSourceId] : null;

    if (!cameraConfig) {
        return (
            <div className="p-4 text-center text-gray-400">
                <p>No camera configured for this project.</p>
                {/* Potentially add button to "Add Camera" if not present? 
                    For now, we assume it's set if camera source exists, 
                    but we added defaults to Project.create so it should be there.
                 */}
            </div>
        );
    }

    const handleShapeChange = (shape: 'rect' | 'square' | 'circle') => {
        let newSettings = { ...cameraConfig, shape };

        if (shape === 'rect') {
            // Restore aspect ratio from source if available
            if (cameraSource && cameraSource.size.height > 0) {
                const ratio = cameraSource.size.width / cameraSource.size.height;
                // Keep the current height, adjust width to match ratio
                newSettings.width = newSettings.height * ratio;
            }
        } else if (shape === 'square' || shape === 'circle') {
            // Enforce 1:1 Aspect Ratio
            // We use the smaller dimension to ensure it fits within the previous area
            const size = Math.min(newSettings.width, newSettings.height);
            newSettings.width = size;
            newSettings.height = size;
        }

        // Ensure we don't go out of bounds with the new size
        const outputSize = project.settings.outputSize;
        newSettings.x = Math.max(0, Math.min(newSettings.x, outputSize.width - newSettings.width));
        newSettings.y = Math.max(0, Math.min(newSettings.y, outputSize.height - newSettings.height));

        updateSettings({ camera: newSettings });
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-4">Camera Overlay</h3>

                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setEditingCamera(!editingCamera)}
                        className={`flex-1 py-2 px-4 rounded text-sm font-medium transition-colors ${editingCamera
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-[#333] text-gray-200 hover:bg-[#444]'
                            }`}
                    >
                        {editingCamera ? 'Done Editing' : 'Edit Position & Size'}
                    </button>
                </div>

                <div className="space-y-4">
                    <label className="text-xs font-semibold text-gray-400">Shape</label>
                    <div className="grid grid-cols-3 gap-2">
                        {SHAPES.map(shape => (
                            <button
                                key={shape.id}
                                onClick={() => handleShapeChange(shape.id as any)}
                                className={`flex flex-col items-center justify-center p-3 rounded border transition-all ${cameraConfig.shape === shape.id
                                    ? 'bg-blue-900/30 border-blue-500 text-blue-400'
                                    : 'bg-[#2a2a2a] border-transparent text-gray-400 hover:bg-[#333]'
                                    }`}
                                title={shape.label}
                            >
                                <div className="mb-1">{shape.icon}</div>
                                <span className="text-[10px]">{shape.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

import { useProjectStore } from '../../stores/useProjectStore';
import { StyleControls } from './StyleControls';

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
            </div>
        );
    }

    const handleShapeChange = (newShape: 'rect' | 'square' | 'circle') => {
        let newSettings = { ...cameraConfig, shape: newShape };

        if (newShape === 'rect') {
            if (cameraSource && cameraSource.size.height > 0) {
                const ratio = cameraSource.size.width / cameraSource.size.height;
                newSettings.width = newSettings.height * ratio;
            }
        } else if (newShape === 'square' || newShape === 'circle') {
            const size = Math.min(newSettings.width, newSettings.height);
            newSettings.width = size;
            newSettings.height = size;
        }

        const outputSize = project.settings.outputSize;
        newSettings.x = Math.max(0, Math.min(newSettings.x, outputSize.width - newSettings.width));
        newSettings.y = Math.max(0, Math.min(newSettings.y, outputSize.height - newSettings.height));

        updateSettings({ camera: newSettings });
    };

    const {
        shape,
        borderRadius = 0,
        borderWidth = 0,
        borderColor = '#ffffff',
        hasShadow = false,
        hasGlow = false
    } = cameraConfig;

    return (
        <div className="space-y-6 relative">
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

                <div className="space-y-6">
                    {/* Shape */}
                    <div className="space-y-3">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Shape</label>
                        <div className="grid grid-cols-3 gap-2">
                            {SHAPES.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => handleShapeChange(s.id as any)}
                                    className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${shape === s.id
                                        ? 'bg-blue-500/10 border-blue-500/50 text-blue-400 shadow-sm'
                                        : 'bg-[#1a1a1a] border-gray-800 text-gray-500 hover:border-gray-700 hover:bg-[#202020]'
                                        }`}
                                >
                                    {s.icon}
                                    <span className="text-[10px] font-medium">{s.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <StyleControls
                        settings={{
                            borderRadius,
                            borderWidth,
                            borderColor,
                            hasShadow,
                            hasGlow
                        }}
                        onChange={(updates) => updateSettings({ camera: { ...cameraConfig, ...updates } })}
                        showRadius={shape === 'rect' || shape === 'square'}
                    />
                </div>
            </div>
        </div>
    );
};

import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { StyleControls } from './StyleControls';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider } from '../common/Slider';

const SHAPES = [
    { id: 'rect', label: 'Rectangle', icon: <div className="w-4 h-3 border border-current" /> },
    { id: 'square', label: 'Square', icon: <div className="w-4 h-4 border border-current" /> },
    { id: 'circle', label: 'Circle', icon: <div className="w-4 h-4 rounded-full border border-current" /> },
] as const;

export const CameraSettings = () => {
    const project = useProjectStore(s => s.project);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const canvasMode = useUIStore(s => s.canvasMode);
    const isEditingCamera = canvasMode === CanvasMode.CameraEdit;
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

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
        hasGlow = false,
        zoom = 1
    } = cameraConfig;

    return (
        <div className="space-y-6 relative">
            <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-4">Camera Overlay</h3>

                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setCanvasMode(isEditingCamera ? CanvasMode.Preview : CanvasMode.CameraEdit)}
                        className={`flex-1 py-2 px-4 rounded text-sm font-medium transition-colors ${isEditingCamera
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-[#333] text-gray-200 hover:bg-[#444]'
                            }`}
                    >
                        {isEditingCamera ? 'Done Editing' : 'Edit Position & Size'}
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

                    {/* Zoom */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Zoom</label>
                            <span className="text-xs text-gray-500 font-mono">{zoom.toFixed(1)}x</span>
                        </div>
                        <Slider
                            min={1}
                            max={3}
                            step={0.1}
                            value={zoom}
                            onPointerDown={startInteraction}
                            onPointerUp={endInteraction}
                            onChange={(val) => batchAction(() => updateSettings({ camera: { ...cameraConfig, zoom: val } }))}
                        />
                    </div>

                    <StyleControls
                        settings={{
                            borderRadius,
                            borderWidth,
                            borderColor,
                            hasShadow,
                            hasGlow
                        }}
                        onChange={(updates) => batchAction(() => updateSettings({ camera: { ...cameraConfig, ...updates } }))}
                        showRadius={shape === 'rect' || shape === 'square'}
                        onInteractionStart={startInteraction}
                        onInteractionEnd={endInteraction}
                        onColorPopoverOpen={startInteraction}
                        onColorPopoverClose={endInteraction}
                    />
                </div>
            </div>
        </div>
    );
};

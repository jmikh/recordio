import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { StyleControls } from './StyleControls';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider } from '../common/Slider';
import { MultiToggle } from '../common/MultiToggle';



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
                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setCanvasMode(isEditingCamera ? CanvasMode.Preview : CanvasMode.CameraEdit)}
                        className={`flex-1 py-2 px-4 rounded text-sm transition-colors ${isEditingCamera
                            ? 'bg-primary text-primary-fg hover:bg-primary/90'
                            : 'bg-surface-elevated text-text-main hover:bg-surface'
                            }`}
                    >
                        {isEditingCamera ? 'Done Editing' : 'Edit Position & Size'}
                    </button>
                </div>

                <div className="space-y-6">
                    {/* Shape */}
                    <div className="space-y-3">
                        <MultiToggle
                            options={[
                                { value: 'rect', label: 'Rectangle', icon: <div className="w-4 h-3 border border-current" /> },
                                { value: 'square', label: 'Square', icon: <div className="w-4 h-4 border border-current" /> },
                                { value: 'circle', label: 'Circle', icon: <div className="w-4 h-4 rounded-full border border-current" /> },
                            ]}
                            value={shape}
                            onChange={(val) => handleShapeChange(val as any)}
                        />
                    </div>

                    {/* Zoom */}
                    {/* Zoom */}
                    <Slider
                        label="Zoom"
                        min={1}
                        max={3}
                        value={zoom}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(val) => batchAction(() => updateSettings({ camera: { ...cameraConfig, zoom: val } }))}
                        showTooltip
                        units="x"
                        decimals={1}
                    />

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

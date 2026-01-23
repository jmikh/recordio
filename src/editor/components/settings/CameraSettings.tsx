import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { StyleControls } from './StyleControls';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider } from '../../../components/ui/Slider';
import { MultiToggle } from '../../../components/ui/MultiToggle';
import { Toggle } from '../../../components/ui/Toggle';
import { LookRightButton } from './LookRightButton';
import { Notice } from '../../../components/ui/Notice';
import { FaCheck } from 'react-icons/fa';
import { FaArrowsUpDownLeftRight } from "react-icons/fa6";



export const CameraSettings = () => {
    const project = useProjectStore(s => s.project);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const canvasMode = useUIStore(s => s.canvasMode);
    const isEditingCamera = canvasMode === CanvasMode.CameraEdit;
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const cameraConfig = project.settings.camera;

    const sources = useProjectStore(s => s.sources);
    const cameraSource = project.timeline.cameraSourceId ? sources[project.timeline.cameraSourceId] : null;

    // Check if there are any zoom motions (needed for auto-shrink feature)
    const hasZoomMotions = (project.timeline.viewportMotions || []).length > 0;

    if (!cameraConfig) {
        return (
            <div className="p-4">
                <Notice>No camera configured for this project.</Notice>
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
        cropZoom = 1,
        autoShrink = false,
        shrinkScale = 0.5
    } = cameraConfig;

    return (
        <div className="space-y-6 relative">
            <div>
                <div className="flex gap-2 mb-6">
                    <LookRightButton
                        icon={isEditingCamera ? <FaCheck /> : <FaArrowsUpDownLeftRight className="w-5 h-5" />}
                        isActive={isEditingCamera}
                        onClick={() => setCanvasMode(isEditingCamera ? CanvasMode.Preview : CanvasMode.CameraEdit)}
                        label={isEditingCamera ? 'Editing...' : 'Edit Position & Size'}
                        className="flex-1"
                    />
                </div>

                <div className="space-y-6">
                    {/* Shape */}
                    <div className="space-y-3">
                        <MultiToggle
                            options={[
                                { value: 'rect', label: 'Rectangle' },
                                { value: 'square', label: 'Square' },
                                { value: 'circle', label: 'Circle' },
                            ]}
                            value={shape}
                            onChange={(val) => handleShapeChange(val as any)}
                        />
                    </div>

                    {/* Crop Zoom - zooms within the camera video feed */}
                    <Slider
                        label="Crop Zoom"
                        min={1}
                        max={3}
                        value={cropZoom}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(val) => batchAction(() => updateSettings({ camera: { ...cameraConfig, cropZoom: val } }))}
                        showTooltip
                        units="x"
                        decimals={1}
                    />

                    <div className="border-t border-gray-700" />

                    {/* Auto-Shrink on Screen Zoom */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-xs text-gray-400">Auto-Shrink on Screen Zoom</label>
                            <Toggle
                                value={autoShrink}
                                onChange={(val) => updateSettings({ camera: { ...cameraConfig, autoShrink: val } })}
                                disabled={!hasZoomMotions}
                            />
                        </div>

                        {!hasZoomMotions && (
                            <p className="text-[10px] text-text-muted italic leading-tight">
                                * Add screen zoom motions to enable this feature
                            </p>
                        )}

                        {/* Shrunk Size Slider - Only shown when auto-shrink is enabled */}
                        {autoShrink && hasZoomMotions && (
                            <Slider
                                label="Shrunk Size"
                                min={0.25}
                                max={0.75}
                                value={shrinkScale}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) => batchAction(() => updateSettings({ camera: { ...cameraConfig, shrinkScale: val } }))}
                                showTooltip
                                units="%"
                                decimals={0}
                                valueTransform={(v) => v * 100}
                            />
                        )}
                    </div>

                    <div className="border-t border-gray-700" />
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-2 text-center">Border</label>

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

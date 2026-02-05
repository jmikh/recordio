import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { StyleControls } from './StyleControls';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider } from '@shared/components';
import { MultiToggle } from '@shared/components';
import { Toggle, InfoTooltip } from '@shared/components';
import { ActivatedButton } from '@shared/components';
import { Notice } from '@shared/components';
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
    const cameraSource = project.cameraSource;

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
                    <div className="flex-1 flex flex-col gap-1">
                        <ActivatedButton
                            onClick={() => setCanvasMode(isEditingCamera ? CanvasMode.Preview : CanvasMode.CameraEdit)}
                            isActive={isEditingCamera}
                            className="w-full"
                        >
                            {isEditingCamera ? <FaCheck /> : <FaArrowsUpDownLeftRight />}
                            {isEditingCamera ? 'Done' : 'Adjust'}
                        </ActivatedButton>
                        <span className="text-xs text-text-disabled text-center">Size, Position, Corner Radius</span>
                    </div>
                </div>

                <div className="space-y-6">
                    {/* Shape */}
                    <div className="space-y-3">
                        <MultiToggle
                            options={[
                                { value: 'rect', label: 'Free' },
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

                    {/* Auto Shrink */}
                    <div className="space-y-4">
                        <Toggle
                            label="Auto Shrink"
                            value={autoShrink}
                            onChange={(val) => updateSettings({ camera: { ...cameraConfig, autoShrink: val } })}
                        >
                            <InfoTooltip
                                description="Automatically shrinks the camera when screen zoom is active."
                                videoSrc="/assets/demos/autoshrink-demo.mp4"
                            />
                        </Toggle>



                        {/* Shrunk Size Slider - Only shown when auto-shrink is enabled */}
                        {autoShrink && (
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
                        showRadius={false}
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

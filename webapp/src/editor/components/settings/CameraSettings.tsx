import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { ColorButton } from './ColorButton';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, Toggle, InfoTooltip, ActivatedButton, Notice, CollapsibleCard, type PreviewItem } from '@shared/components';
import { FaCheck, FaRegCircle, FaRegSquare } from 'react-icons/fa';
import { FaArrowsUpDownLeftRight } from "react-icons/fa6";
import { MdAspectRatio } from 'react-icons/md';

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
        borderWidth = 0,
        borderColor = '#ffffff',
        hasShadow = false,
        hasGlow = false,
        cropZoom = 1,
        autoShrink = false,
        shrinkScale = 0.5
    } = cameraConfig;

    // Build preview items for collapsed border state
    const borderPreviewItems: PreviewItem[] = [];

    // Only show color if there's a visible border or glow effect
    if (borderWidth > 0 || hasGlow) {
        borderPreviewItems.push({
            type: 'custom',
            content: (
                <div
                    className="w-5 h-5 rounded-full border border-border"
                    style={{ backgroundColor: borderColor }}
                />
            )
        });
    }

    // Only show pixel count if there's a border
    if (borderWidth > 0) {
        borderPreviewItems.push({ type: 'text', content: `${Math.round(borderWidth)}px` });
    }

    // Add effect type (shadow/glow) only if enabled
    if (hasShadow) {
        borderPreviewItems.push({ type: 'text', content: 'Shadow' });
    } else if (hasGlow) {
        borderPreviewItems.push({ type: 'text', content: 'Glow' });
    }

    return (
        <div className="flex flex-col gap-3 relative">
            <div className="flex flex-col gap-3">
                <div className="flex gap-2 mb-3">
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

                {/* Style Settings */}
                <CollapsibleCard
                    title="Style"
                    previewItems={[
                        {
                            type: 'custom',
                            content: shape === 'rect'
                                ? <MdAspectRatio size={16} className="text-text-muted" />
                                : shape === 'square'
                                    ? <FaRegSquare size={12} className="text-text-muted" />
                                    : <FaRegCircle size={12} className="text-text-muted" />
                        },
                        { type: 'text', content: `${cropZoom.toFixed(1)}x` }
                    ]}
                    defaultExpanded
                >
                    <div className="flex flex-col gap-4">
                        {/* Shape */}
                        <MultiToggle
                            options={[
                                { value: 'rect', label: 'Free' },
                                { value: 'square', label: 'Square' },
                                { value: 'circle', label: 'Circle' },
                            ]}
                            value={shape}
                            onChange={(val) => handleShapeChange(val as any)}
                        />

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

                        {/* Auto Shrink */}
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
                </CollapsibleCard>

                <CollapsibleCard title="Border" previewItems={borderPreviewItems}>
                    <div className="space-y-4">
                        {/* Color Picker */}
                        <ColorButton
                            color={borderColor}
                            onChange={(color) => batchAction(() => updateSettings({ camera: { ...cameraConfig, borderColor: color } }))}
                            onPopoverOpen={startInteraction}
                            onPopoverClose={endInteraction}
                        />

                        {/* Thickness Slider */}
                        <Slider
                            label="Thickness"
                            min={0}
                            max={20}
                            value={borderWidth}
                            onPointerDown={startInteraction}
                            onPointerUp={endInteraction}
                            onChange={(val) => batchAction(() => updateSettings({ camera: { ...cameraConfig, borderWidth: val } }))}
                            showTooltip
                            units="px"
                        />

                        {/* Shadow/Glow Toggle */}
                        <MultiToggle
                            options={[
                                { value: 'shadow', label: 'Shadow' },
                                { value: 'none', label: 'None' },
                                { value: 'glow', label: 'Glow' }
                            ]}
                            value={hasShadow ? 'shadow' : hasGlow ? 'glow' : 'none'}
                            onChange={(val) => {
                                if (val === 'shadow') {
                                    batchAction(() => updateSettings({ camera: { ...cameraConfig, hasShadow: true, hasGlow: false } }));
                                } else if (val === 'glow') {
                                    batchAction(() => updateSettings({ camera: { ...cameraConfig, hasShadow: false, hasGlow: true } }));
                                } else {
                                    batchAction(() => updateSettings({ camera: { ...cameraConfig, hasShadow: false, hasGlow: false } }));
                                }
                            }}
                        />
                    </div>
                </CollapsibleCard>
            </div>
        </div>
    );
};


import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { ColorButton } from './ColorButton';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Button, Slider, MultiToggle, Toggle, CollapsibleCard, type PreviewItem } from '@shared/components';
import { AutoShrinkTooltip } from '../shared/MediaTooltips';
import { LuCircle, LuSquare } from 'react-icons/lu';
import { MdAspectRatio } from 'react-icons/md';
import { RiPaletteLine, RiFocus3Line } from 'react-icons/ri';
import { TbShape, TbBorderOuter } from 'react-icons/tb';
import { FaceAnchorModal } from './FaceAnchorModal';
import { applyCameraShape } from '@shared/utils/cameraShape';
import { resizeCameraKeepingCorner } from './cameraCorner';
import { PreviewEffectButton } from './PreviewEffectButton';
import { useState } from 'react';

export const CameraSettings = () => {
    const project = useProjectStore(s => s.project);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Collapsible visibility state
    const showCollapsibleCameraShape = useUIStore(s => s.showCollapsibleCameraShape);
    const showCollapsibleShape = useUIStore(s => s.showCollapsibleShape);
    const showCollapsibleBorder = useUIStore(s => s.showCollapsibleBorder);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    const [isFaceAnchorOpen, setIsFaceAnchorOpen] = useState(false);

    const cameraConfig = project.settings.camera;
    const cameraSource = project.cameraSource;
    // Personal Settings defaults template (plans/user-default-project-settings):
    // no face anchor (per recording), no crop zoom / mirror; size via a slider
    // (no canvas drag) and a Preview button for auto-shrink
    const templateMode = useProjectStore(s => s.templateMode);

    if (!cameraConfig) {
        return (
            <div className="p-4">
                No camera configured for this project.
            </div>
        );
    }

    const handleShapeChange = (newShape: 'rect' | 'square' | 'circle') => {
        // Radius is baked per shape and the size refit to the source aspect —
        // shared with the defaults-apply path (shared/utils/cameraShape.ts)
        updateSettings({
            camera: applyCameraShape(cameraConfig, newShape, cameraSource?.size, project.settings.outputSize),
        });
    };

    const {
        shape,
        borderWidthPx = 0,
        borderColor = '#ffffff',
        hasShadow = false,
        hasGlow = false,
        hasFeather = false,
        featherAmount = 0.15,
        cropZoom = 1,
        autoShrink = false,
        shrinkScale = 0.5,
        mirrored = false
    } = cameraConfig;

    // Build preview items for collapsed outline state
    const borderPreviewItems: PreviewItem[] = [];

    if (hasFeather) {
        // Feather mode: show "Feather" and percentage
        borderPreviewItems.push({ type: 'text', content: 'Feather' });
        borderPreviewItems.push({ type: 'text', content: `${Math.round(featherAmount * 100)}%` });
    } else {
        // Border mode: always show color, thickness, and effect
        borderPreviewItems.push({
            type: 'custom',
            content: (
                <div
                    className="w-5 h-5 rounded-full border border-border"
                    style={{ backgroundColor: borderColor }}
                />
            )
        });

        borderPreviewItems.push({ type: 'text', content: `${Math.round(borderWidthPx)}px` });

        // Add effect type (shadow/glow) if enabled
        if (hasShadow) {
            borderPreviewItems.push({ type: 'text', content: 'Shadow' });
        } else if (hasGlow) {
            borderPreviewItems.push({ type: 'text', content: 'Glow' });
        }
    }

    return (
        <div className="flex flex-col gap-3 relative">
            <div className="flex flex-col gap-3">
                {/* Shape Settings */}
                <CollapsibleCard
                    title="Shape"
                    icon={<TbShape className="icon-md" />}
                    previewItems={[
                        {
                            type: 'custom',
                            content: shape === 'rect'
                                ? <MdAspectRatio className="icon-md text-text-muted" />
                                : shape === 'square'
                                    ? <LuSquare className="icon-sm text-text-muted" />
                                    : <LuCircle className="icon-sm text-text-muted" />
                        }
                    ]}
                    isExpanded={showCollapsibleCameraShape}
                    onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleCameraShape', v)}
                >
                    <div className="flex flex-col gap-4">
                        {/* Shape Toggle */}
                        <MultiToggle
                            options={[
                                { value: 'rect', label: 'Free' },
                                { value: 'square', label: 'Square' },
                                { value: 'circle', label: 'Circle' },
                            ]}
                            value={shape}
                            onChange={(val) => handleShapeChange(val as any)}
                        />

                        {/* Face Tracking Button — per recording, not a default */}
                        {!templateMode && (
                            <div className="flex flex-col gap-1">
                                <Button
                                    onClick={() => setIsFaceAnchorOpen(true)}
                                    fullWidth
                                >
                                    <RiFocus3Line />
                                    Center Face
                                </Button>
                            </div>
                        )}

                        {/* Defaults page: the still preview can't be dragged — a size slider that keeps the corner */}
                        {templateMode && (
                            <Slider
                                label="Size"
                                min={0.15}
                                max={0.6}
                                value={cameraConfig.heightPx / project.settings.outputSize.height}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(fraction) => batchAction(() => updateSettings({
                                    camera: resizeCameraKeepingCorner(cameraConfig, fraction, cameraSource?.size, project.settings.outputSize),
                                }))}
                                showTooltip
                                units="%"
                                decimals={0}
                                valueTransform={(v) => v * 100}
                            />
                        )}

                        {/* Crop Zoom - zooms within the camera video feed (per recording, not a default) */}
                        {!templateMode && (
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
                        )}
                    </div>
                </CollapsibleCard>

                {/* Style Settings */}
                <CollapsibleCard
                    title="Style"
                    icon={<RiPaletteLine className="icon-md" />}
                    previewItems={templateMode
                        ? [{ type: 'text', content: autoShrink ? 'Shrink' : 'No shrink' }]
                        : [
                            ...(mirrored ? [{ type: 'text' as const, content: 'Mirror' }] : []),
                            ...(autoShrink ? [{ type: 'text' as const, content: 'Shrink' }] : []),
                            { type: 'text', content: `${cropZoom.toFixed(1)}x` }
                        ]}
                    isExpanded={showCollapsibleShape}
                    onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleShape', v)}
                >
                    <div className="flex flex-col gap-4">
                        {/* Mirrored Toggle (per recording, not a default) */}
                        {!templateMode && (
                            <Toggle
                                label="Mirror"
                                value={mirrored}
                                onChange={(val) => updateSettings({ camera: { ...cameraConfig, mirrored: val } })}
                            />
                        )}

                        {/* Auto Shrink (+ Preview on the defaults page) */}
                        <Toggle
                            label="Auto Shrink"
                            value={autoShrink}
                            onChange={(val) => updateSettings({ camera: { ...cameraConfig, autoShrink: val } })}
                        >
                            <AutoShrinkTooltip />
                            {templateMode && (
                                <PreviewEffectButton kind="shrink" label="Preview auto shrink" disabled={!autoShrink} />
                            )}
                        </Toggle>

                        {/* Shrunk Size Slider - Only shown when auto-shrink is enabled */}
                        {autoShrink && (
                            <Slider
                                label="Shrink Size"
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

                <CollapsibleCard
                    title="Outline"
                    icon={<TbBorderOuter className="icon-md" />}
                    previewItems={borderPreviewItems}
                    isExpanded={showCollapsibleBorder}
                    onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleBorder', v)}
                >
                    <div className="space-y-4">
                        {/* Feather Toggle */}
                        <Toggle
                            label="Feather"
                            value={hasFeather}
                            onChange={(enabled) => {
                                batchAction(() => updateSettings({ camera: { ...cameraConfig, hasFeather: enabled } }));
                            }}
                        />

                        {/* Border Mode Controls */}
                        {!hasFeather && (
                            <>
                                {/* Color Picker */}
                                <ColorButton
                                    title="Color"
                                    color={borderColor}
                                    onChange={(color) => batchAction(() => updateSettings({ camera: { ...cameraConfig, borderColor: color } }))}
                                    onPopoverOpen={startInteraction}
                                    onPopoverClose={endInteraction}
                                    showAlpha
                                />

                                {/* Thickness Slider */}
                                <Slider
                                    label="Thickness"
                                    min={0}
                                    max={20}
                                    value={borderWidthPx}
                                    onPointerDown={startInteraction}
                                    onPointerUp={endInteraction}
                                    onChange={(val) => batchAction(() => updateSettings({ camera: { ...cameraConfig, borderWidthPx: val } }))}
                                    showTooltip
                                    units="px"
                                />

                                {/* Shadow/Glow/None Toggle */}
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
                            </>
                        )}

                        {/* Feather Mode Controls */}
                        {hasFeather && (
                            <Slider
                                label="Amount"
                                min={0}
                                max={0.5}
                                value={featherAmount}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) => batchAction(() => updateSettings({ camera: { ...cameraConfig, featherAmount: val } }))}
                                showTooltip
                                units="%"
                                decimals={0}
                                valueTransform={(v) => v * 100}
                            />
                        )}
                    </div>
                </CollapsibleCard>
            </div>

            {!templateMode && (
                <FaceAnchorModal
                    isOpen={isFaceAnchorOpen}
                    onClose={() => setIsFaceAnchorOpen(false)}
                />
            )}
        </div>
    );
};


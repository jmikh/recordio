import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { ColorButton } from './ColorButton';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, Toggle, CollapsibleCard, type PreviewItem } from '@shared/components';
import { AutoShrinkTooltip } from '../shared/MediaTooltips';
import { LuShapes, LuSun, LuZoomIn } from 'react-icons/lu';
import { TbShadow } from 'react-icons/tb';
import { applyCameraShape } from '@shared/utils/cameraShape';
import { resizeCameraKeepingCorner } from './cameraCorner';
import { PreviewEffectButton } from './PreviewEffectButton';
import { CameraCircleIcon, CameraNoBackgroundIcon, CameraRectIcon } from './CameraShapeIcons';
import { DEFAULT_EFFECT_AMOUNT } from '@shared/painters/utils/outlineEffects';
import { useMatteWaitMessage } from '../../cameraMatte/useMatteWaitMessage';
import type { StyleEffect } from '@shared/types';

/** Shape picker value: the bubble shape, or 'noBackground' for the background-removed cutout */
type ShapeOption = 'rect' | 'circle' | 'noBackground';

export const CameraSettings = () => {
    const project = useProjectStore(s => s.project);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Collapsible visibility state
    const showCollapsibleCameraStyle = useUIStore(s => s.showCollapsibleCameraStyle);
    const showCollapsibleCameraZoom = useUIStore(s => s.showCollapsibleCameraZoom);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    const cameraConfig = project.settings.camera;
    const cameraSource = project.cameraSource;
    // Personal Settings defaults template (plans/user-default-project-settings):
    // no crop zoom / mirror (per recording); size via a slider
    // (no canvas drag) and a Preview button for auto-shrink
    const templateMode = useProjectStore(s => s.templateMode);
    const { matteWaitMessage, matteFailed } = useMatteWaitMessage();

    if (!cameraConfig) {
        return (
            <div className="p-4">
                No camera configured for this project.
            </div>
        );
    }

    const handleShapeChange = (option: ShapeOption) => {
        // The cutout is drawn unclipped and cover-fit into the box, so it uses the
        // rect box (source aspect) to show the whole frame.
        const newShape = option === 'circle' ? 'circle' : 'rect';
        // Radius is baked per shape and the size refit to the source aspect —
        // shared with the defaults-apply path (shared/utils/cameraShape.ts).
        // Moving between rect and no background keeps the box as is.
        const camera = cameraConfig.shape === newShape
            ? cameraConfig
            : applyCameraShape(cameraConfig, newShape, cameraSource?.size, project.settings.outputSize);
        updateSettings({ camera: { ...camera, removeBackground: option === 'noBackground' } });
    };

    const {
        shape,
        borderColor = '#ffffff',
        effect = 'shadow',
        effectAmount = DEFAULT_EFFECT_AMOUNT,
        cropZoom = 1,
        autoShrink = false,
        shrinkScale = 0.5,
        mirrored = false,
        removeBackground = false
    } = cameraConfig;

    // No background is per recording, not a default — the defaults page offers only the shapes.
    // Legacy 'square' bubbles show as rect.
    const shapeOption: ShapeOption = removeBackground && !templateMode ? 'noBackground'
        : shape === 'circle' ? 'circle' : 'rect';
    const shapeOptions = [
        { value: 'rect' as const, icon: <CameraRectIcon className="icon-md" />, ariaLabel: 'Rectangle', tooltip: 'Rectangle' },
        { value: 'circle' as const, icon: <CameraCircleIcon className="icon-md" />, ariaLabel: 'Circle', tooltip: 'Circle' },
        ...(templateMode ? [] : [{
            value: 'noBackground' as const,
            icon: <CameraNoBackgroundIcon className="icon-md" />,
            ariaLabel: 'No background',
            tooltip: matteWaitMessage || 'No background',
            disabled: !!matteWaitMessage,
        }]),
    ];
    const ShapePreviewIcon = shapeOption === 'noBackground' ? CameraNoBackgroundIcon
        : shapeOption === 'circle' ? CameraCircleIcon : CameraRectIcon;

    // Build preview items for collapsed style state: the shape, mirror, the effect,
    // and the color when it glows
    const stylePreviewItems: PreviewItem[] = [
        { type: 'custom', content: <ShapePreviewIcon className="icon-md text-text-muted" /> }
    ];

    if (mirrored && !templateMode) {
        stylePreviewItems.push({ type: 'text', content: 'Mirror' });
    }

    if (effectAmount > 0 && effect === 'shadow') {
        stylePreviewItems.push({ type: 'text', content: 'Shadow' });
    } else if (effectAmount > 0 && effect === 'glow') {
        stylePreviewItems.push({
            type: 'custom',
            content: (
                <div
                    className="w-5 h-5 rounded-full border border-border"
                    style={{ backgroundColor: borderColor }}
                />
            )
        });
        stylePreviewItems.push({ type: 'text', content: 'Glow' });
    }

    return (
        <div className="flex flex-col gap-3 relative">
            <div className="flex flex-col gap-3">
                {/* Style Settings — shape, mirror and outline effect */}
                <CollapsibleCard
                    title="Style"
                    icon={<LuShapes className="icon-md" />}
                    previewItems={stylePreviewItems}
                    isExpanded={showCollapsibleCameraStyle}
                    onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleCameraStyle', v)}
                >
                    <div className="flex flex-col gap-4">
                        {/* Shape Toggle — no background is a flip once the mask exists;
                            disabled until then, with the reason in its tooltip */}
                        <MultiToggle<ShapeOption>
                            options={shapeOptions}
                            value={shapeOption}
                            onChange={handleShapeChange}
                        />
                        {!templateMode && matteWaitMessage && (
                            <span role={matteFailed ? 'alert' : 'status'} className="sr-only">{matteWaitMessage}</span>
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

                        {/* Shadow/Glow Toggle — no effect is an amount of 0 */}
                        <MultiToggle<StyleEffect>
                            options={[
                                { value: 'shadow', label: 'Shadow', icon: <TbShadow className="icon-md" /> },
                                { value: 'glow', label: 'Glow', icon: <LuSun className="icon-md" /> }
                            ]}
                            value={effect}
                            onChange={(val) => updateSettings({ camera: { ...cameraConfig, effect: val } })}
                        />

                        {/* Glow color — the only thing the color paints */}
                        {effect === 'glow' && (
                            <ColorButton
                                title="Color"
                                color={borderColor}
                                onChange={(color) => batchAction(() => updateSettings({ camera: { ...cameraConfig, borderColor: color } }))}
                                onPopoverOpen={startInteraction}
                                onPopoverClose={endInteraction}
                                showAlpha
                            />
                        )}

                        {/* Amount of the selected effect — shadow and glow share it */}
                        <Slider
                            label="Amount"
                            min={0}
                            max={1}
                            value={effectAmount}
                            onPointerDown={startInteraction}
                            onPointerUp={endInteraction}
                            onChange={(val) => batchAction(() => updateSettings({ camera: { ...cameraConfig, effectAmount: val } }))}
                            showTooltip
                            units="%"
                            decimals={0}
                            valueTransform={(v) => v * 100}
                        />

                        {/* Mirrored Toggle (per recording, not a default) */}
                        {!templateMode && (
                            <Toggle
                                label="Mirror"
                                value={mirrored}
                                onChange={(val) => updateSettings({ camera: { ...cameraConfig, mirrored: val } })}
                            />
                        )}
                    </div>
                </CollapsibleCard>

                {/* Zoom Settings — crop zoom and scale on zoom */}
                <CollapsibleCard
                    title="Zoom"
                    icon={<LuZoomIn className="icon-md" />}
                    previewItems={templateMode
                        ? [{ type: 'text', content: autoShrink ? 'Scale on zoom' : 'No scale on zoom' }]
                        : [
                            ...(autoShrink ? [{ type: 'text' as const, content: 'Scale on zoom' }] : []),
                            { type: 'text', content: `${cropZoom.toFixed(1)}x` }
                        ]}
                    isExpanded={showCollapsibleCameraZoom}
                    onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleCameraZoom', v)}
                >
                    <div className="flex flex-col gap-4">
                        {/* Crop Zoom - zooms within the camera video feed, centered on the
                            auto-detected face anchor (per recording, not a default) */}
                        {!templateMode && (
                            <Slider
                                label="Crop Zoom"
                                min={1}
                                max={2}
                                value={cropZoom}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) => batchAction(() => updateSettings({ camera: { ...cameraConfig, cropZoom: val } }))}
                                showTooltip
                                units="x"
                                decimals={1}
                            />
                        )}

                        {/* Scale on Zoom (+ Preview on the defaults page) */}
                        <Toggle
                            label="Scale on Zoom"
                            value={autoShrink}
                            onChange={(val) => updateSettings({ camera: { ...cameraConfig, autoShrink: val } })}
                        >
                            <AutoShrinkTooltip />
                            {templateMode && (
                                <PreviewEffectButton kind="shrink" label="Preview scale on zoom" disabled={!autoShrink} />
                            )}
                        </Toggle>

                        {/* Scale Slider - Only shown when scale on zoom is enabled */}
                        {autoShrink && (
                            <Slider
                                label="Scale"
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
            </div>
        </div>
    );
};


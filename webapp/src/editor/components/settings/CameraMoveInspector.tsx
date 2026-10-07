import React, { useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, CollapsibleCard, MultiToggle, Toggle, Checkbox, InfoTooltip, Button, type DropdownOption } from '@shared/components';
import type { EasingStyle } from '@shared/animators/easing';
import type { CameraMoveSegment } from '@shared/types';
import { LuCamera, LuMaximize } from 'react-icons/lu';
import { EasingTooltipContent } from './EasingTooltipContent';
import { CameraMoveTooltip } from '../shared/MediaTooltips';
import { CameraCircleIcon, CameraNoBackgroundIcon, CameraRectIcon } from './CameraShapeIcons';
import { useMatteWaitMessage } from '../../cameraMatte/useMatteWaitMessage';

/** Shape picker value: the bubble shape, or 'noBackground' for the background-removed cutout */
type ShapeOption = 'rect' | 'circle' | 'noBackground';

const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];

export const CameraMoveInspector: React.FC<{ segment: CameraMoveSegment }> = ({ segment }) => {
    const updateCameraMove = useProjectStore(s => s.updateCameraMove);
    const deleteCameraMove = useProjectStore(s => s.deleteCameraMove);
    const selectCameraMove = useUIStore(s => s.selectCameraMove);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const handleDelete = useCallback(() => {
        deleteCameraMove(segment.id);
        selectCameraMove(null);
    }, [segment.id, deleteCameraMove, selectCameraMove]);

    const handleTransitionChange = useCallback((val: number) => {
        batchAction(() => {
            updateCameraMove(segment.id, { transitionDurationMs: Math.round(val) });
        });
    }, [segment.id, batchAction, updateCameraMove]);

    const handleEasingChange = useCallback((val: EasingStyle) => {
        updateCameraMove(segment.id, { easing: val });
    }, [segment.id, updateCameraMove]);

    const outputSize = useProjectStore(s => s.project.settings.outputSize);
    const cameraSourceSize = useProjectStore(s => s.project.cameraSource?.size);
    const cameraRemoveBackground = useProjectStore(s => !!s.project.settings.camera?.removeBackground);
    const { matteWaitMessage } = useMatteWaitMessage();

    const handleShapeChange = useCallback((option: ShapeOption) => {
        const removeBackground = option === 'noBackground';
        // The cutout is drawn unclipped and cover-fit into the box, so it uses the rect box
        const newShape = option === 'circle' ? 'circle' : 'rect';

        // Moving between rect and no background keeps the box as is
        if (newShape === (segment.shape === 'circle' ? 'circle' : 'rect')) {
            updateCameraMove(segment.id, { removeBackground });
            return;
        }

        let w = segment.widthPx;
        let h = segment.heightPx;
        let x = segment.xPx;
        let y = segment.yPx;

        // Adjust dimensions based on shape
        if (newShape === 'circle') {
            const size = Math.min(w, h);
            w = size;
            h = size;
        } else if (removeBackground && cameraSourceSize && cameraSourceSize.height > 0) {
            // The cutout box follows the source aspect to show the whole frame
            w = h * (cameraSourceSize.width / cameraSourceSize.height);
        }

        // Bake borderRadiusPx based on shape — painter renders purely on radius
        const newRadius = newShape === 'circle' ? Math.min(w, h) / 2 : 10;

        // Clamp position to canvas bounds
        x = Math.max(0, Math.min(x, outputSize.width - w));
        y = Math.max(0, Math.min(y, outputSize.height - h));

        updateCameraMove(segment.id, {
            shape: newShape, borderRadiusPx: newRadius, removeBackground,
            widthPx: w, heightPx: h, xPx: x, yPx: y,
        });
    }, [segment.id, segment.shape, segment.widthPx, segment.heightPx, segment.xPx, segment.yPx, outputSize, cameraSourceSize, updateCameraMove]);

    const handleAnimateInToggle = useCallback((val: boolean) => {
        updateCameraMove(segment.id, { animateIn: val });
    }, [segment.id, updateCameraMove]);

    const handleAnimateOutToggle = useCallback((val: boolean) => {
        updateCameraMove(segment.id, { animateOut: val });
    }, [segment.id, updateCameraMove]);


    const handleHiddenToggle = useCallback((val: boolean) => {
        updateCameraMove(segment.id, { hidden: val });
    }, [segment.id, updateCameraMove]);

    const handleFillScreen = useCallback(() => {
        updateCameraMove(segment.id, {
            xPx: 0,
            yPx: 0,
            widthPx: outputSize.width,
            heightPx: outputSize.height,
            shape: 'rect',
            borderRadiusPx: 0,
            // Explicit false so the block doesn't inherit a global no-background cutout
            removeBackground: false,
        });
    }, [segment.id, outputSize, updateCameraMove]);

    const isHidden = !!segment.hidden;
    const animateIn = segment.animateIn ?? true;
    const animateOut = segment.animateOut ?? true;
    const hasTransition = animateIn || animateOut;

    // Legacy 'square' segments show as rect
    const removeBackground = segment.removeBackground ?? cameraRemoveBackground;
    const shapeOption: ShapeOption = removeBackground ? 'noBackground'
        : segment.shape === 'circle' ? 'circle' : 'rect';
    const shapeOptions = [
        { value: 'rect' as const, icon: <CameraRectIcon className="icon-md" />, ariaLabel: 'Rectangle', tooltip: 'Rectangle' },
        { value: 'circle' as const, icon: <CameraCircleIcon className="icon-md" />, ariaLabel: 'Circle', tooltip: 'Circle' },
        {
            value: 'noBackground' as const,
            icon: <CameraNoBackgroundIcon className="icon-md" />,
            ariaLabel: 'No background',
            tooltip: matteWaitMessage || 'No background',
            disabled: !!matteWaitMessage,
        },
    ];

    return (
        <CollapsibleCard title="Camera Layout" icon={<LuCamera className="icon-md" />} notCollapsible headerAction={<CameraMoveTooltip />}>
            <div className="flex flex-col gap-5">
                <p className="text-label">Adjust the camera position, size, and shape for this segment.</p>

                {/* Hide Camera Toggle */}
                <Toggle
                    label="Hide Camera"
                    value={isHidden}
                    onChange={handleHiddenToggle}
                >
                    <InfoTooltip
                        description="Hides the camera during this block. The camera fades out from its current position."
                    />
                </Toggle>

                {/* Shape & actions — only shown when not hidden */}
                {!isHidden && (
                    <>
                        {/* Shape Toggle */}
                        <MultiToggle
                            options={shapeOptions}
                            value={shapeOption}
                            onChange={handleShapeChange}
                        />

                        {/* Fill Screen */}
                        <Button
                            onClick={handleFillScreen}
                            fullWidth
                            className="text-text-muted hover:text-text"
                        >
                            <LuMaximize className="icon-sm" />
                            <span>Fill Screen</span>
                        </Button>
                    </>
                )}

                {/* Animate In / Out */}
                <div className="flex items-center gap-4">
                    <Checkbox label="Animate in" checked={animateIn} onChange={handleAnimateInToggle} />
                    <Checkbox label="Animate out" checked={animateOut} onChange={handleAnimateOutToggle} />
                </div>

                {/* Duration & easing — only shown while it animates in or out */}
                {hasTransition && (
                    <>
                        {/* Transition Duration */}
                        <div>
                            <div className="flex justify-between items-center mb-1.5">
                                <span className="text-label">Transition</span>
                                <span className="text-label">
                                    {(segment.transitionDurationMs / 1000).toFixed(2)}s
                                </span>
                            </div>
                            <Slider
                                value={segment.transitionDurationMs}
                                onChange={handleTransitionChange}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                min={250}
                                max={1500}
                            />
                        </div>

                        {/* Easing (with InfoTooltip like ZoomInspector) */}
                        <Dropdown
                            options={EASING_OPTIONS}
                            value={segment.easing}
                            onChange={handleEasingChange}
                            suffix={
                                <InfoTooltip description="">
                                    <EasingTooltipContent />
                                </InfoTooltip>
                            }
                        />
                    </>
                )}

                {/* Delete */}
                <Button onClick={handleDelete} fullWidth className="text-danger hover:text-danger">
                    <span>Delete</span>
                </Button>
            </div>
        </CollapsibleCard >
    );
};

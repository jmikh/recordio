import React, { useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, CollapsibleCard, MultiToggle, Toggle, InfoTooltip, Button, type DropdownOption } from '@shared/components';
import type { EasingStyle } from '../../../core/easing';
import type { CameraMoveSegment } from '../../../types';
import { PiWebcamBold } from 'react-icons/pi';
import { RxEnterFullScreen } from 'react-icons/rx';
import { EasingTooltipContent } from './EasingTooltipContent';
import { CameraMoveTooltip } from '../shared/MediaTooltips';

const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];

export const CameraMoveInspector: React.FC<{ segment: CameraMoveSegment }> = ({ segment }) => {
    const updateCameraMove = useProjectStore(s => s.updateCameraMove);
    const deleteCameraMove = useProjectStore(s => s.deleteCameraMove);
    const clearCameraMoves = useProjectStore(s => s.clearCameraMoves);
    const selectCameraMove = useUIStore(s => s.selectCameraMove);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const handleDelete = useCallback(() => {
        deleteCameraMove(segment.id);
        selectCameraMove(null);
    }, [segment.id, deleteCameraMove, selectCameraMove]);

    const handleDeleteAll = useCallback(() => {
        clearCameraMoves();
        selectCameraMove(null);
    }, [clearCameraMoves, selectCameraMove]);

    const handleTransitionChange = useCallback((val: number) => {
        batchAction(() => {
            updateCameraMove(segment.id, { transitionDurationMs: Math.round(val) });
        });
    }, [segment.id, batchAction, updateCameraMove]);

    const handleEasingChange = useCallback((val: EasingStyle) => {
        updateCameraMove(segment.id, { easing: val });
    }, [segment.id, updateCameraMove]);

    const outputSize = useProjectStore(s => s.project.settings.outputSize);

    const handleShapeChange = useCallback((val: string) => {
        const newShape = val as 'circle' | 'rect' | 'square';
        let w = segment.widthPx;
        let h = segment.heightPx;
        let x = segment.xPx;
        let y = segment.yPx;

        // Adjust dimensions based on shape
        if (newShape === 'circle' || newShape === 'square') {
            const size = Math.min(w, h);
            w = size;
            h = size;
        }

        // Bake borderRadiusPx based on shape — painter renders purely on radius
        const newRadius = newShape === 'circle' ? Math.min(w, h) / 2 : 10;

        // Clamp position to canvas bounds
        x = Math.max(0, Math.min(x, outputSize.width - w));
        y = Math.max(0, Math.min(y, outputSize.height - h));

        updateCameraMove(segment.id, {
            shape: newShape, borderRadiusPx: newRadius,
            widthPx: w, heightPx: h, xPx: x, yPx: y,
        });
    }, [segment.id, segment.widthPx, segment.heightPx, segment.xPx, segment.yPx, outputSize, updateCameraMove]);


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
        });
    }, [segment.id, outputSize, updateCameraMove]);

    const isHidden = !!segment.hidden;

    return (
        <CollapsibleCard title="Camera Layout" icon={<PiWebcamBold className="icon-md" />} notCollapsible headerAction={<CameraMoveTooltip />}>
            <div className="flex flex-col gap-5">
                <p className="subtext">Adjust the camera position, size, and shape for this segment.</p>

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
                            options={[
                                { value: 'rect', label: 'Free' },
                                { value: 'square', label: 'Square' },
                                { value: 'circle', label: 'Circle' },
                            ]}
                            value={segment.shape}
                            onChange={handleShapeChange}
                        />

                        {/* Fill Screen */}
                        <Button
                            onClick={handleFillScreen}
                            size="sm"
                            fullWidth
                            className="text-text-muted hover:text-text"
                        >
                            <RxEnterFullScreen className="icon-sm" />
                            <span>Fill Screen</span>
                        </Button>
                    </>
                )}

                {/* Transition Duration */}
                <div>
                    <div className="flex justify-between items-center mb-1.5">
                        <span className="text-sm text-text-muted">Transition</span>
                        <span className="text-xs text-text-muted">
                            {(segment.transitionDurationMs / 1000).toFixed(2)}s
                        </span>
                    </div>
                    <Slider
                        value={segment.transitionDurationMs}
                        onChange={handleTransitionChange}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        min={100}
                        max={2000}
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

                {/* Delete */}
                <div className="flex items-center gap-2">
                    <Button onClick={handleDelete} size="sm" className="flex-1 text-danger hover:text-danger">
                        <span>Delete This</span>
                    </Button>
                    <Button onClick={handleDeleteAll} size="sm" className="flex-1 text-danger hover:text-danger">
                        <span>Delete All</span>
                    </Button>
                </div>
            </div>
        </CollapsibleCard >
    );
};

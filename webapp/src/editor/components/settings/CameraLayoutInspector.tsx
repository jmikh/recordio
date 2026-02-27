import React, { useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, CollapsibleCard, MultiToggle, Toggle, InfoTooltip, type DropdownOption } from '@shared/components';
import type { EasingStyle } from '../../../core/easing';
import type { CameraLayoutSegment } from '../../../types';
import { PiWebcamBold } from 'react-icons/pi';
import { RxEnterFullScreen } from 'react-icons/rx';
import { EasingTooltipContent } from './EasingTooltipContent';

const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];

export const CameraLayoutInspector: React.FC<{ segment: CameraLayoutSegment }> = ({ segment }) => {
    const updateCameraLayout = useProjectStore(s => s.updateCameraLayout);
    const deleteCameraLayout = useProjectStore(s => s.deleteCameraLayout);
    const clearCameraLayouts = useProjectStore(s => s.clearCameraLayouts);
    const selectCameraLayout = useUIStore(s => s.selectCameraLayout);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const handleDelete = useCallback(() => {
        deleteCameraLayout(segment.id);
        selectCameraLayout(null);
    }, [segment.id, deleteCameraLayout, selectCameraLayout]);

    const handleDeleteAll = useCallback(() => {
        clearCameraLayouts();
        selectCameraLayout(null);
    }, [clearCameraLayouts, selectCameraLayout]);

    const handleTransitionChange = useCallback((val: number) => {
        batchAction(() => {
            updateCameraLayout(segment.id, { transitionDurationMs: Math.round(val) });
        });
    }, [segment.id, batchAction, updateCameraLayout]);

    const handleEasingChange = useCallback((val: EasingStyle) => {
        updateCameraLayout(segment.id, { easing: val });
    }, [segment.id, updateCameraLayout]);

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

        updateCameraLayout(segment.id, {
            shape: newShape, borderRadiusPx: newRadius,
            widthPx: w, heightPx: h, xPx: x, yPx: y,
        });
    }, [segment.id, segment.widthPx, segment.heightPx, segment.xPx, segment.yPx, outputSize, updateCameraLayout]);


    const handleHiddenToggle = useCallback((val: boolean) => {
        updateCameraLayout(segment.id, { hidden: val });
    }, [segment.id, updateCameraLayout]);

    const handleFillScreen = useCallback(() => {
        updateCameraLayout(segment.id, {
            xPx: 0,
            yPx: 0,
            widthPx: outputSize.width,
            heightPx: outputSize.height,
            shape: 'rect',
            borderRadiusPx: 0,
        });
    }, [segment.id, outputSize, updateCameraLayout]);

    const isHidden = !!segment.hidden;

    return (
        <CollapsibleCard title="Camera Layout" icon={<PiWebcamBold size={16} />} notCollapsible>
            <div className="flex flex-col gap-5">
                <p className="subtext">Adjust the webcam position, size, and shape for this segment.</p>

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
                        <button
                            onClick={handleFillScreen}
                            className="interactive-base flex items-center justify-center gap-1.5 w-full text-xs text-text-muted hover:text-text"
                        >
                            <RxEnterFullScreen size={14} />
                            <span>Fill Screen</span>
                        </button>
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
                    <button onClick={handleDelete} className="interactive-base flex items-center justify-center gap-2 flex-1 text-xs text-danger hover:text-danger">
                        <span>Delete This</span>
                    </button>
                    <button onClick={handleDeleteAll} className="interactive-base flex items-center justify-center gap-2 flex-1 text-xs text-danger hover:text-danger">
                        <span>Delete All</span>
                    </button>
                </div>
            </div>
        </CollapsibleCard >
    );
};

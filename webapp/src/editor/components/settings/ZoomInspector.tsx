import React, { useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, CollapsibleCard, InfoTooltip, Checkbox, Tooltip, Button, type DropdownOption } from '@shared/components';
import type { EasingStyle } from '@shared/animators/easing';
import type { ZoomSegment } from '@shared/types';
import { TbZoomIn } from 'react-icons/tb';
import { EasingTooltipContent } from './EasingTooltipContent';

const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];

export const ZoomInspector: React.FC<{ segment: ZoomSegment }> = ({ segment }) => {
    const updateZoomSegment = useProjectStore(s => s.updateZoomSegment);
    const deleteZoomSegment = useProjectStore(s => s.deleteZoomSegment);
    const clearZoomSegments = useProjectStore(s => s.clearZoomSegments);
    const resetZooms = useProjectStore(s => s.resetZooms);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const selectZoom = useUIStore(s => s.selectZoom);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const allZoomSegments = useProjectStore(s => s.project.timeline.zoomSegments);
    const zoomSettings = useProjectStore(s => s.project.settings.zoom);
    const hasTrackableContent = useProjectStore(s => !!s.project.screenSource.trackableContentRect);

    // Per-setting "apply to all" checkboxes — reset on each mount
    const [applyTransitionToAll, setApplyTransitionToAll] = useState(false);
    const [applyEasingToAll, setApplyEasingToAll] = useState(false);

    const handleDelete = useCallback(() => {
        deleteZoomSegment(segment.id);
        selectZoom(null);
    }, [segment.id, deleteZoomSegment, selectZoom]);

    const handleDeleteAll = useCallback(() => {
        clearZoomSegments();
        selectZoom(null);
    }, [clearZoomSegments, selectZoom]);

    const handleTransitionChange = useCallback((val: number) => {
        const rounded = Math.round(val);
        batchAction(() => {
            updateZoomSegment(segment.id, { transitionDurationMs: rounded });

            if (applyTransitionToAll) {
                for (const z of allZoomSegments) {
                    if (z.id !== segment.id) {
                        updateZoomSegment(z.id, { transitionDurationMs: rounded });
                    }
                }
                updateSettings({
                    zoom: { ...zoomSettings, transitionDurationMs: rounded }
                });
            }
        });
    }, [segment.id, batchAction, updateZoomSegment, applyTransitionToAll, allZoomSegments, zoomSettings, updateSettings]);

    const handleEasingChange = useCallback((val: EasingStyle) => {
        updateZoomSegment(segment.id, { easing: val });

        if (applyEasingToAll) {
            for (const z of allZoomSegments) {
                if (z.id !== segment.id) {
                    updateZoomSegment(z.id, { easing: val });
                }
            }
            updateSettings({
                zoom: { ...zoomSettings, easing: val }
            });
        }
    }, [segment.id, updateZoomSegment, applyEasingToAll, allZoomSegments, zoomSettings, updateSettings]);

    // When a checkbox is toggled on, immediately apply current value to all
    const handleToggleTransitionAll = useCallback((checked: boolean) => {
        setApplyTransitionToAll(checked);
        if (checked) {
            for (const z of allZoomSegments) {
                if (z.id !== segment.id) {
                    updateZoomSegment(z.id, { transitionDurationMs: segment.transitionDurationMs });
                }
            }
            updateSettings({
                zoom: { ...zoomSettings, transitionDurationMs: segment.transitionDurationMs }
            });
        }
    }, [segment, allZoomSegments, zoomSettings, updateZoomSegment, updateSettings]);

    const handleToggleEasingAll = useCallback((checked: boolean) => {
        setApplyEasingToAll(checked);
        if (checked) {
            for (const z of allZoomSegments) {
                if (z.id !== segment.id) {
                    updateZoomSegment(z.id, { easing: segment.easing });
                }
            }
            updateSettings({
                zoom: { ...zoomSettings, easing: segment.easing }
            });
        }
    }, [segment, allZoomSegments, zoomSettings, updateZoomSegment, updateSettings]);

    return (
        <CollapsibleCard title="Zoom" icon={<TbZoomIn className="icon-md" />} notCollapsible>
            <div className="flex flex-col gap-5">
                <p className="subtext">Check the box to apply to all zooms.</p>
                {/* Transition Duration — custom label row with inline checkbox */}
                <div>
                    <div className="flex justify-between items-center mb-1.5">
                        <div className="flex items-center gap-1.5">
                            <Tooltip text="Apply to all zooms">
                                <Checkbox
                                    checked={applyTransitionToAll}
                                    onChange={handleToggleTransitionAll}
                                />
                            </Tooltip>
                            <span className="text-sm text-text-muted">Transition</span>
                        </div>
                        <span className="text-xs text-text-muted">
                            {(segment.transitionDurationMs / 1000).toFixed(2)}s
                        </span>
                    </div>
                    <Slider
                        value={segment.transitionDurationMs}
                        onChange={handleTransitionChange}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        min={250}
                        max={2000}
                    />
                </div>

                {/* Easing — checkbox inline to the left */}
                <div className="flex items-center gap-2">
                    <Tooltip text="Apply to all zooms">
                        <Checkbox
                            checked={applyEasingToAll}
                            onChange={handleToggleEasingAll}
                        />
                    </Tooltip>
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
                </div>

                {/* Delete */}
                <div className="flex items-center gap-2">
                    <Button onClick={handleDelete} size="sm" className="flex-1 text-danger hover:text-danger">
                        <span>Delete This</span>
                    </Button>
                    <Button onClick={handleDeleteAll} size="sm" className="flex-1 text-danger hover:text-danger">
                        <span>Delete All</span>
                    </Button>
                </div>

                {/* Auto Generate */}
                {hasTrackableContent && (
                    <Button variant="primary" size="sm" onClick={() => { resetZooms(); selectZoom(null); }}>
                        <span>Regenerate Auto Zooms</span>
                    </Button>
                )}
            </div>
        </CollapsibleCard>
    );
};

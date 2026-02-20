import React, { useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, GhostButton, CollapsibleCard, type DropdownOption } from '@shared/components';
import type { EasingStyle } from '../../../core/easing';
import type { ZoomSegment } from '../../../types';
import { MdDelete } from 'react-icons/md';
import { TbZoomIn } from 'react-icons/tb';
import { VscCopy } from 'react-icons/vsc';

const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];

export const ZoomInspector: React.FC<{ segment: ZoomSegment }> = ({ segment }) => {
    const updateZoomSegment = useProjectStore(s => s.updateZoomSegment);
    const deleteZoomSegment = useProjectStore(s => s.deleteZoomSegment);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const { batchAction } = useHistoryBatcher();

    const allZoomSegments = useProjectStore(s => s.project.timeline.zoomSegments);
    const zoomSettings = useProjectStore(s => s.project.settings.zoom);

    const handleDelete = useCallback(() => {
        deleteZoomSegment(segment.id);
        setCanvasMode(CanvasMode.Preview);
    }, [segment.id, deleteZoomSegment, setCanvasMode]);

    const handleTransitionChange = useCallback((val: number) => {
        batchAction(() => updateZoomSegment(segment.id, { transitionDurationMs: Math.round(val) }));
    }, [segment.id, batchAction, updateZoomSegment]);

    const handleEasingChange = useCallback((val: EasingStyle) => {
        updateZoomSegment(segment.id, { easing: val });
    }, [segment.id, updateZoomSegment]);

    const handleApplyToAll = useCallback(() => {
        const updates = {
            transitionDurationMs: segment.transitionDurationMs,
            easing: segment.easing,
        };
        for (const z of allZoomSegments) {
            if (z.id !== segment.id) {
                updateZoomSegment(z.id, updates);
            }
        }
        updateSettings({
            zoom: { ...zoomSettings, transitionDurationMs: segment.transitionDurationMs, easing: segment.easing }
        });
    }, [segment, allZoomSegments, zoomSettings, updateZoomSegment, updateSettings]);

    return (
        <CollapsibleCard title="Zoom" icon={<TbZoomIn size={16} />} notCollapsible>
            <div className="flex flex-col gap-5">
                {/* Transition Duration */}
                <Slider
                    label="Transition"
                    value={segment.transitionDurationMs}
                    onChange={handleTransitionChange}
                    min={100}
                    max={1500}
                    units="ms"
                    showTooltip
                />

                {/* Easing */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-text-muted">Easing</span>
                    <Dropdown
                        options={EASING_OPTIONS}
                        value={segment.easing}
                        onChange={handleEasingChange}
                    />
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                    <GhostButton onClick={handleApplyToAll} className="text-xs justify-start">
                        <VscCopy size={14} />
                        <span>Apply to All Zooms</span>
                    </GhostButton>
                    <GhostButton onClick={handleDelete} className="text-xs justify-start text-danger hover:text-danger">
                        <MdDelete size={16} />
                        <span>Delete Zoom</span>
                    </GhostButton>
                </div>
            </div>
        </CollapsibleCard>
    );
};

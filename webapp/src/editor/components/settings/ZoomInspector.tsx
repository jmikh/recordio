import React, { useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, CollapsibleCard, InfoTooltip, Checkbox, Button } from '@shared/components';
import type { ZoomSegment } from '@shared/types';
import { TbZoomIn } from 'react-icons/tb';
import { EasingTooltipContent } from './EasingTooltipContent';
import { EASING_OPTIONS } from './easingOptions';

type ZoomLook = Partial<Pick<ZoomSegment, 'transitionDurationMs' | 'easing'>>;

/**
 * One zoom segment. A single "Apply to all zooms" checkbox (off on each
 * mount) routes edits through applyZoomSettingsToAll instead — every
 * segment plus the project default. Delete All / Regenerate live in the
 * Motion tab.
 */
export const ZoomInspector: React.FC<{ segment: ZoomSegment }> = ({ segment }) => {
    const updateZoomSegment = useProjectStore(s => s.updateZoomSegment);
    const applyZoomSettingsToAll = useProjectStore(s => s.applyZoomSettingsToAll);
    const deleteZoomSegment = useProjectStore(s => s.deleteZoomSegment);
    const selectZoom = useUIStore(s => s.selectZoom);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const [applyToAll, setApplyToAll] = useState(false);

    const change = useCallback((updates: ZoomLook) => {
        if (applyToAll) applyZoomSettingsToAll(updates);
        else updateZoomSegment(segment.id, updates);
    }, [applyToAll, applyZoomSettingsToAll, updateZoomSegment, segment.id]);

    const handleDelete = useCallback(() => {
        deleteZoomSegment(segment.id);
        selectZoom(null);
    }, [segment.id, deleteZoomSegment, selectZoom]);

    return (
        <CollapsibleCard title="Zoom" icon={<TbZoomIn className="icon-md" />} notCollapsible>
            <div className="flex flex-col gap-5">
                <Checkbox
                    checked={applyToAll}
                    onChange={setApplyToAll}
                    label="Apply to all zooms"
                />
                <Slider
                    label="Transition"
                    value={segment.transitionDurationMs}
                    onChange={(v) => batchAction(() => change({ transitionDurationMs: Math.round(v) }))}
                    onPointerDown={startInteraction}
                    onPointerUp={endInteraction}
                    min={250}
                    max={2000}
                    showTooltip
                    units="ms"
                    decimals={0}
                />
                <Dropdown
                    label="Easing"
                    options={EASING_OPTIONS}
                    value={segment.easing}
                    onChange={(easing) => change({ easing })}
                    suffix={
                        <InfoTooltip description="">
                            <EasingTooltipContent />
                        </InfoTooltip>
                    }
                />
                <Button onClick={handleDelete} fullWidth className="text-danger hover:text-danger">
                    <span>Delete This Zoom</span>
                </Button>
                <p className="text-label">Delete all or regenerate zooms from the Motion tab.</p>
            </div>
        </CollapsibleCard>
    );
};

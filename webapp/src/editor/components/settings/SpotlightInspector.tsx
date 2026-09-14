import React, { useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, CollapsibleCard, InfoTooltip, Checkbox, Button } from '@shared/components';
import type { SpotlightSegment } from '@shared/types';
import { RiLightbulbFlashLine } from 'react-icons/ri';
import { EasingTooltipContent } from './EasingTooltipContent';
import { SpotlightTooltip } from '../shared/MediaTooltips';
import { EASING_OPTIONS } from './easingOptions';

type SpotlightLook = Partial<Pick<SpotlightSegment, 'scale' | 'dimOpacity' | 'transitionDurationMs' | 'easing'>>;

/**
 * One spotlight segment. A single "Apply to all spotlights" checkbox (off
 * on each mount) routes edits through applySpotlightSettingsToAll instead
 * — every segment plus the project default (segment.scale ↔
 * settings.enlargeScale). Delete All / Regenerate live in the Motion tab.
 */
export const SpotlightInspector: React.FC<{ segment: SpotlightSegment }> = ({ segment }) => {
    const updateSpotlight = useProjectStore(s => s.updateSpotlight);
    const applySpotlightSettingsToAll = useProjectStore(s => s.applySpotlightSettingsToAll);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);
    const selectSpotlight = useUIStore(s => s.selectSpotlight);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const [applyToAll, setApplyToAll] = useState(false);

    const change = useCallback((updates: SpotlightLook) => {
        if (applyToAll) {
            const { scale, ...rest } = updates;
            applySpotlightSettingsToAll({ ...rest, ...(scale !== undefined ? { enlargeScale: scale } : {}) });
        } else {
            updateSpotlight(segment.id, updates);
        }
    }, [applyToAll, applySpotlightSettingsToAll, updateSpotlight, segment.id]);

    const handleDelete = useCallback(() => {
        deleteSpotlight(segment.id);
        selectSpotlight(null);
    }, [segment.id, deleteSpotlight, selectSpotlight]);

    return (
        <CollapsibleCard title="Spotlight" icon={<RiLightbulbFlashLine className="icon-md" />} notCollapsible headerAction={<SpotlightTooltip />}>
            <div className="flex flex-col gap-5">
                <Checkbox
                    checked={applyToAll}
                    onChange={setApplyToAll}
                    label="Apply to all spotlights"
                />
                <Slider
                    label="Enlarge"
                    value={segment.scale}
                    onChange={(scale) => batchAction(() => change({ scale }))}
                    onPointerDown={startInteraction}
                    onPointerUp={endInteraction}
                    min={1.1}
                    max={2}
                    decimals={2}
                    units="×"
                    showTooltip
                />
                <Slider
                    label="Dim"
                    value={segment.dimOpacity}
                    onChange={(dimOpacity) => batchAction(() => change({ dimOpacity }))}
                    onPointerDown={startInteraction}
                    onPointerUp={endInteraction}
                    min={0.1}
                    max={0.9}
                    showTooltip
                    units="%"
                    decimals={0}
                    valueTransform={(v) => v * 100}
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
                    <span>Delete This Spotlight</span>
                </Button>
                <p className="text-label">Delete all or regenerate spotlights from the Motion tab.</p>
            </div>
        </CollapsibleCard>
    );
};

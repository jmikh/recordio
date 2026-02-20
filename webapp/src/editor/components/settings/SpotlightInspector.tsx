import React, { useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, DefaultButton, CollapsibleCard, InfoTooltip, type DropdownOption } from '@shared/components';
import type { EasingStyle } from '../../../core/easing';
import type { SpotlightSegment } from '../../../types';
import { MdDelete } from 'react-icons/md';
import { RiLightbulbFlashLine } from 'react-icons/ri';
import { VscCopy } from 'react-icons/vsc';
import { EasingTooltipContent } from './EasingTooltipContent';

const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];

export const SpotlightInspector: React.FC<{ segment: SpotlightSegment }> = ({ segment }) => {
    const updateSpotlight = useProjectStore(s => s.updateSpotlight);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const selectSpotlight = useUIStore(s => s.selectSpotlight);
    const { batchAction } = useHistoryBatcher();

    const allSpotlightSegments = useProjectStore(s => s.project.timeline.spotlightSegments);
    const spotlightSettings = useProjectStore(s => s.project.settings.spotlight);

    const handleDelete = useCallback(() => {
        deleteSpotlight(segment.id);
        selectSpotlight(null);
    }, [segment.id, deleteSpotlight, selectSpotlight]);

    const handleDimOpacityChange = useCallback((val: number) => {
        batchAction(() => updateSpotlight(segment.id, { dimOpacity: val }));
    }, [segment.id, batchAction, updateSpotlight]);

    const handleScaleChange = useCallback((val: number) => {
        batchAction(() => updateSpotlight(segment.id, { scale: val }));
    }, [segment.id, batchAction, updateSpotlight]);

    const handleTransitionChange = useCallback((val: number) => {
        batchAction(() => updateSpotlight(segment.id, { transitionDurationMs: Math.round(val) }));
    }, [segment.id, batchAction, updateSpotlight]);

    const handleEasingChange = useCallback((val: EasingStyle) => {
        updateSpotlight(segment.id, { easing: val });
    }, [segment.id, updateSpotlight]);

    const handleApplyToAll = useCallback(() => {
        const updates = {
            dimOpacity: segment.dimOpacity,
            transitionDurationMs: segment.transitionDurationMs,
            easing: segment.easing,
        };
        for (const s of allSpotlightSegments) {
            if (s.id !== segment.id) {
                updateSpotlight(s.id, updates);
            }
        }
        updateSettings({
            spotlight: {
                ...spotlightSettings,
                dimOpacity: segment.dimOpacity,
                transitionDurationMs: segment.transitionDurationMs,
                easing: segment.easing,
            }
        });
    }, [segment, allSpotlightSegments, spotlightSettings, updateSpotlight, updateSettings]);

    return (
        <CollapsibleCard title="Spotlight" icon={<RiLightbulbFlashLine size={16} />} notCollapsible>
            <div className="flex flex-col gap-5">
                {/* Scale */}
                <Slider
                    label="Enlarge"
                    value={segment.scale}
                    onChange={handleScaleChange}
                    min={1}
                    max={2}
                    decimals={2}
                    units="x"
                    showTooltip
                />

                {/* Delete */}
                <DefaultButton onClick={handleDelete} className="text-xs justify-start">
                    <MdDelete size={16} />
                    <span>Delete Spotlight</span>
                </DefaultButton>

                {/* Separator + remaining settings */}
                <div className="flex flex-col gap-5 pt-2 border-t border-border">
                    {/* Dim Opacity */}
                    <Slider
                        label="Dim"
                        value={segment.dimOpacity}
                        onChange={handleDimOpacityChange}
                        min={0.1}
                        max={1}
                        decimals={0}
                        units="%"
                        valueTransform={(v) => v * 100}
                        showTooltip
                    />

                    {/* Transition Duration */}
                    <Slider
                        label="Transition"
                        value={segment.transitionDurationMs}
                        onChange={handleTransitionChange}
                        min={0}
                        max={1000}
                        decimals={2}
                        valueTransform={(v) => v / 1000}
                        units="s"
                        showTooltip
                    />

                    {/* Easing */}
                    <div className="flex items-center gap-1.5">
                        <Dropdown
                            options={EASING_OPTIONS}
                            value={segment.easing}
                            onChange={handleEasingChange}
                        />
                        <InfoTooltip description="">
                            <EasingTooltipContent />
                        </InfoTooltip>
                    </div>

                    {/* Apply to All */}
                    <DefaultButton onClick={handleApplyToAll} className="text-xs justify-start">
                        <VscCopy size={14} />
                        <span>Apply to All Spotlights</span>
                    </DefaultButton>
                </div>
            </div>
        </CollapsibleCard>
    );
};

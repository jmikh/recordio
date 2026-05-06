import React, { useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, CollapsibleCard, InfoTooltip, Checkbox, Tooltip, Button, type DropdownOption } from '@shared/components';
import type { EasingStyle } from '@shared/animators/easing';
import type { SpotlightSegment } from '@shared/types';
import { RiLightbulbFlashLine } from 'react-icons/ri';
import { EasingTooltipContent } from './EasingTooltipContent';
import { SpotlightTooltip } from '../shared/MediaTooltips';

const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];

export const SpotlightInspector: React.FC<{ segment: SpotlightSegment }> = ({ segment }) => {
    const updateSpotlight = useProjectStore(s => s.updateSpotlight);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);
    const clearSpotlights = useProjectStore(s => s.clearSpotlights);
    const resetSpotlights = useProjectStore(s => s.resetSpotlights);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const selectSpotlight = useUIStore(s => s.selectSpotlight);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const allSpotlightSegments = useProjectStore(s => s.project.timeline.spotlightSegments);
    const spotlightSettings = useProjectStore(s => s.project.settings.spotlight);
    const hasTrackableContent = useProjectStore(s => !!s.project.screenSource.trackableContentRect);
    const hasHoveredCards = useProjectStore(s => (s.userEvents.hoveredCards || []).length > 0);

    // Per-setting "apply to all" checkboxes — reset on each mount
    const [applyDimToAll, setApplyDimToAll] = useState(false);
    const [applyTransitionToAll, setApplyTransitionToAll] = useState(false);
    const [applyEasingToAll, setApplyEasingToAll] = useState(false);

    const handleDelete = useCallback(() => {
        deleteSpotlight(segment.id);
        selectSpotlight(null);
    }, [segment.id, deleteSpotlight, selectSpotlight]);

    const handleDeleteAll = useCallback(() => {
        clearSpotlights();
        selectSpotlight(null);
    }, [clearSpotlights, selectSpotlight]);

    const handleScaleChange = useCallback((val: number) => {
        batchAction(() => updateSpotlight(segment.id, { scale: val }));
    }, [segment.id, batchAction, updateSpotlight]);

    const handleDimOpacityChange = useCallback((val: number) => {
        batchAction(() => {
            updateSpotlight(segment.id, { dimOpacity: val });

            if (applyDimToAll) {
                for (const s of allSpotlightSegments) {
                    if (s.id !== segment.id) {
                        updateSpotlight(s.id, { dimOpacity: val });
                    }
                }
                updateSettings({
                    spotlight: { ...spotlightSettings, dimOpacity: val }
                });
            }
        });
    }, [segment.id, batchAction, updateSpotlight, applyDimToAll, allSpotlightSegments, spotlightSettings, updateSettings]);

    const handleTransitionChange = useCallback((val: number) => {
        const rounded = Math.round(val);
        batchAction(() => {
            updateSpotlight(segment.id, { transitionDurationMs: rounded });

            if (applyTransitionToAll) {
                for (const s of allSpotlightSegments) {
                    if (s.id !== segment.id) {
                        updateSpotlight(s.id, { transitionDurationMs: rounded });
                    }
                }
                updateSettings({
                    spotlight: { ...spotlightSettings, transitionDurationMs: rounded }
                });
            }
        });
    }, [segment.id, batchAction, updateSpotlight, applyTransitionToAll, allSpotlightSegments, spotlightSettings, updateSettings]);

    const handleEasingChange = useCallback((val: EasingStyle) => {
        updateSpotlight(segment.id, { easing: val });

        if (applyEasingToAll) {
            for (const s of allSpotlightSegments) {
                if (s.id !== segment.id) {
                    updateSpotlight(s.id, { easing: val });
                }
            }
            updateSettings({
                spotlight: { ...spotlightSettings, easing: val }
            });
        }
    }, [segment.id, updateSpotlight, applyEasingToAll, allSpotlightSegments, spotlightSettings, updateSettings]);

    // When a checkbox is toggled on, immediately apply current value to all
    const handleToggleDimAll = useCallback((checked: boolean) => {
        setApplyDimToAll(checked);
        if (checked) {
            for (const s of allSpotlightSegments) {
                if (s.id !== segment.id) {
                    updateSpotlight(s.id, { dimOpacity: segment.dimOpacity });
                }
            }
            updateSettings({
                spotlight: { ...spotlightSettings, dimOpacity: segment.dimOpacity }
            });
        }
    }, [segment, allSpotlightSegments, spotlightSettings, updateSpotlight, updateSettings]);

    const handleToggleTransitionAll = useCallback((checked: boolean) => {
        setApplyTransitionToAll(checked);
        if (checked) {
            for (const s of allSpotlightSegments) {
                if (s.id !== segment.id) {
                    updateSpotlight(s.id, { transitionDurationMs: segment.transitionDurationMs });
                }
            }
            updateSettings({
                spotlight: { ...spotlightSettings, transitionDurationMs: segment.transitionDurationMs }
            });
        }
    }, [segment, allSpotlightSegments, spotlightSettings, updateSpotlight, updateSettings]);

    const handleToggleEasingAll = useCallback((checked: boolean) => {
        setApplyEasingToAll(checked);
        if (checked) {
            for (const s of allSpotlightSegments) {
                if (s.id !== segment.id) {
                    updateSpotlight(s.id, { easing: segment.easing });
                }
            }
            updateSettings({
                spotlight: { ...spotlightSettings, easing: segment.easing }
            });
        }
    }, [segment, allSpotlightSegments, spotlightSettings, updateSpotlight, updateSettings]);

    return (
        <CollapsibleCard title="Spotlight" icon={<RiLightbulbFlashLine className="icon-md" />} notCollapsible headerAction={<SpotlightTooltip />}>
            <div className="flex flex-col gap-5">
                <p className="subtext">Check the box to apply to all spotlights.</p>

                {/* Scale — no checkbox, each is independent */}
                <Slider
                    label="Enlarge"
                    value={segment.scale}
                    onChange={handleScaleChange}
                    onPointerDown={startInteraction}
                    onPointerUp={endInteraction}
                    min={1.1}
                    max={2}
                    decimals={2}
                    units="x"
                    showTooltip
                />

                {/* Dim Opacity — custom label row with inline checkbox */}
                <div>
                    <div className="flex justify-between items-center mb-1.5">
                        <div className="flex items-center gap-1.5">
                            <Tooltip text="Apply to all spotlights">
                                <Checkbox
                                    checked={applyDimToAll}
                                    onChange={handleToggleDimAll}
                                />
                            </Tooltip>
                            <span className="text-sm text-text-muted">Dim</span>
                        </div>
                        <span className="text-xs text-text-muted">
                            {Math.round(segment.dimOpacity * 100)}%
                        </span>
                    </div>
                    <Slider
                        value={segment.dimOpacity}
                        onChange={handleDimOpacityChange}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        min={0.1}
                        max={0.9}
                    />
                </div>

                {/* Transition Duration — custom label row with inline checkbox */}
                <div>
                    <div className="flex justify-between items-center mb-1.5">
                        <div className="flex items-center gap-1.5">
                            <Tooltip text="Apply to all spotlights">
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
                    <Tooltip text="Apply to all spotlights">
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
                    <Tooltip text={!hasHoveredCards ? 'Could not automatically detect areas in the recording suitable for spotlighting.' : ''}>
                        <Button
                            variant="primary"
                            size="sm"
                            fullWidth
                            onClick={() => { resetSpotlights(); selectSpotlight(null); }}
                            disabled={!hasHoveredCards}
                        >
                            <span>Regenerate Auto Spotlights</span>
                        </Button>
                    </Tooltip>
                )}
            </div>
        </CollapsibleCard>
    );
};

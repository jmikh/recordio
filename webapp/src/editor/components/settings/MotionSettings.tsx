import { LuLightbulb, LuZoomIn } from 'react-icons/lu';
import { Button, CollapsibleCard, Dropdown, InfoTooltip, Slider, Toggle, Tooltip } from '@shared/components';
import { useToast } from '../../../components/Toast';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { EasingTooltipContent } from './EasingTooltipContent';
import { SpotlightTooltip } from '../shared/MediaTooltips';
import { PreviewEffectButton } from './PreviewEffectButton';
import { EASING_OPTIONS } from './easingOptions';

/**
 * Motion tab — the zoom and spotlight look for the whole project.
 *
 * Editor: every change goes through applyZoomSettingsToAll /
 * applySpotlightSettingsToAll, so it updates the project defaults AND every
 * existing segment in one undo step. Regenerate / Delete All live here too.
 * A single segment is edited from its inspector (click it on the timeline).
 *
 * Personal Settings (template mode): the same controls edit the defaults,
 * plus the Auto-zoom / Auto-spotlight toggles (first-open generation only —
 * the timeline tracks are never disabled by a default) and Preview buttons.
 */
export const MotionSettings = () => {
    const zoom = useProjectStore(s => s.project.settings.zoom);
    const spotlight = useProjectStore(s => s.project.settings.spotlight);
    const templateMode = useProjectStore(s => s.templateMode);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const applyZoomSettingsToAll = useProjectStore(s => s.applyZoomSettingsToAll);
    const applySpotlightSettingsToAll = useProjectStore(s => s.applySpotlightSettingsToAll);
    const resetZooms = useProjectStore(s => s.resetZooms);
    const clearZoomSegments = useProjectStore(s => s.clearZoomSegments);
    const resetSpotlights = useProjectStore(s => s.resetSpotlights);
    const clearSpotlights = useProjectStore(s => s.clearSpotlights);
    const zoomCount = useProjectStore(s => s.project.timeline.zoomSegments.length);
    const spotlightCount = useProjectStore(s => s.project.timeline.spotlightSegments.length);
    const hasTrackableContent = useProjectStore(s => !!s.project.screenSource.trackableContentRect);
    const hasHoveredCards = useProjectStore(s => (s.userEvents.hoveredCards || []).length > 0);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();
    const { addToast } = useToast();

    /** Regenerate, then report what came out of it — a run with no usable focus areas looks identical otherwise. */
    const handleRegenerateZooms = () => {
        const count = resetZooms();
        addToast(count > 0
            ? { type: 'success', title: `${count} auto zoom${count === 1 ? '' : 's'} generated` }
            : { type: 'info', title: 'No auto zooms generated', message: 'Could not detect long enough focus areas for auto zoom.' }
        );
    };

    const showCollapsibleZoom = useUIStore(s => s.showCollapsibleZoom);
    const showCollapsibleSpotlight = useUIStore(s => s.showCollapsibleSpotlight);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    const autoZoom = zoom.autoGenerate ?? true;
    const autoSpotlight = spotlight.autoGenerate ?? true;

    return (
        <div className="flex flex-col gap-3 text-sm text-text-main">
            {/* ZOOM */}
            <CollapsibleCard
                title="Zoom"
                icon={<LuZoomIn className="icon-md" />}
                previewItems={[
                    ...(templateMode ? [{ type: 'text' as const, content: autoZoom ? 'Auto' : 'Manual' }] : []),
                    { type: 'text', content: `${zoom.maxZoom.toFixed(1)}×` },
                    { type: 'text', content: `${zoom.transitionDurationMs}ms` },
                ]}
                isExpanded={showCollapsibleZoom}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleZoom', v)}
            >
                <div className="flex flex-col gap-4">
                    {templateMode && (
                        <Toggle
                            label="Auto-zoom"
                            value={autoZoom}
                            onChange={(autoGenerate) => updateSettings({ zoom: { ...zoom, autoGenerate } })}
                        >
                            <InfoTooltip description="Generates zooms from clicks when a new recording opens. Off = no automatic zooms; you can still add zooms in the editor." />
                            <PreviewEffectButton kind="zoom" label="Preview auto-zoom" />
                        </Toggle>
                    )}
                    <Slider
                        label="Max zoom"
                        min={1.2}
                        max={3}
                        value={zoom.maxZoom}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(maxZoom) => batchAction(() => updateSettings({ zoom: { ...zoom, maxZoom } }))}
                        showTooltip
                        units="×"
                        decimals={1}
                        labelSuffix={!templateMode && (
                            <InfoTooltip description="Max zoom applies when zooms are regenerated." />
                        )}
                    />
                    <Slider
                        label="Transition"
                        min={250}
                        max={2000}
                        value={zoom.transitionDurationMs}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(v) => batchAction(() => applyZoomSettingsToAll({ transitionDurationMs: Math.round(v) }))}
                        showTooltip
                        units="ms"
                        decimals={0}
                    />
                    <Dropdown
                        label="Easing"
                        options={EASING_OPTIONS}
                        value={zoom.easing}
                        onChange={(easing) => applyZoomSettingsToAll({ easing })}
                        suffix={
                            <InfoTooltip description="">
                                <EasingTooltipContent />
                            </InfoTooltip>
                        }
                    />
                    {!templateMode && (
                        <div className="flex flex-col gap-2 pt-1">
                            {hasTrackableContent && (
                                <Button variant="primary" fullWidth onClick={handleRegenerateZooms}>
                                    <span>Regenerate Auto Zooms</span>
                                </Button>
                            )}
                            <Button
                                fullWidth
                                onClick={() => clearZoomSegments()}
                                disabled={zoomCount === 0}
                                className="text-danger hover:text-danger"
                            >
                                <span>Delete All Zooms</span>
                            </Button>
                        </div>
                    )}
                </div>
            </CollapsibleCard>

            {/* SPOTLIGHT */}
            <CollapsibleCard
                title="Spotlight"
                icon={<LuLightbulb className="icon-md" />}
                headerAction={<SpotlightTooltip />}
                previewItems={[
                    ...(templateMode ? [{ type: 'text' as const, content: autoSpotlight ? 'Auto' : 'Manual' }] : []),
                    { type: 'text', content: `${Math.round(spotlight.dimOpacity * 100)}%` },
                    { type: 'text', content: `${spotlight.transitionDurationMs}ms` },
                ]}
                isExpanded={showCollapsibleSpotlight}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleSpotlight', v)}
            >
                <div className="flex flex-col gap-4">
                    {templateMode && (
                        <Toggle
                            label="Auto-spotlight"
                            value={autoSpotlight}
                            onChange={(autoGenerate) => updateSettings({ spotlight: { ...spotlight, autoGenerate } })}
                        >
                            <InfoTooltip description="Generates spotlights from hovered cards when a new recording opens. Off = no automatic spotlights; you can still add spotlights in the editor." />
                            <PreviewEffectButton kind="spotlight" label="Preview spotlight" />
                        </Toggle>
                    )}
                    <Slider
                        label="Enlarge"
                        min={1.1}
                        max={2}
                        value={spotlight.enlargeScale}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(enlargeScale) => batchAction(() => applySpotlightSettingsToAll({ enlargeScale }))}
                        showTooltip
                        units="×"
                        decimals={2}
                    />
                    <Slider
                        label="Dim"
                        min={0.1}
                        max={0.9}
                        value={spotlight.dimOpacity}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(dimOpacity) => batchAction(() => applySpotlightSettingsToAll({ dimOpacity }))}
                        showTooltip
                        units="%"
                        decimals={0}
                        valueTransform={(v) => v * 100}
                    />
                    <Slider
                        label="Transition"
                        min={250}
                        max={2000}
                        value={spotlight.transitionDurationMs}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(v) => batchAction(() => applySpotlightSettingsToAll({ transitionDurationMs: Math.round(v) }))}
                        showTooltip
                        units="ms"
                        decimals={0}
                    />
                    <Dropdown
                        label="Easing"
                        options={EASING_OPTIONS}
                        value={spotlight.easing}
                        onChange={(easing) => applySpotlightSettingsToAll({ easing })}
                        suffix={
                            <InfoTooltip description="">
                                <EasingTooltipContent />
                            </InfoTooltip>
                        }
                    />
                    {!templateMode && (
                        <div className="flex flex-col gap-2 pt-1">
                            {hasTrackableContent && (
                                <Tooltip text={!hasHoveredCards ? 'Could not automatically detect areas in the recording suitable for spotlighting.' : ''}>
                                    <Button
                                        variant="primary"
                                        fullWidth
                                        onClick={() => resetSpotlights()}
                                        disabled={!hasHoveredCards}
                                    >
                                        <span>Regenerate Auto Spotlights</span>
                                    </Button>
                                </Tooltip>
                            )}
                            <Button
                                fullWidth
                                onClick={() => clearSpotlights()}
                                disabled={spotlightCount === 0}
                                className="text-danger hover:text-danger"
                            >
                                <span>Delete All Spotlights</span>
                            </Button>
                        </div>
                    )}
                </div>
            </CollapsibleCard>
        </div>
    );
};

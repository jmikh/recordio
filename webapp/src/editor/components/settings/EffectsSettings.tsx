
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, Toggle, CollapsibleCard, DefaultButton, InfoTooltip, type PreviewItem } from '@shared/components';
import { FaTrash } from 'react-icons/fa';

export const EffectsSettings = () => {
    const updateSettings = useProjectStore(s => s.updateSettings);
    const clearZoomActions = useProjectStore(s => s.clearZoomActions);
    const zoomSettings = useProjectStore(s => s.project.settings.zoom);
    const spotlightSettings = useProjectStore(s => s.project.settings.spotlight);
    const effectSettings = useProjectStore(s => s.project.settings.effects);
    const zoomActions = useProjectStore(s => s.project.timeline.zoomActions || []);
    const userEvents = useProjectStore(s => s.project.userEvents);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Check if user events exist (Chrome tab/window vs desktop)
    const hasUserEvents = userEvents.mousePositions.length > 0;

    // Collapsible visibility state
    const showCollapsibleZoom = useUIStore(s => s.showCollapsibleZoom);
    const showCollapsibleSpotlight = useUIStore(s => s.showCollapsibleSpotlight);
    const showCollapsibleEffects = useUIStore(s => s.showCollapsibleEffects);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    // Spotlight handlers
    const handleDimOpacityChange = (val: number) => {
        batchAction(() => updateSettings({ spotlight: { ...spotlightSettings, dimOpacity: val } }));
    };

    const handleEnlargeScaleChange = (val: number) => {
        batchAction(() => updateSettings({ spotlight: { ...spotlightSettings, enlargeScale: val } }));
    };

    const handleTransitionDurationChange = (val: number) => {
        batchAction(() => updateSettings({ spotlight: { ...spotlightSettings, transitionDurationMs: val } }));
    };

    // Tooltip message for disabled auto toggles
    const autoDisabledTooltip = "Auto effects require mouse events, which are only captured during Chrome tab and window recordings.";

    const handleClearZooms = () => {
        // 1. Clear motions
        clearZoomActions();
        // 2. Disable auto zoom to prevent recalc
        updateSettings({ zoom: { ...zoomSettings, isAuto: false } });
    };

    const handleMaxDurationChange = (val: number) => {
        batchAction(() => updateSettings({ zoom: { ...zoomSettings, maxZoomDurationMs: val } }));
    };

    const handleMaxZoomChange = (val: number) => {
        batchAction(() => updateSettings({ zoom: { ...zoomSettings, maxZoom: val } }));
    };

    const handleEffectToggle = (key: keyof typeof effectSettings, value: boolean) => {
        updateSettings({ effects: { ...effectSettings, [key]: value } });
    };

    // Generate preview items for each section
    const zoomPreviewItems: PreviewItem[] = [
        { type: 'text', content: zoomSettings.isAuto ? 'Auto' : 'Manual' },
        { type: 'text', content: `${zoomSettings.maxZoom.toFixed(1)}x` }
    ];

    const spotlightPreviewItems: PreviewItem[] = [
        { type: 'text', content: `${Math.round(spotlightSettings.dimOpacity * 100)}% dim` },
        { type: 'text', content: `${spotlightSettings.enlargeScale.toFixed(2)}x` }
    ];

    return (
        <div className="flex flex-col gap-3 text-sm text-text-main">

            {/* ZOOM SETTINGS */}
            <CollapsibleCard
                title="Zoom"
                previewItems={zoomPreviewItems}
                isExpanded={showCollapsibleZoom}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleZoom', v)}
            >
                <div className="flex flex-col gap-4">
                    {/* Header with Auto Toggle */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <label className="text-sm text-text-muted">Auto</label>
                            {!hasUserEvents && (
                                <InfoTooltip description={autoDisabledTooltip} />
                            )}
                        </div>
                        <Toggle
                            value={zoomSettings.isAuto}
                            onChange={(isAuto) => {
                                updateSettings({ zoom: { ...zoomSettings, isAuto } });
                            }}
                            disabled={!hasUserEvents}
                        />
                    </div>

                    {/* Transition Duration */}
                    <Slider
                        label="Transition"
                        min={zoomSettings.minZoomDurationMs}
                        max={1500}
                        value={zoomSettings.maxZoomDurationMs}
                        onChange={handleMaxDurationChange}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        showTooltip
                        valueTransform={(ms) => ms / 1000}
                        units="s"
                        decimals={2}
                    />

                    {/* Max Zoom */}
                    <Slider
                        label="Max Zoom"
                        min={1.1}
                        max={6}
                        value={zoomSettings.maxZoom}
                        onChange={handleMaxZoomChange}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        showTooltip
                        units="x"
                        decimals={1}
                    />

                    {/* Actions - only show when there are zooms to clear */}
                    {zoomActions.length > 0 && (
                        <DefaultButton
                            onClick={handleClearZooms}
                            className="w-full"
                        >
                            Clear
                        </DefaultButton>
                    )}
                </div>
            </CollapsibleCard>

            {/* SPOTLIGHT SETTINGS */}
            <CollapsibleCard
                title="Spotlight"
                previewItems={spotlightPreviewItems}
                isExpanded={showCollapsibleSpotlight}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleSpotlight', v)}
            >
                <div className="flex flex-col gap-4">
                    {/* Auto Toggle */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <label className="text-sm text-text-muted">Auto</label>
                            {!hasUserEvents && (
                                <InfoTooltip description={autoDisabledTooltip} />
                            )}
                        </div>
                        <Toggle
                            value={spotlightSettings.isAuto}
                            onChange={(isAuto) => {
                                updateSettings({ spotlight: { ...spotlightSettings, isAuto } });
                            }}
                            disabled={!hasUserEvents}
                        />
                    </div>

                    {/* Dim Opacity */}
                    <Slider
                        label="Dim Opacity"
                        min={0}
                        max={1}
                        value={spotlightSettings.dimOpacity}
                        onChange={handleDimOpacityChange}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        showTooltip
                        valueTransform={(val) => val * 100}
                        units="%"
                        decimals={0}
                    />

                    {/* Enlarge Scale */}
                    <Slider
                        label="Enlarge Scale"
                        min={1.0}
                        max={1.5}
                        value={spotlightSettings.enlargeScale}
                        onChange={handleEnlargeScaleChange}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        showTooltip
                        units="x"
                        decimals={2}
                    />

                    {/* Transition Time */}
                    <Slider
                        label="Transition Time"
                        min={0}
                        max={1000}
                        value={spotlightSettings.transitionDurationMs}
                        onChange={handleTransitionDurationChange}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        showTooltip
                        valueTransform={(ms) => ms / 1000}
                        units="s"
                        decimals={2}
                    />
                </div>
            </CollapsibleCard>

            {/* EFFECT SETTINGS */}
            <CollapsibleCard
                title="Effects"
                isExpanded={showCollapsibleEffects}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleEffects', v)}
            >
                <div className="flex flex-col gap-4">
                    <Toggle
                        label="Mouse Clicks"
                        value={effectSettings.showMouseClicks}
                        onChange={(val) => handleEffectToggle('showMouseClicks', val)}
                    />

                    <Toggle
                        label="Mouse Drags"
                        value={effectSettings.showMouseDrags}
                        onChange={(val) => handleEffectToggle('showMouseDrags', val)}
                    />

                    <Toggle
                        label="Keyboard Clicks"
                        value={effectSettings.showKeyboardClicks}
                        onChange={(val) => handleEffectToggle('showKeyboardClicks', val)}
                    />
                </div>
            </CollapsibleCard>
        </div>
    );
};

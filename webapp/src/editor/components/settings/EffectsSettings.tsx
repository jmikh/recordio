
import { useProjectStore } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, Toggle, CollapsibleCard, DefaultButton, type PreviewItem } from '@shared/components';
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

    // no mouse positions is enough indicator
    const hasNoUserEvents = userEvents.mousePositions.length === 0

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
            {/* Disclaimer for missing user events */}
            {hasNoUserEvents && (
                <div className="text-xs text-text-main flex items-start gap-1">
                    <span>* Auto zoom and effects are only available for recordings of Chrome tabs and Chrome windows.</span>
                </div>
            )}

            {/* ZOOM SETTINGS */}
            <CollapsibleCard title="Zoom" previewItems={zoomPreviewItems} defaultExpanded>
                <div className="flex flex-col gap-4">
                    {/* Header with Auto/Manual Toggle */}
                    <div className="flex items-center justify-between">
                        <label className="text-sm text-text-muted">Auto</label>
                        <MultiToggle
                            value={zoomSettings.isAuto ? 'auto' : 'manual'}
                            onChange={(val: string) => {
                                const isAuto = val === 'auto';
                                updateSettings({ zoom: { ...zoomSettings, isAuto: isAuto } });
                            }}
                            options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'manual', label: 'Manual' }
                            ]}
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

                    {/* Actions */}
                    <DefaultButton
                        onClick={handleClearZooms}
                        disabled={zoomActions.length === 0}
                        className="w-full"
                    >
                        Clear
                    </DefaultButton>
                </div>
            </CollapsibleCard>

            {/* SPOTLIGHT SETTINGS */}
            <CollapsibleCard title="Spotlight" previewItems={spotlightPreviewItems}>
                <div className="flex flex-col gap-4">
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
            <CollapsibleCard title="Effects">
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

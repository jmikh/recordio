
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Toggle, CollapsibleCard, DefaultButton, InfoTooltip, Dropdown, type PreviewItem, type DropdownOption } from '@shared/components';
import type { EasingStyle } from '../../../core/easing';

// Easing dropdown options
const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];

// SVG easing curve paths (displayed in a 32x32 viewBox)
const EASING_CURVES: Record<EasingStyle, string> = {
    'linear': 'M 4 28 L 28 4',
    'ease-in': 'M 4 28 C 4 28 20 28 28 4',
    'ease-out': 'M 4 28 C 4 4 24 4 28 4',
    'ease-in-out': 'M 4 28 C 4 16 28 16 28 4',
};

const EASING_DESCRIPTIONS: Record<EasingStyle, string> = {
    'linear': 'Constant speed, no acceleration',
    'ease-in': 'Starts slow, accelerates',
    'ease-out': 'Starts fast, decelerates',
    'ease-in-out': 'Starts slow, speeds up, then slows down',
};

const EASING_LABELS: Record<EasingStyle, string> = {
    'linear': 'Linear',
    'ease-in': 'Ease In',
    'ease-out': 'Ease Out',
    'ease-in-out': 'Ease In Out',
};

/** Shared tooltip content for easing info */
const EasingTooltipContent = () => (
    <div className="flex flex-col gap-2 px-3 py-2">
        {(Object.keys(EASING_CURVES) as EasingStyle[]).map((style) => (
            <div key={style} className="flex items-center gap-2.5">
                <svg width="32" height="32" viewBox="0 0 32 32" className="flex-shrink-0">
                    {/* Axes */}
                    <line x1="4" y1="28" x2="28" y2="28" stroke="var(--text-disabled)" strokeWidth="1" />
                    <line x1="4" y1="28" x2="4" y2="4" stroke="var(--text-disabled)" strokeWidth="1" />
                    {/* Curve */}
                    <path d={EASING_CURVES[style]} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <div className="flex flex-col">
                    <span className="text-text-main text-xs font-medium">{EASING_LABELS[style]}</span>
                    <span className="text-text-muted text-[11px]">{EASING_DESCRIPTIONS[style]}</span>
                </div>
            </div>
        ))}
    </div>
);

export const FocusSettings = () => {
    const updateSettings = useProjectStore(s => s.updateSettings);
    const clearZoomActions = useProjectStore(s => s.clearZoomActions);
    const clearSpotlights = useProjectStore(s => s.clearSpotlights);
    const zoomSettings = useProjectStore(s => s.project.settings.zoom);
    const spotlightSettings = useProjectStore(s => s.project.settings.spotlight);
    const zoomActions = useProjectStore(s => s.project.timeline.zoomActions || []);
    const spotlightActions = useProjectStore(s => s.project.timeline.spotlightActions || []);
    const userEvents = useProjectStore(s => s.project.userEvents);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Check if user events exist (Chrome tab/window vs desktop)
    const hasUserEvents = userEvents.mousePositions.length > 0;

    // Collapsible visibility state
    const showCollapsibleZoom = useUIStore(s => s.showCollapsibleZoom);
    const showCollapsibleSpotlight = useUIStore(s => s.showCollapsibleSpotlight);
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
        clearZoomActions();
        updateSettings({ zoom: { ...zoomSettings, isAuto: false } });
    };

    const handleClearSpotlights = () => {
        clearSpotlights();
        updateSettings({ spotlight: { ...spotlightSettings, isAuto: false } });
    };

    const handleMaxDurationChange = (val: number) => {
        batchAction(() => updateSettings({ zoom: { ...zoomSettings, maxZoomDurationMs: val } }));
    };

    const handleMaxZoomChange = (val: number) => {
        batchAction(() => updateSettings({ zoom: { ...zoomSettings, maxZoom: val } }));
    };

    const handleZoomEasingChange = (easing: EasingStyle) => {
        updateSettings({ zoom: { ...zoomSettings, easing } });
    };

    const handleSpotlightEasingChange = (easing: EasingStyle) => {
        updateSettings({ spotlight: { ...spotlightSettings, easing } });
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

                    {/* Max Zoom - only shown in auto mode */}
                    {zoomSettings.isAuto && (
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
                    )}

                    {/* Easing */}
                    <div className="flex items-center gap-1.5">
                        <Dropdown
                            options={EASING_OPTIONS}
                            value={zoomSettings.easing ?? 'ease-in-out'}
                            onChange={handleZoomEasingChange}
                        />
                        <InfoTooltip description="">
                            <EasingTooltipContent />
                        </InfoTooltip>
                    </div>

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

                    {/* Easing */}
                    <div className="flex items-center gap-1.5">
                        <Dropdown
                            options={EASING_OPTIONS}
                            value={spotlightSettings.easing ?? 'ease-in-out'}
                            onChange={handleSpotlightEasingChange}
                        />
                        <InfoTooltip description="">
                            <EasingTooltipContent />
                        </InfoTooltip>
                    </div>

                    {/* Actions - only show when there are spotlights to clear */}
                    {spotlightActions.length > 0 && (
                        <DefaultButton
                            onClick={handleClearSpotlights}
                            className="w-full"
                        >
                            Clear
                        </DefaultButton>
                    )}
                </div>
            </CollapsibleCard>
        </div>
    );
};

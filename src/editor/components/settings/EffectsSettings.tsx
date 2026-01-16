
import { useProjectStore } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider } from '../../../components/ui/Slider';
import { MultiToggle } from '../../../components/ui/MultiToggle';
import { Toggle } from '../../../components/ui/Toggle';

export const EffectsSettings = () => {
    const updateSettings = useProjectStore(s => s.updateSettings);
    const clearViewportMotions = useProjectStore(s => s.clearViewportMotions);
    const zoomSettings = useProjectStore(s => s.project.settings.zoom);
    const effectSettings = useProjectStore(s => s.project.settings.effects);
    const viewportMotions = useProjectStore(s => s.project.timeline.recording.viewportMotions || []);
    const userEvents = useProjectStore(s => s.userEvents);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // no mouse positions is enough indicator
    const hasNoUserEvents = userEvents.mousePositions.length === 0

    const handleClearZooms = () => {
        // 1. Clear motions
        clearViewportMotions();
        // 2. Disable auto zoom to prevent recalc
        updateSettings({ zoom: { ...zoomSettings, autoZoom: false } });
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

    return (
        <div className="flex flex-col gap-6 text-sm text-text-main">
            {/* ZOOM SETTINGS */}
            {/* Disclaimer for missing user events */}
            {hasNoUserEvents && (
                <div className="text-xs text-text-muted font-thin flex items-start gap-1">
                    <span>* Auto zoom and effects are only available for recordings of Chrome tabs and Chrome windows.</span>
                </div>
            )}

            {/* Header with Title and Toggle */}
            <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Zoom</label>
                <MultiToggle
                    value={zoomSettings.autoZoom ? 'auto' : 'manual'}
                    onChange={(val: string) => {
                        const isAuto = val === 'auto';
                        updateSettings({ zoom: { ...zoomSettings, autoZoom: isAuto } });
                    }}
                    options={[
                        { value: 'auto', label: 'Auto' },
                        { value: 'manual', label: 'Manual' }
                    ]}
                />
            </div>

            {/* Transition Duration */}
            <div className="flex flex-col gap-2">
                <Slider
                    label="Transition Time"
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
            </div>

            {/* Max Zoom */}
            <div className="flex flex-col gap-2">
                <Slider
                    label="Max Zoom"
                    min={1.1}
                    max={3}
                    value={zoomSettings.maxZoom}
                    onChange={handleMaxZoomChange}
                    onPointerDown={startInteraction}
                    onPointerUp={endInteraction}
                    showTooltip
                    units="x"
                    decimals={1}
                />
            </div>

            {/* Actions */}
            <div className="pt-2">
                <button
                    onClick={handleClearZooms}
                    disabled={viewportMotions.length === 0}
                    className={`w-full py-2 px-4 rounded text-xs transition-colors border flex items-center justify-center gap-2
                        ${viewportMotions.length === 0
                            ? 'bg-surface text-text-main/40 border-transparent cursor-not-allowed' // Disabled state
                            : 'bg-surface hover:bg-surface-elevated text-text-highlighted border-border hover:border-text-muted/40'        // Active state (Neutral)
                        }
                    `}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                    </svg>
                    Clear All Zooms
                </button>
            </div>

            {/* SEPARATOR */}
            <div className="border-t border-border"></div>

            {/* EFFECT SETTINGS */}
            <div className="flex flex-col gap-4">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Effects</label>

                {/* Mouse Clicks */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-text-main">Mouse Clicks</span>
                    <Toggle
                        value={effectSettings.showMouseClicks}
                        onChange={(val) => handleEffectToggle('showMouseClicks', val)}
                    />
                </div>

                {/* Mouse Drags */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-text-main">Mouse Drags</span>
                    <Toggle
                        value={effectSettings.showMouseDrags}
                        onChange={(val) => handleEffectToggle('showMouseDrags', val)}
                    />
                </div>

                {/* Keyboard Clicks */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-text-main">Keyboard Clicks</span>
                    <Toggle
                        value={effectSettings.showKeyboardClicks}
                        onChange={(val) => handleEffectToggle('showKeyboardClicks', val)}
                    />
                </div>
            </div>
        </div>
    );
};

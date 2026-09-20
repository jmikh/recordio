
import React from 'react';
import { useProjectStore, useUserEvents } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, Toggle, CollapsibleCard, type PreviewItem } from '@shared/components';
import { HotkeyTooltip } from '../shared/MediaTooltips';
import { ColorButton } from './ColorButton';
import type { MouseClickEffectType, MouseSettings, KeyboardSettings } from '@shared/types/settings';
import { LuCommand, LuMousePointerClick, LuPlay } from 'react-icons/lu';
import { previewClickSound } from '../../audio/clickSoundPlayer';
import { PreviewEffectButton } from './PreviewEffectButton';

// Click effect toggle options
const CLICK_EFFECT_OPTIONS: { value: MouseClickEffectType; label: string; icon?: React.ReactNode }[] = [
    {
        value: 'ring',
        label: 'Ring',
        icon: (
            <svg width="14" height="14" viewBox="0 0 14 14">
                <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
        ),
    },
    {
        value: 'circle',
        label: 'Circle',
        icon: (
            <svg width="14" height="14" viewBox="0 0 14 14">
                <circle cx="7" cy="7" r="5.5" fill="currentColor" />
            </svg>
        ),
    },
];

// Hotkey placement options
const PLACEMENT_OPTIONS: { value: 'top' | 'bottom'; label: string }[] = [
    { value: 'top', label: 'Top' },
    { value: 'bottom', label: 'Bottom' },
];

export const EffectsSettings = () => {
    const updateSettings = useProjectStore(s => s.updateSettings);
    const mouseSettings = useProjectStore(s => s.project.settings.mouse) ?? {
        mouseClickEnabled: true,
        mouseDragEnabled: false,
        effectType: 'ring' as MouseClickEffectType,
        color: '#696969',
        size: 0.8,
        soundEnabled: true,
        soundVolume: 0.5,
        kClickRadiusPx: 80,
        kDragRadiusPx: 60,
    };
    const keyboardSettings = useProjectStore(s => s.project.settings.keyboard) ?? {
        showHotkeys: true,
        hotkeysSize: 1.0,
        hotkeysPlacement: 'top' as 'top' | 'bottom',
        hotkeysMargin: 4,
        kFontSizePx: 64,
        kPaddingXPx: 40,
        kPaddingYPx: 20,
        kCornerRadiusPx: 16,
    };
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();
    // Personal Settings defaults template: no timeline, so effects get a Preview button
    const templateMode = useProjectStore(s => s.templateMode);

    // Effects that have nothing to draw in this recording are shown off and locked.
    // The defaults template carries no recorded events, so its controls stay live.
    const userEvents = useUserEvents();
    const hasClicks = templateMode || userEvents.mouseClicks.length > 0;
    const hasHotkeys = templateMode || userEvents.keyboardEvents.length > 0;
    const soundOn = mouseSettings.soundEnabled && hasClicks;
    const clickEffectOn = mouseSettings.mouseClickEnabled && hasClicks;
    const hotkeysOn = (keyboardSettings.showHotkeys ?? true) && hasHotkeys;

    // Collapsible visibility state
    const showCollapsibleEffects = useUIStore(s => s.showCollapsibleEffects);
    const showCollapsibleMouse = useUIStore(s => s.showCollapsibleMouse);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    const handleMouseChange = (partial: Partial<MouseSettings>) => {
        batchAction(() => updateSettings({ mouse: { ...mouseSettings, ...partial } }));
    };

    const handleKeyboardChange = (partial: Partial<KeyboardSettings>) => {
        batchAction(() => updateSettings({ keyboard: { ...keyboardSettings, ...partial } }));
    };

    return (
        <div className="flex flex-col gap-3 text-sm text-text-main">

            {/* MOUSE SETTINGS */}
            <CollapsibleCard
                title="Mouse"
                icon={<LuMousePointerClick className="icon-md" />}
                previewItems={[
                    {
                        type: 'custom',
                        content: (
                            <div
                                className="w-4 h-4 rounded-full border border-border"
                                style={{ backgroundColor: mouseSettings.color }}
                            />
                        )
                    },
                    { type: 'text', content: mouseSettings.effectType === 'ring' ? 'Ring' : 'Circle' },
                    ...(soundOn ? [{ type: 'text' as const, content: 'Sound' }] : []),
                ]}
                isExpanded={showCollapsibleMouse}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleMouse', v)}
            >
                <div className="flex flex-col gap-4">
                    {/* No clicks recorded — both mouse effects have nothing to draw */}
                    {!hasClicks && (
                        <p className="text-label">No clicks detected in this recording</p>
                    )}

                    {/* Sound Toggle + Preview */}
                    <Toggle
                        label="Sound"
                        value={soundOn}
                        disabled={!hasClicks}
                        onChange={(val) => handleMouseChange({ soundEnabled: val })}
                    >
                        <button
                            className="flex items-center px-1 py-0.5 rounded text-text-muted hover:text-text-highlighted hover:bg-state-hover transition-colors cursor-pointer"
                            onClick={() => previewClickSound(mouseSettings.soundVolume ?? 0.5)}
                            title="Preview sound"
                        >
                            <LuPlay className="icon-sm" />
                        </button>
                    </Toggle>

                    {/* Volume (visible when sound enabled) */}
                    {soundOn && (
                        <div className="pl-1">
                            <Slider
                                label="Volume"
                                min={0}
                                max={1}
                                value={mouseSettings.soundVolume}
                                onChange={(val) => handleMouseChange({ soundVolume: val })}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                showTooltip
                                valueTransform={(val) => val * 100}
                                units="%"
                                decimals={0}
                            />
                        </div>
                    )}

                    {/* Click Effect Toggle (+ Preview on the defaults page) */}
                    <Toggle
                        label="Click Effect"
                        value={clickEffectOn}
                        disabled={!hasClicks}
                        onChange={(val) => handleMouseChange({ mouseClickEnabled: val })}
                    >
                        {templateMode && (
                            <PreviewEffectButton kind="click" label="Preview click effect" disabled={!clickEffectOn} />
                        )}
                    </Toggle>

                    {/* Effect Sub-Settings (visible when the click effect is enabled) */}
                    {clickEffectOn && (
                        <div className="flex flex-col gap-4 pl-1">
                            {/* Effect Type */}
                            <MultiToggle
                                options={CLICK_EFFECT_OPTIONS}
                                value={mouseSettings.effectType}
                                onChange={(val) => handleMouseChange({ effectType: val })}
                            />

                            {/* Color (ring and circle only) */}
                            <ColorButton
                                title="Color"
                                color={mouseSettings.color}
                                onChange={(color) => handleMouseChange({ color })}
                                onPopoverOpen={startInteraction}
                                onPopoverClose={endInteraction}
                                showAlpha
                            />


                            {/* Size */}
                            <Slider
                                label="Size"
                                min={0.5}
                                max={3}
                                value={mouseSettings.size}
                                onChange={(val) => handleMouseChange({ size: val })}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                showTooltip
                                units="×"
                                decimals={1}
                            />
                        </div>
                    )}
                </div>
            </CollapsibleCard>

            {/* KEYBOARD SETTINGS */}
            <CollapsibleCard
                title="Keyboard"
                icon={<LuCommand className="icon-md" />}
                previewItems={[
                    { type: 'text', content: hotkeysOn ? 'On' : 'Off' },
                    ...(hotkeysOn ? [
                        { type: 'text' as const, content: (keyboardSettings.hotkeysPlacement ?? 'top') === 'top' ? 'Top' : 'Bottom' },
                        { type: 'text' as const, content: `${(keyboardSettings.hotkeysSize ?? 1.0).toFixed(1)}×` },
                    ] : []),
                ]}
                isExpanded={showCollapsibleEffects}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleEffects', v)}
            >
                <div className="flex flex-col gap-4">
                    {/* No keystrokes recorded — the hotkey overlay has nothing to draw */}
                    {!hasHotkeys && (
                        <p className="text-label">No hotkeys detected in this recording</p>
                    )}

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <label className="text-label">Display Hotkeys</label>
                            <HotkeyTooltip />
                            {templateMode && (
                                <PreviewEffectButton kind="keyboard" label="Preview keyboard hotkeys" disabled={!hotkeysOn} />
                            )}
                        </div>
                        <Toggle
                            value={hotkeysOn}
                            disabled={!hasHotkeys}
                            onChange={(val) => handleKeyboardChange({ showHotkeys: val })}
                            aria-label="Display Hotkeys"
                        />
                    </div>

                    {/* Sub-settings (visible when hotkeys enabled) */}
                    {hotkeysOn && (
                        <div className="pl-1 flex flex-col gap-4">
                            <MultiToggle
                                options={PLACEMENT_OPTIONS}
                                value={keyboardSettings.hotkeysPlacement ?? 'top'}
                                onChange={(val) => handleKeyboardChange({ hotkeysPlacement: val })}
                            />
                            <Slider
                                label="Size"
                                min={0.5}
                                max={2}
                                value={keyboardSettings.hotkeysSize ?? 1.0}
                                onChange={(val) => handleKeyboardChange({ hotkeysSize: val })}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                showTooltip
                                units="×"
                                decimals={1}
                            />
                            <Slider
                                label="Margin"
                                min={0}
                                max={20}
                                value={keyboardSettings.hotkeysMargin}
                                onChange={(val) => handleKeyboardChange({ hotkeysMargin: val })}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                showTooltip
                                units="%"
                                decimals={0}
                            />
                        </div>
                    )}
                </div>
            </CollapsibleCard>
        </div>
    );
};


import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
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
                    ...(mouseSettings.soundEnabled ? [{ type: 'text' as const, content: 'Sound' }] : []),
                ]}
                isExpanded={showCollapsibleMouse}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleMouse', v)}
            >
                <div className="flex flex-col gap-4">
                    {/* Sound Toggle + Preview */}
                    <Toggle
                        label="Sound"
                        value={mouseSettings.soundEnabled}
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
                    {mouseSettings.soundEnabled && (
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
                        value={mouseSettings.mouseClickEnabled}
                        onChange={(val) => handleMouseChange({ mouseClickEnabled: val })}
                    >
                        {templateMode && (
                            <PreviewEffectButton kind="click" label="Preview click effect" disabled={!mouseSettings.mouseClickEnabled} />
                        )}
                    </Toggle>

                    {/* Effect Sub-Settings (visible when the click effect is enabled) */}
                    {mouseSettings.mouseClickEnabled && (
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
                    { type: 'text', content: (keyboardSettings.showHotkeys ?? true) ? 'On' : 'Off' },
                    ...((keyboardSettings.showHotkeys ?? true) ? [
                        { type: 'text' as const, content: (keyboardSettings.hotkeysPlacement ?? 'top') === 'top' ? 'Top' : 'Bottom' },
                        { type: 'text' as const, content: `${(keyboardSettings.hotkeysSize ?? 1.0).toFixed(1)}×` },
                    ] : []),
                ]}
                isExpanded={showCollapsibleEffects}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleEffects', v)}
            >
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <label className="text-label">Hotkeys Enabled</label>
                            <HotkeyTooltip />
                            {templateMode && (
                                <PreviewEffectButton kind="keyboard" label="Preview keyboard hotkeys" disabled={!(keyboardSettings.showHotkeys ?? true)} />
                            )}
                        </div>
                        <Toggle
                            value={keyboardSettings.showHotkeys ?? true}
                            onChange={(val) => handleKeyboardChange({ showHotkeys: val })}
                        />
                    </div>

                    {/* Sub-settings (visible when hotkeys enabled) */}
                    {(keyboardSettings.showHotkeys ?? true) && (
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

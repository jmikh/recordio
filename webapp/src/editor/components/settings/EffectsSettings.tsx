
import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, Toggle, CollapsibleCard, InfoTooltip, type PreviewItem } from '@shared/components';
import { ColorButton } from './ColorButton';
import type { MouseClickEffectType, MouseSettings, KeyboardSettings } from '../../../types/settings';
import { TbPlayerPlay } from 'react-icons/tb';
import { previewClickSound } from '../../../core/audio/clickSoundPlayer';

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
        mouseDragEnabled: true,
        effectType: 'ring' as MouseClickEffectType,
        color: '#667eea',
        size: 1.0,
        soundEnabled: false,
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
                            <TbPlayerPlay size={13} />
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

                    {/* Click Effect Toggle */}
                    <Toggle
                        label="Click Effect"
                        value={mouseSettings.mouseClickEnabled}
                        onChange={(val) => handleMouseChange({ mouseClickEnabled: val })}
                    />

                    {/* Drag Effect Toggle */}
                    <Toggle
                        label="Drag Effect"
                        value={mouseSettings.mouseDragEnabled}
                        onChange={(val) => handleMouseChange({ mouseDragEnabled: val })}
                    />

                    {/* Shared Effect Sub-Settings (visible when either click or drag is enabled) */}
                    {(mouseSettings.mouseClickEnabled || mouseSettings.mouseDragEnabled) && (
                        <div className="flex flex-col gap-4 pl-1">
                            {/* Effect Type */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-sm text-text-muted">Effect</label>
                                <MultiToggle
                                    options={CLICK_EFFECT_OPTIONS}
                                    value={mouseSettings.effectType}
                                    onChange={(val) => handleMouseChange({ effectType: val })}
                                />
                            </div>

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
                            <label className="text-sm text-text-muted">Hotkeys</label>
                            <InfoTooltip
                                description="Shows keyboard shortcuts as an overlay during playback."
                                imageSrc="/assets/images/hotkey-demo.png"
                            />
                        </div>
                        <Toggle
                            value={keyboardSettings.showHotkeys ?? true}
                            onChange={(val) => handleKeyboardChange({ showHotkeys: val })}
                        />
                    </div>

                    {/* Sub-settings (visible when hotkeys enabled) */}
                    {(keyboardSettings.showHotkeys ?? true) && (
                        <div className="pl-1 flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-sm text-text-muted">Placement</label>
                                <MultiToggle
                                    options={PLACEMENT_OPTIONS}
                                    value={keyboardSettings.hotkeysPlacement ?? 'top'}
                                    onChange={(val) => handleKeyboardChange({ hotkeysPlacement: val })}
                                />
                            </div>
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

import React, { useRef, useState } from 'react';
import { HexColorPicker } from "react-colorful";
import { useClickOutside } from '../../hooks/useClickOutside';
import { createPortal } from 'react-dom';
import { Slider } from '../common/Slider';

export interface StyleSettings {
    borderRadius: number;
    borderWidth: number;
    borderColor: string;
    hasShadow: boolean;
    hasGlow: boolean;
}

interface StyleControlsProps {
    settings: StyleSettings;
    onChange: (updates: Partial<StyleSettings>) => void;
    showRadius?: boolean;
    onColorPopoverOpen?: () => void;
    onColorPopoverClose?: () => void;
    onInteractionStart?: () => void;
    onInteractionEnd?: () => void;
}

export const StyleControls: React.FC<StyleControlsProps> = ({
    settings,
    onChange,
    showRadius = true,
    onColorPopoverOpen,
    onColorPopoverClose,
    onInteractionStart,
    onInteractionEnd
}) => {
    const {
        borderRadius,
        borderWidth,
        borderColor,
        hasShadow,
        hasGlow
    } = settings;

    const [showColorPopover, setShowColorPopover] = useState(false);
    const colorButtonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    useClickOutside(popoverRef, () => {
        if (showColorPopover) {
            setShowColorPopover(false);
            onColorPopoverClose?.();
        }
    });

    const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

    const toggleColorPopover = () => {
        if (!showColorPopover) {
            if (colorButtonRef.current) {
                const rect = colorButtonRef.current.getBoundingClientRect();
                // Position to the left of the button by default (since panel is on right)
                setPopoverPos({
                    top: rect.top,
                    left: rect.left - 220
                });
            }
            onColorPopoverOpen?.();
        } else {
            onColorPopoverClose?.();
        }
        setShowColorPopover(!showColorPopover);
    };

    return (
        <div className="space-y-6">
            {/* Style (Border & Rounding) */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Style</label>
                    <div className="flex items-center gap-2">
                        {/* Color Picker Button */}
                        <button
                            ref={colorButtonRef}
                            onClick={toggleColorPopover}
                            className="w-5 h-5 rounded-full border border-gray-600 shadow-sm flex items-center justify-center transition-all hover:scale-105"
                            style={{ backgroundColor: borderColor }}
                            title="Border & Dynamic Effect Color"
                        >
                        </button>
                    </div>
                </div>

                {/* Color Popover */}
                {showColorPopover && createPortal(
                    <div
                        ref={popoverRef}
                        className="fixed z-[9999] p-4 bg-surface-elevated rounded-lg border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-100"
                        style={{
                            top: popoverPos.top,
                            left: popoverPos.left,
                            width: '200px'
                        }}
                    >
                        <div className="space-y-3">
                            <div className="text-[10px] text-text-muted uppercase font-semibold">Effect Color</div>
                            <HexColorPicker
                                color={borderColor}
                                onChange={(c) => onChange({ borderColor: c })}
                                style={{ width: '100%', height: '150px' }}
                            />
                            <div className="flex bg-surface border border-border rounded px-2 py-1.5 items-center gap-2">
                                <span className="text-text-muted select-none">#</span>
                                <input
                                    type="text"
                                    value={borderColor.replace('#', '')}
                                    onChange={(e) => onChange({ borderColor: '#' + e.target.value })}
                                    className="bg-transparent border-none outline-none text-xs font-mono text-text-main w-full uppercase"
                                    maxLength={6}
                                />
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {/* Rounding Slider */}
                {showRadius && (
                    <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Rounding</span>
                            <span className="font-mono text-[10px]">{borderRadius}px</span>
                        </div>
                        <Slider
                            min={0}
                            max={200}
                            value={borderRadius}
                            onPointerDown={onInteractionStart}
                            onPointerUp={onInteractionEnd}
                            onChange={(val) => onChange({ borderRadius: val })}
                        />
                    </div>
                )}

                {/* Border Width Slider */}
                <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-gray-400">
                        <span>Border Thickness</span>
                        <span className="font-mono text-[10px]">{borderWidth}px</span>
                    </div>
                    <Slider
                        min={0}
                        max={20}
                        value={borderWidth}
                        onPointerDown={onInteractionStart}
                        onPointerUp={onInteractionEnd}
                        onChange={(val) => onChange({ borderWidth: val })}
                    />
                </div>
            </div>

            {/* Effects Toggle */}
            <div className="space-y-3 pt-4 border-t border-border">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">Effects</label>

                <div className="flex bg-surface p-1 rounded-lg">
                    <button
                        onClick={() => onChange({ hasShadow: true, hasGlow: false })}
                        className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${hasShadow
                            ? 'bg-surface-elevated text-text-main shadow'
                            : 'text-text-muted hover:text-text-main'
                            }`}
                    >
                        Shadow
                    </button>
                    <button
                        onClick={() => onChange({ hasShadow: false, hasGlow: false })}
                        className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${!hasShadow && !hasGlow
                            ? 'bg-surface-elevated text-text-main shadow'
                            : 'text-text-muted hover:text-text-main'
                            }`}
                    >
                        None
                    </button>
                    <button
                        onClick={() => onChange({ hasShadow: false, hasGlow: true })}
                        className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${hasGlow
                            ? 'bg-surface-elevated text-text-main shadow'
                            : 'text-text-muted hover:text-text-main'
                            }`}
                    >
                        Glow
                    </button>
                </div>
            </div>
        </div>
    );
};

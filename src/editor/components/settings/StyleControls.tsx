import React, { useRef, useState } from 'react';
import { HexColorPicker } from "react-colorful";
import { useClickOutside } from '../../hooks/useClickOutside';
import { createPortal } from 'react-dom';

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
}

export const StyleControls: React.FC<StyleControlsProps> = ({
    settings,
    onChange,
    showRadius = true
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
        if (showColorPopover) setShowColorPopover(false);
    });

    const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

    const toggleColorPopover = () => {
        if (!showColorPopover && colorButtonRef.current) {
            const rect = colorButtonRef.current.getBoundingClientRect();
            // Position to the left of the button by default (since panel is on right)
            setPopoverPos({
                top: rect.top,
                left: rect.left - 220
            });
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
                        className="fixed z-[9999] p-4 bg-[#252525] rounded-lg border border-gray-700/50 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
                        style={{
                            top: popoverPos.top,
                            left: popoverPos.left,
                            width: '200px'
                        }}
                    >
                        <div className="space-y-3">
                            <div className="text-[10px] text-gray-500 uppercase font-semibold">Effect Color</div>
                            <HexColorPicker
                                color={borderColor}
                                onChange={(c) => onChange({ borderColor: c })}
                                style={{ width: '100%', height: '150px' }}
                            />
                            <div className="flex bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 items-center gap-2">
                                <span className="text-gray-500 select-none">#</span>
                                <input
                                    type="text"
                                    value={borderColor.replace('#', '')}
                                    onChange={(e) => onChange({ borderColor: '#' + e.target.value })}
                                    className="bg-transparent border-none outline-none text-xs font-mono text-gray-200 w-full uppercase"
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
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={borderRadius}
                            onChange={(e) => onChange({ borderRadius: parseInt(e.target.value) })}
                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-colors"
                        />
                    </div>
                )}

                {/* Border Width Slider */}
                <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-gray-400">
                        <span>Border Thickness</span>
                        <span className="font-mono text-[10px]">{borderWidth}px</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="20"
                        value={borderWidth}
                        onChange={(e) => onChange({ borderWidth: parseInt(e.target.value) })}
                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-colors"
                    />
                </div>
            </div>

            {/* Effects Toggle */}
            <div className="space-y-3 pt-4 border-t border-gray-700">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Effects</label>

                <div className="flex bg-[#1a1a1a] p-1 rounded-lg">
                    <button
                        onClick={() => onChange({ hasShadow: true, hasGlow: false })}
                        className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${hasShadow
                            ? 'bg-gray-600 text-white shadow'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        Shadow
                    </button>
                    <button
                        onClick={() => onChange({ hasShadow: false, hasGlow: false })}
                        className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${!hasShadow && !hasGlow
                            ? 'bg-gray-600 text-white shadow'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        None
                    </button>
                    <button
                        onClick={() => onChange({ hasShadow: false, hasGlow: true })}
                        className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${hasGlow
                            ? 'bg-gray-600 text-white shadow'
                            : 'text-gray-400 hover:text-gray-200'
                            }`}
                    >
                        Glow
                    </button>
                </div>
            </div>
        </div>
    );
};

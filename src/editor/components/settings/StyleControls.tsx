import React, { useRef, useState } from 'react';
import { HexColorPicker } from "react-colorful";
import { useClickOutside } from '../../hooks/useClickOutside';
import { createPortal } from 'react-dom';
import { Slider } from '../../../components/ui/Slider';
import { MultiToggle } from '../../../components/ui/MultiToggle';

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
                // Position to the right of the button
                setPopoverPos({
                    top: rect.top,
                    left: rect.right + 8 // 8px spacing from button
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
                {/* Color Picker Button */}
                {/* Color Picker Button & Hex Display */}
                <div
                    ref={colorButtonRef as any}
                    onClick={toggleColorPopover}
                    className="flex items-center gap-3 p-2 bg-transparent border border-border rounded-lg cursor-pointer hover:border-gray-500 transition-colors group"
                    title="Border & Dynamic Effect Color"
                >
                    <div
                        className="w-6 h-6 rounded-full border border-gray-600 shadow-sm"
                        style={{ backgroundColor: borderColor }}
                    />
                    <span className="text-xs font-mono text-gray-400 group-hover:text-gray-200 transition-colors uppercase">
                        {borderColor}
                    </span>
                </div>

                {/* Color Popover */}
                {showColorPopover && createPortal(
                    <div
                        ref={popoverRef}
                        className="fixed z-[9999] p-4 bg-surface-overlay rounded-lg border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-100"
                        style={{
                            top: popoverPos.top,
                            left: popoverPos.left,
                            width: '200px'
                        }}
                    >
                        <div className="space-y-3">
                            <div className="text-[10px] text-text-muted uppercase font-semibold"></div>
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
                {/* Rounding Slider */}
                <Slider
                    label="Rounding"
                    min={0}
                    max={200}
                    value={borderRadius}
                    onPointerDown={onInteractionStart}
                    onPointerUp={onInteractionEnd}
                    onChange={(val) => onChange({ borderRadius: val })}
                    disabled={!showRadius}
                    showTooltip
                    units="px"
                    className={!showRadius ? 'opacity-50' : ''}
                />

                {/* Border Width Slider */}
                {/* Border Width Slider */}
                <Slider
                    label="Thickness"
                    min={0}
                    max={20}
                    value={borderWidth}
                    onPointerDown={onInteractionStart}
                    onPointerUp={onInteractionEnd}
                    onChange={(val) => onChange({ borderWidth: val })}
                    showTooltip
                    units="px"
                />
            </div>


            <MultiToggle
                options={[
                    { value: 'shadow', label: 'Shadow' },
                    { value: 'none', label: 'None' },
                    { value: 'glow', label: 'Glow' }
                ]}
                value={hasShadow ? 'shadow' : hasGlow ? 'glow' : 'none'}
                onChange={(val) => {
                    if (val === 'shadow') onChange({ hasShadow: true, hasGlow: false });
                    else if (val === 'glow') onChange({ hasShadow: false, hasGlow: true });
                    else onChange({ hasShadow: false, hasGlow: false });
                }}
            />
        </div>
    );
};

import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ColorSettings } from './ColorSettings';
import { Button } from '@shared/components';
import type { HistoryBatcher } from '../../hooks/useHistoryBatcher';

/** Adds a Solid/Gradient toggle to the popover; the swatch previews the gradient while it's active. */
export interface ColorButtonGradient {
    /** Gradient mode is on (otherwise the solid `color` is) */
    active: boolean;
    colors: [string, string];
    /** Gradient angle in degrees (CSS convention: 0 = up, 90 = right) */
    direction: number;
    onModeChange: (mode: 'solid' | 'gradient') => void;
    onColorChange: (index: 0 | 1, color: string) => void;
    onDirectionChange: (direction: number) => void;
}

interface ColorButtonProps {
    /** Current color value (hex format) */
    color: string;
    /** Called when the color changes */
    onChange: (color: string) => void;
    /** Called when the color popover opens */
    onPopoverOpen?: () => void;
    /** Called when the color popover closes */
    onPopoverClose?: () => void;
    /** Title displayed inside the left half of the button */
    title: string;
    /** If true, shows an opacity/alpha slider on the color picker */
    showAlpha?: boolean;
    /** Solid-only when omitted */
    gradient?: ColorButtonGradient;
    /** History batcher for the gradient direction dial; default: the video editor's */
    batcher?: HistoryBatcher;
}

export const ColorButton: React.FC<ColorButtonProps> = ({
    color,
    onChange,
    onPopoverOpen,
    onPopoverClose,
    title,
    showAlpha,
    gradient,
    batcher
}) => {
    const [showColorPopover, setShowColorPopover] = useState(false);
    const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const toggleColorPopover = () => {
        if (!showColorPopover) {
            onPopoverOpen?.();
        } else {
            onPopoverClose?.();
        }
        setShowColorPopover(!showColorPopover);
    };

    // Position the popover once it's mounted: prefer the right side of the
    // button, flip to the left when there's no room (e.g. the screenshot
    // editor's inspector sits on the right edge), and keep it inside the
    // viewport vertically.
    useLayoutEffect(() => {
        if (!showColorPopover) return;
        const button = buttonRef.current;
        const popover = popoverRef.current;
        if (!button || !popover) return;

        const rect = button.getBoundingClientRect();
        // offset* ignores the entry animation's scale transform
        const width = popover.offsetWidth;
        const height = popover.offsetHeight;
        const margin = 8;

        const fitsRight = rect.right + margin + width <= window.innerWidth;
        const left = fitsRight
            ? rect.right + margin
            : Math.max(margin, rect.left - margin - width);

        const maxTop = Math.max(margin, window.innerHeight - height - margin);
        const top = Math.min(Math.max(margin, rect.top), maxTop);

        setPopoverPos({ top, left });
    }, [showColorPopover, gradient?.active]);

    // Close popover when clicking outside
    useEffect(() => {
        if (!showColorPopover) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(e.target as Node) &&
                !buttonRef.current?.contains(e.target as Node)
            ) {
                setShowColorPopover(false);
                onPopoverClose?.();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showColorPopover, onPopoverClose]);

    const swatch = gradient?.active
        ? `linear-gradient(${gradient.direction}deg, ${gradient.colors[0]}, ${gradient.colors[1]})`
        : `linear-gradient(${color}, ${color})`;

    return (
        <div className="flex items-center gap-3">
            <span className="text-label w-[80px] shrink-0">{title}</span>
            <div className="flex-1 min-w-0">
                <Button
                    ref={buttonRef}
                    onClick={toggleColorPopover}
                    fullWidth
                    className="justify-start gap-3 px-2"
                >
                    <div
                        className="w-5 h-5 rounded-full border border-text-muted shrink-0"
                        style={{
                            backgroundImage: `${swatch}, repeating-conic-gradient(#d0d0d0 0% 25%, #fff 0% 50%)`,
                            backgroundSize: '100% 100%, 6px 6px'
                        }}
                    />
                    <span className="text-xs font-mono text-text-muted uppercase">
                        {gradient?.active ? 'Gradient' : color}
                    </span>
                </Button>
            </div>

            {showColorPopover && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] bg-surface-raised rounded-lg border border-border shadow-2xl"
                    style={{
                        top: popoverPos.top,
                        left: popoverPos.left,
                        width: '240px'
                    }}
                >
                    <ColorSettings
                        isSolid={!gradient?.active}
                        isGradient={!!gradient?.active}
                        color={color}
                        gradient={gradient && { colors: gradient.colors, direction: gradient.direction }}
                        onTypeChange={gradient?.onModeChange ?? (() => { })}
                        onColorChange={onChange}
                        onGradientColorChange={gradient?.onColorChange ?? (() => { })}
                        onDirectionChange={gradient?.onDirectionChange ?? (() => { })}
                        solidOnly={!gradient}
                        showAlpha={showAlpha}
                        batcher={batcher}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};

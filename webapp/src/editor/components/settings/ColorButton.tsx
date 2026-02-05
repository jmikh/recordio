import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ColorSettings } from './ColorSettings';

interface ColorButtonProps {
    /** Current color value (hex format) */
    color: string;
    /** Called when the color changes */
    onChange: (color: string) => void;
    /** Called when the color popover opens */
    onPopoverOpen?: () => void;
    /** Called when the color popover closes */
    onPopoverClose?: () => void;
    /** Optional label displayed above the button */
    label?: string;
}

export const ColorButton: React.FC<ColorButtonProps> = ({
    color,
    onChange,
    onPopoverOpen,
    onPopoverClose,
    label
}) => {
    const [showColorPopover, setShowColorPopover] = useState(false);
    const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
    const buttonRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const toggleColorPopover = () => {
        if (!showColorPopover) {
            if (buttonRef.current) {
                const rect = buttonRef.current.getBoundingClientRect();
                setPopoverPos({
                    top: rect.top,
                    left: rect.right + 8
                });
            }
            onPopoverOpen?.();
        } else {
            onPopoverClose?.();
        }
        setShowColorPopover(!showColorPopover);
    };

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

    return (
        <div className="flex flex-col gap-1.5">
            {label && (
                <label className="text-sm text-text-muted">{label}</label>
            )}
            <div
                ref={buttonRef}
                onClick={toggleColorPopover}
                className="flex items-center gap-3 p-2 bg-transparent border border-border rounded-lg cursor-pointer hover:border-border-hover transition-colors group"
                title="Select color"
            >
                <div
                    className="w-6 h-6 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                />
                <span className="text-xs font-mono text-text-muted group-hover:text-text-main transition-colors uppercase">
                    {color}
                </span>
            </div>

            {showColorPopover && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] bg-surface-overlay rounded-lg border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-100"
                    style={{
                        top: popoverPos.top,
                        left: popoverPos.left,
                        width: '240px'
                    }}
                >
                    <ColorSettings
                        isSolid={true}
                        isGradient={false}
                        color={color}
                        onTypeChange={() => { }}
                        onColorChange={onChange}
                        onGradientColorChange={() => { }}
                        onDirectionChange={() => { }}
                        solidOnly={true}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};

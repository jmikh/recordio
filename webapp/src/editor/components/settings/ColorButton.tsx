import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ColorSettings } from './ColorSettings';
import { Button } from '@shared/components';



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
}

export const ColorButton: React.FC<ColorButtonProps> = ({
    color,
    onChange,
    onPopoverOpen,
    onPopoverClose,
    title,
    showAlpha
}) => {
    const [showColorPopover, setShowColorPopover] = useState(false);
    const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);
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
        <div className="flex items-center gap-3">
            <span className="text-sm text-text-muted w-[80px] shrink-0">{title}</span>
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
                            backgroundImage: `linear-gradient(${color}, ${color}), repeating-conic-gradient(#d0d0d0 0% 25%, #fff 0% 50%)`,
                            backgroundSize: '100% 100%, 6px 6px'
                        }}
                    />
                    <span className="text-xs font-mono text-text-muted uppercase">
                        {color}
                    </span>
                </Button>
            </div>

            {showColorPopover && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] bg-surface-raised rounded-lg border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-100"
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
                        showAlpha={showAlpha}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};

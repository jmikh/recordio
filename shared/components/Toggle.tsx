import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MdInfoOutline } from 'react-icons/md';

interface ToggleProps {
    value: boolean;
    onChange: (value: boolean) => void;
    /** Optional label displayed to the left of the toggle */
    label?: string;
    /** Optional explanation shown in a tooltip when hovering the info icon next to the label */
    labelExplanation?: string;
    className?: string;
    disabled?: boolean;
}

const ANIMATION_DURATION = '200ms';
const ANIMATION_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

export const Toggle: React.FC<ToggleProps> = ({
    value,
    onChange,
    label,
    labelExplanation,
    className = '',
    disabled = false
}) => {
    // Tooltip state for info icon
    const infoIconRef = useRef<HTMLSpanElement>(null);
    const [showTooltip, setShowTooltip] = useState(false);
    const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });

    const handleClick = () => {
        if (!disabled) {
            onChange(!value);
        }
    };

    const transitionStyle = {
        transitionDuration: ANIMATION_DURATION,
        transitionTimingFunction: ANIMATION_EASE,
        transitionProperty: 'all'
    };

    const toggleButton = (
        <button
            onClick={handleClick}
            disabled={disabled}
            className={`
                relative inline-flex items-center
                w-10 h-5
                rounded-full
                shadow-sm
                border border-border
                cursor-pointer
                transition-colors
                group
                disabled:opacity-50 disabled:cursor-not-allowed
                ${value ? 'bg-primary' : 'bg-surface-inset'}
                ${!label ? className : ''}
            `}
            role="switch"
            aria-checked={value}
        >
            {/* Sliding Knob */}
            <div
                style={transitionStyle}
                className={`
                    absolute
                    w-4 h-4
                    rounded-full
                    shadow-sm
                    transition-transform
                    group-hover:scale-110
                    ${value ? 'left-[calc(100%-1.25rem)]' : 'left-1'}
                    ${value ? 'bg-text-highlighted' : 'bg-text-main'}
                `}
            />
        </button>
    );

    // If label is provided, wrap in a flex container
    if (label) {
        return (
            <>
                <div className={`flex items-center justify-between ${className}`}>
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm text-text-muted">{label}</span>
                        {labelExplanation && (
                            <span
                                ref={infoIconRef}
                                className="flex items-center justify-center cursor-pointer"
                                onMouseEnter={() => {
                                    if (infoIconRef.current) {
                                        const rect = infoIconRef.current.getBoundingClientRect();
                                        setTooltipPosition({
                                            left: rect.left + rect.width / 2,
                                            top: rect.bottom + 8
                                        });
                                    }
                                    setShowTooltip(true);
                                }}
                                onMouseLeave={() => setShowTooltip(false)}
                            >
                                <MdInfoOutline size={14} className="text-text-muted hover:text-text-highlighted transition-colors" />
                            </span>
                        )}
                    </div>
                    {toggleButton}
                </div>

                {/* Tooltip - rendered via portal */}
                {showTooltip && labelExplanation && createPortal(
                    <div
                        className="fixed z-[999999] bg-surface-overlay border border-border rounded-md shadow-float px-3 py-2 max-w-[240px] text-xs text-text-main"
                        style={{
                            left: tooltipPosition.left,
                            top: tooltipPosition.top,
                            transform: 'translateX(-50%)'
                        }}
                        onMouseEnter={() => setShowTooltip(true)}
                        onMouseLeave={() => setShowTooltip(false)}
                    >
                        {labelExplanation}
                    </div>,
                    document.body
                )}
            </>
        );
    }

    return toggleButton;
};

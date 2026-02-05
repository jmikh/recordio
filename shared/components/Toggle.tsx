import React, { type ReactNode } from 'react';

interface ToggleProps {
    value: boolean;
    onChange: (value: boolean) => void;
    /** Optional label displayed to the left of the toggle */
    label?: string;
    /** Optional content to render next to the label (e.g., info icon with tooltip) */
    children?: ReactNode;
    className?: string;
    disabled?: boolean;
}

const ANIMATION_DURATION = '200ms';
const ANIMATION_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

export const Toggle: React.FC<ToggleProps> = ({
    value,
    onChange,
    label,
    children,
    className = '',
    disabled = false
}) => {
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
                ${value ? 'bg-primary' : 'bg-state-inactive'}
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
            <div className={`flex items-center justify-between ${className}`}>
                <div className="flex items-center gap-1.5">
                    <span className="text-sm text-text-muted">{label}</span>
                    {children}
                </div>
                {toggleButton}
            </div>
        );
    }

    return toggleButton;
};

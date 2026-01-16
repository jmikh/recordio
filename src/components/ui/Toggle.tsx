import React from 'react';

interface ToggleProps {
    value: boolean;
    onChange: (value: boolean) => void;
    className?: string;
    disabled?: boolean;
}

const ANIMATION_DURATION = '200ms';
const ANIMATION_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

export const Toggle: React.FC<ToggleProps> = ({
    value,
    onChange,
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

    return (
        <button
            onClick={handleClick}
            disabled={disabled}
            className={`
                relative inline-flex items-center
                w-10 h-5
                bg-hover-subtle
                rounded-full
                shadow-sm
                border border-border
                cursor-pointer
                transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
                ${value ? 'bg-primary border hover:bg-primary-highlighted border-primary' : 'hover:bg-hover hover:border-border-hover'}
                ${className}
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
                    ${value ? 'left-[calc(100%-1.25rem)]' : 'left-1'}
                    ${value ? 'bg-text-highlighted' : 'bg-text-main'}
                        `}
            />
        </button>
    );
};

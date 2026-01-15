import React from 'react';

export interface MultiToggleOption<T extends string> {
    value: T;
    label?: string;
    icon?: React.ReactNode;
}

interface MultiToggleProps<T extends string> {
    options: MultiToggleOption<T>[];
    value: T;
    onChange: (value: T) => void;
    className?: string;
}

const ANIMATION_DURATION = '500ms';
const ANIMATION_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

export const MultiToggle = <T extends string>({
    options,
    value,
    onChange,
    className = ''
}: MultiToggleProps<T>) => {
    const selectedIndex = options.findIndex(opt => opt.value === value);
    const count = options.length;

    // Transition styles matching the SettingsButton
    const transitionStyle = {
        transitionDuration: ANIMATION_DURATION,
        transitionTimingFunction: ANIMATION_EASE,
        transitionProperty: 'all'
    };

    return (
        <div
            className={`
                relative flex items-center bg-hover-subtle border border-border rounded-lg select-none overflow-hidden hover:border-border-hover
                ${className}
            `}
        >
            {/* Sliding Background Pill */}
            <div
                style={{
                    ...transitionStyle,
                    width: `${100 / count}%`,
                    left: `${(selectedIndex === -1 ? 0 : selectedIndex) * (100 / count)}%`
                }}
                className="absolute inset-y-0 bg-primary/20 border border-primary z-0 rounded-lg"
            />

            {/* Options */}
            {options.map((option) => {
                const isSelected = option.value === value;
                return (
                    <button
                        key={option.value}
                        onClick={() => onChange(option.value)}
                        className={`
                            relative flex-1 flex flex-col items-center justify-center gap-1.5 py-2 px-4 min-w-0 rounded-lg
                            text-xs z-10 outline-none
                            text-center
                            transition-colors duration-200
                            ${isSelected
                                ? 'text-text-main'
                                : 'text-text-muted hover:text-text-main'
                            }
                        `}
                    >
                        {option.icon && (
                            <span className={`flex items-center justify-center text-current`}>
                                {option.icon}
                            </span>
                        )}
                        {option.label && (
                            <span>{option.label}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

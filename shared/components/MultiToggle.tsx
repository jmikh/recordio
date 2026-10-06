import React, { useRef, useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';

export interface MultiToggleOption<T extends string> {
    value: T;
    label?: string;
    icon?: React.ReactNode;
    tooltip?: string;
    /** Accessible name — required when the option is icon-only */
    ariaLabel?: string;
    disabled?: boolean;
}

interface MultiToggleProps<T extends string> {
    options: MultiToggleOption<T>[];
    value: T;
    onChange: (value: T) => void;
    className?: string;
}

const ANIMATION_DURATION = '300ms';
const ANIMATION_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

export const MultiToggle = <T extends string>({
    options,
    value,
    onChange,
    className = ''
}: MultiToggleProps<T>) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

    // Update indicator position when value changes
    useEffect(() => {
        if (!containerRef.current) return;
        const selectedButton = containerRef.current.querySelector(`[data-value="${value}"]`) as HTMLElement;
        if (selectedButton) {
            const containerRect = containerRef.current.getBoundingClientRect();
            const buttonRect = selectedButton.getBoundingClientRect();
            setIndicatorStyle({
                left: buttonRect.left - containerRect.left,
                width: buttonRect.width,
            });
        }
    }, [value, options]);

    // Transition styles for the indicator
    const indicatorTransition = {
        transitionDuration: ANIMATION_DURATION,
        transitionTimingFunction: ANIMATION_EASE,
        transitionProperty: 'left, width'
    };

    return (
        <div
            ref={containerRef}
            className={`
                relative flex items-center justify-center select-none
                bg-surface-inset border border-border rounded-full p-1 h-9
                ${className}
            `}
        >
            {/* Sliding Pill Indicator */}
            <div
                style={{
                    ...indicatorTransition,
                    left: indicatorStyle.left,
                    width: indicatorStyle.width,
                    top: 3,
                    bottom: 3,
                }}
                className="absolute bg-primary/30 rounded-full z-0"
            />

            {/* Options */}
            {options.map((option) => {
                const isSelected = option.value === value;
                return (
                    <Tooltip key={option.value} text={option.tooltip ?? ''} className="flex-1 min-w-0">
                        <button
                            data-value={option.value}
                            aria-label={option.ariaLabel}
                            aria-pressed={isSelected}
                            disabled={option.disabled}
                            onClick={() => onChange(option.value)}
                            className={`
                                relative flex-1 flex flex-row items-center justify-center gap-1.5 py-1 px-3 min-w-0
                                text-sm z-10 outline-none cursor-pointer
                                text-center
                                transition-colors duration-200
                                disabled:opacity-50 disabled:cursor-default
                                ${isSelected
                                    ? 'text-text-main'
                                    : 'text-text-disabled hover:text-text-muted disabled:hover:text-text-disabled'
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
                    </Tooltip>
                );
            })}
        </div>
    );
};

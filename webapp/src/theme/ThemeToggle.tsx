import React from 'react';
import { MdLightMode, MdDarkMode } from 'react-icons/md';
import { useThemeStore } from './useThemeStore';

const ANIMATION_DURATION = '200ms';
const ANIMATION_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * A compact toggle that switches between light and dark theme.
 * Shows a sun/moon icon on the sliding knob itself.
 * Reads/writes theme via useThemeStore directly (no props needed).
 */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { theme, setTheme } = useThemeStore();
    const isDark = theme === 'dark';

    const transitionStyle = {
        transitionDuration: ANIMATION_DURATION,
        transitionTimingFunction: ANIMATION_EASE,
        transitionProperty: 'all',
    };

    return (
        <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`
                relative inline-flex items-center
                w-12 h-6
                rounded-full
                shadow-sm
                border border-border
                cursor-pointer
                transition-colors
                group
                ${isDark ? 'bg-primary' : 'bg-state-inactive'}
                ${className}
            `}
            role="switch"
            aria-checked={isDark}
        >
            {/* Sliding Knob with Icon */}
            <div
                style={transitionStyle}
                className={`
                    absolute
                    w-5 h-5
                    rounded-full
                    shadow-sm
                    transition-transform
                    group-hover:scale-110
                    flex items-center justify-center
                    ${isDark ? 'left-[calc(100%-1.5rem)]' : 'left-0.5'}
                    ${isDark ? 'bg-text-on-primary' : 'bg-text-muted'}
                `}
            >
                {isDark
                    ? <MdDarkMode className="icon-sm text-primary" />
                    : <MdLightMode className="icon-sm text-surface" />
                }
            </div>
        </button>
    );
};

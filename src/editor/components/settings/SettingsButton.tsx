import React from 'react';

interface SettingsButtonProps {
    label: string;
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
}

const ANIMATION_DURATION = '1000ms';
const ANIMATION_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

export const SettingsButton: React.FC<SettingsButtonProps> = ({
    label,
    icon,
    isActive,
    onClick
}) => {
    const transitionStyle = {
        transitionDuration: ANIMATION_DURATION,
        transitionTimingFunction: ANIMATION_EASE
    };

    return (
        <button
            onClick={onClick}
            style={transitionStyle}
            className={`
                group relative w-full h-12 rounded-full transition-all overflow-hidden border font-sans
                ${isActive
                    ? 'bg-primary border-primary'
                    : 'bg-surface border-border text-text-muted hover:border-text-muted/30'
                }
            `}
        >
            {/* Sliding Circle Container for Icon */}
            <div
                style={transitionStyle}
                className={`
                    absolute top-1 bottom-1 aspect-square rounded-full flex items-center justify-center shadow-lg z-10 transition-all
                    ${isActive
                        // Selected: Move to Right. BG is Surface (Black). Text is Primary.
                        ? 'left-[calc(100%-2.75rem)] bg-surface text-primary'
                        // Unselected: At Left. BG is Primary (Brand). Text is White.
                        : 'left-1 bg-primary text-primary-fg'
                    }
                `}
            >
                {/* Icon Scale/Rotate Animation */}
                <div
                    style={transitionStyle}
                    className={`transition-transform ${isActive ? 'scale-100' : 'scale-90'}`}
                >
                    {icon}
                </div>
            </div>

            {/* Label Container */}
            <div
                style={transitionStyle}
                className={`
                absolute inset-0 flex items-center transition-all
                ${isActive
                        ? 'pl-6 justify-start' // Selected: Text moves Left (icon is at right)
                        : 'pl-14 justify-start' // Unselected: Text is pushed Right by icon
                    }
            `}>
                <span
                    style={transitionStyle}
                    className={`
                    text-sm font-semibold tracking-wide whitespace-nowrap transition-colors
                    ${isActive
                            ? 'text-primary-fg'
                            : 'text-text-muted group-hover:text-text-main'
                        }
                `}>
                    {label}
                </span>
            </div>
        </button>
    );
};

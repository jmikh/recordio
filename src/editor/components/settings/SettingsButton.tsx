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
                group relative w-full h-12 rounded-full transition-colors overflow-hidden font-sans text-xs shadow-inner-bold
                ${isActive
                    ? 'bg-primary border border-primary'
                    : 'bg-background text-text-muted border border-transparent hover:border-text-muted/30'
                }
            `}
        >
            {/* Sliding Circle Container for Icon */}
            <div
                style={transitionStyle}
                className={`
                    absolute top-1 bottom-1 aspect-square rounded-full flex items-center justify-center shadow-float z-10 transition-all
                    ${isActive
                        ? 'left-[calc(100%-2.75rem)] bg-background text-text-main'
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
                    tracking-wide whitespace-nowrap transition-colors
                    ${isActive
                            ? 'text-primary-fg'
                            : 'text-text-muted group-hover:text-text-main'
                        }
                `}>
                    {label}
                </span>
            </div>
        </button >
    );
};

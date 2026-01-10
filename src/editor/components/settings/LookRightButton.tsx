import React from 'react';
import { motion } from 'framer-motion';
import { FaChevronRight } from 'react-icons/fa';

interface LookRightButtonProps {
    /** The default icon to show when not active */
    icon: React.ReactNode;
    /** Whether the button is in the active state */
    isActive: boolean;
    /** Click handler */
    onClick: () => void;
    /** Optional label text */
    label?: string;
    /** Additional classes */
    className?: string;
}

const ANIMATION_DURATION = '1000ms';
const ANIMATION_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

export const LookRightButton: React.FC<LookRightButtonProps> = ({
    icon,
    isActive,
    onClick,
    label,
    className = ''
}) => {
    const transitionStyle = {
        transitionDuration: ANIMATION_DURATION,
        transitionTimingFunction: ANIMATION_EASE
    };

    return (
        <button
            onClick={onClick}
            style={transitionStyle}
            // Match SettingsButton container classes
            className={`
                group relative w-full h-12 rounded-full transition-colors overflow-hidden font-sans text-xs shadow-inner-bold
                ${isActive
                    ? 'bg-tertiary border border-tertiary'
                    : 'bg-background text-text-muted border not-hover:border-secondary/30 hover:border-secondary'
                }
                ${className}
            `}
        >
            {/* Sliding Circle Container for Icon */}
            <motion.div
                style={transitionStyle as any} // Cast to any to avoid type conflict with motion style
                className={`
                    absolute top-1 bottom-1 aspect-square rounded-full flex items-center justify-center shadow-float z-10 transition-all
                    ${isActive
                        ? 'left-[calc(100%-2.75rem)] bg-background text-text-main' // Moves to RIGHT
                        : 'left-1 bg-secondary text-secondary-fg' // Stays on LEFT
                    }
                `}
                animate={isActive ? {
                    x: [0, -20, 0],
                } : { x: 0 }}
                transition={isActive ? {
                    duration: 1.5,
                    repeat: Infinity,
                    repeatDelay: 0.5,
                    delay: 1 // Wait for the 1s layout transition to finish
                } : {}}
            >
                {/* Icon Content */}
                <div className={`flex items-center justify-center ${isActive ? 'text-tertiary' : ''}`}>
                    {isActive ? (
                        <FaChevronRight className="w-4 h-4" />
                    ) : (
                        <div style={transitionStyle} className="transition-transform scale-90">
                            {icon}
                        </div>
                    )}
                </div>
            </motion.div>

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
        </button>
    );
};

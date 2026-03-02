import React from 'react';

interface TimelineTrackRowProps {
    height: number;
    children: React.ReactNode;
    /** Additional class names for the track container */
    className?: string;
    /** Called when mouse enters this track row */
    onMouseEnter?: () => void;
}

/**
 * Wrapper component for timeline track content.
 * Provides consistent height and subtle background styling.
 */
export const TimelineTrackRow: React.FC<TimelineTrackRowProps> = ({
    height,
    children,
    className = '',
    onMouseEnter,
}) => {
    return (
        <div
            className={`relative w-full bg-surface-raised rounded-sm overflow-hidden ${className}`}
            style={{ height, boxShadow: 'var(--shadow-sm)', transition: 'height 150ms ease' }}
            onMouseEnter={onMouseEnter}
        >
            {children}
        </div>
    );
};

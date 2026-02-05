import React from 'react';

interface TimelineTrackRowProps {
    height: number;
    children: React.ReactNode;
    /** Additional class names for the track container */
    className?: string;
}

/**
 * Wrapper component for timeline track content.
 * Provides consistent height and subtle background styling.
 */
export const TimelineTrackRow: React.FC<TimelineTrackRowProps> = ({
    height,
    children,
    className = '',
}) => {
    return (
        <div
            className={`relative w-full bg-surface-raised rounded-sm ${className}`}
            style={{ height }}
        >
            {children}
        </div>
    );
};


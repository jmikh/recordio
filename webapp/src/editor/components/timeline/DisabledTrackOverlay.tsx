import React from 'react';

/**
 * A subtle diagonal stripe overlay rendered across a disabled track.
 * Makes it visually obvious that the track is inactive even when empty.
 */
export const DisabledTrackOverlay: React.FC<{ height: number }> = ({ height }) => (
    <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
            height,
            backgroundImage: `repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 4px,
                color-mix(in srgb, var(--text-main) 6%, transparent) 4px,
                color-mix(in srgb, var(--text-main) 6%, transparent) 8px
            )`,
        }}
    />
);

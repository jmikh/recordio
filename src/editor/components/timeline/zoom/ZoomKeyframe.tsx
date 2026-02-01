import React from 'react';
import {
    diamondKeyframe,
    squareKeyframe,
    keyframeContainer,
    scaleLabel
} from './ZoomTrackStyles';

interface ZoomKeyframeProps {
    /** Position from left edge in pixels */
    left: number;
    /** Whether this is a full-screen (1x) keyframe */
    isFullViewport: boolean;
    /** Scale value to display (e.g., "2.5x") */
    scaleLabel: string;
    /** Whether this keyframe is currently selected */
    isSelected: boolean;
    /** Whether this keyframe is being dragged */
    isDragging: boolean;
    /** Mouse down handler for drag initiation */
    onMouseDown: (e: React.MouseEvent) => void;
    /** Click handler for selection */
    onClick: (e: React.MouseEvent) => void;
}

/**
 * Renders a keyframe marker on the zoom track.
 * - Diamond shape for zoomed states
 * - Hollow square for full-viewport (1x) states
 */
export const ZoomKeyframe: React.FC<ZoomKeyframeProps> = ({
    left,
    isFullViewport,
    scaleLabel: scaleLabelText,
    isSelected,
    isDragging,
    onMouseDown,
    onClick,
}) => {
    // Select the appropriate style based on keyframe type
    const keyframeStyle = isFullViewport ? squareKeyframe : diamondKeyframe;

    // Build class string based on state
    const stateClass = isSelected ? keyframeStyle.selected : keyframeStyle.default;
    const hoverClass = isSelected ? '' : keyframeStyle.hover;

    return (
        <div
            className={`${keyframeContainer.base} ${isDragging ? keyframeContainer.dragging : keyframeContainer.idle}`}
            style={{ left: `${left}px` }}
            onMouseDown={onMouseDown}
            onClick={onClick}
        >
            {/* Keyframe marker */}
            <div
                className={`${keyframeStyle.base} ${stateClass} ${hoverClass}`}
                style={keyframeStyle.style}
            />

            {/* Scale value below keyframe */}
            <span className={scaleLabel.className}>
                {scaleLabelText}
            </span>
        </div>
    );
};

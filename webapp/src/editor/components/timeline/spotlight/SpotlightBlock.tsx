import React from 'react';
import {
    fadeInSegment,
    holdSegment,
    fadeOutSegment,
    spotlightContainer,
    resizeHandle,
    dragHandleIndicator,
    FADE_HEIGHT,
    HOLD_HEIGHT,
    DRAG_HANDLE_HEIGHT
} from './SpotlightTrackStyles';

interface SpotlightBlockProps {
    /** Left position in pixels */
    left: number;
    /** Total width of the spotlight block in pixels */
    width: number;
    /** Width of the fade-in segment in pixels */
    fadeInWidth: number;
    /** Width of the fade-out segment in pixels */
    fadeOutWidth: number;
    /** Whether this spotlight is selected */
    isSelected: boolean;
    /** Whether this spotlight is being dragged */
    isDragging: boolean;
    /** Track height for centering */
    trackHeight: number;
    /** Mouse down handler for move drag */
    onMouseDown: (e: React.MouseEvent) => void;
    /** Click handler for selection */
    onClick: (e: React.MouseEvent) => void;
    /** Mouse down handler for left resize */
    onResizeStartMouseDown: (e: React.MouseEvent) => void;
    /** Mouse down handler for right resize */
    onResizeEndMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Renders a spotlight block on the timeline with three visual segments:
 * - Fade In (left): shorter with diagonal stripes pointing inward
 * - Hold (center): taller with solid fill
 * - Fade Out (right): shorter with diagonal stripes pointing outward
 */
export const SpotlightBlock: React.FC<SpotlightBlockProps> = ({
    left,
    width,
    fadeInWidth,
    fadeOutWidth,
    isSelected,
    isDragging,
    trackHeight,
    onMouseDown,
    onClick,
    onResizeStartMouseDown,
    onResizeEndMouseDown,
}) => {
    // Calculate hold width
    const holdWidth = Math.max(0, width - fadeInWidth - fadeOutWidth);

    // Calculate vertical centering positions
    const fadeY = (trackHeight - FADE_HEIGHT) / 2;
    const holdY = (trackHeight - HOLD_HEIGHT) / 2;

    // Get color classes based on selection state
    const fadeColorClass = isSelected ? fadeInSegment.selectedClass : fadeInSegment.defaultClass;
    const holdColorClass = isSelected ? holdSegment.selectedClass : holdSegment.defaultClass;

    // Only apply hover effects when not selected
    const fadeHoverClass = isSelected ? '' : fadeInSegment.hoverClass;
    const holdHoverClass = isSelected ? '' : holdSegment.hoverClass;

    return (
        <div
            className={`${spotlightContainer.base} group ${isDragging ? spotlightContainer.dragging : spotlightContainer.idle}`}
            style={{
                left: `${left}px`,
                width: `${width}px`,
                height: trackHeight,
                zIndex: isSelected ? 20 : 10,
            }}
            onMouseDown={onMouseDown}
            onClick={onClick}
        >
            {/* Fade In Segment */}
            {fadeInWidth > 0 && (
                <div
                    className={`${fadeInSegment.base} ${fadeColorClass} ${fadeHoverClass}`}
                    style={{
                        left: 0,
                        top: fadeY,
                        width: fadeInWidth,
                        ...fadeInSegment.getStyle(),
                    }}
                />
            )}

            {/* Hold Segment */}
            {holdWidth > 0 && (
                <div
                    className={`${holdSegment.base} ${holdColorClass} ${holdHoverClass}`}
                    style={{
                        left: fadeInWidth,
                        top: holdY,
                        width: holdWidth,
                        ...holdSegment.getStyle(),
                    }}
                />
            )}

            {/* Fade Out Segment */}
            {fadeOutWidth > 0 && (
                <div
                    className={`${fadeOutSegment.base} ${fadeColorClass} ${fadeHoverClass}`}
                    style={{
                        left: fadeInWidth + holdWidth,
                        top: fadeY,
                        width: fadeOutWidth,
                        ...fadeOutSegment.getStyle(),
                    }}
                />
            )}

            {/* Left resize handle */}
            <div
                className={resizeHandle.base}
                style={{
                    left: -resizeHandle.width / 2,
                    width: resizeHandle.width,
                    top: (trackHeight - DRAG_HANDLE_HEIGHT) / 2,
                    height: resizeHandle.height,
                }}
                onMouseDown={onResizeStartMouseDown}
            >
                {/* Visible drag handle indicator */}
                <div
                    className={`${dragHandleIndicator.base} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: dragHandleIndicator.height }}
                />
            </div>

            {/* Right resize handle */}
            <div
                className={resizeHandle.base}
                style={{
                    right: -resizeHandle.width / 2,
                    width: resizeHandle.width,
                    top: (trackHeight - DRAG_HANDLE_HEIGHT) / 2,
                    height: resizeHandle.height,
                }}
                onMouseDown={onResizeEndMouseDown}
            >
                {/* Visible drag handle indicator */}
                <div
                    className={`${dragHandleIndicator.base} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: dragHandleIndicator.height }}
                />
            </div>
        </div>
    );
};

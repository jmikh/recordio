import React from 'react';
import { RiLightbulbFlashLine } from 'react-icons/ri';
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
import { blockIconClass, BLOCK_ICON_SIZE, MIN_ICON_WIDTH_PX } from '../TimelineBlockStyles';

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
    /** Whether the track is disabled */
    disabled?: boolean;
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
    disabled = false,
}) => {
    // Calculate hold width
    const holdWidth = Math.max(0, width - fadeInWidth - fadeOutWidth);

    // Calculate vertical centering positions
    const fadeY = (trackHeight - FADE_HEIGHT) / 2;
    const holdY = (trackHeight - HOLD_HEIGHT) / 2;

    // Get color classes based on selection state
    const fadeColorClass = (isSelected && !disabled) ? fadeInSegment.selectedClass : fadeInSegment.defaultClass;
    const holdColorClass = (isSelected && !disabled) ? holdSegment.selectedClass : holdSegment.defaultClass;

    // Only apply hover effects when not selected and not disabled
    const fadeHoverClass = (isSelected || disabled) ? '' : fadeInSegment.hoverClass;
    const holdHoverClass = (isSelected || disabled) ? '' : holdSegment.hoverClass;

    return (
        <div
            className={`${spotlightContainer.base} group ${isDragging ? spotlightContainer.dragging : spotlightContainer.idle} ${(!isSelected && !disabled) ? spotlightContainer.hoverClass : ''} ${disabled ? 'pointer-events-none' : ''}`}
            data-part="block-container"
            style={{
                left: `${left}px`,
                width: `${width}px`,
                height: trackHeight,
                zIndex: isSelected ? 20 : 10,
                opacity: disabled ? 0.7 : 1,
                cursor: disabled ? 'default' : undefined,
            }}
            onMouseDown={disabled ? undefined : onMouseDown}
            onClick={disabled ? undefined : onClick}
        >
            {/* Fade In Segment */}
            {fadeInWidth > 0 && (
                <div
                    className={`${fadeInSegment.base} ${fadeColorClass} ${fadeHoverClass}`}
                    data-part="fade-in"
                    style={{
                        left: 0,
                        top: fadeY,
                        width: fadeInWidth,
                        ...fadeInSegment.getStyle(),
                        ...(holdWidth === 0 ? { borderRight: '1px solid var(--block-bg)' } : {}),
                    }}
                />
            )}

            {/* Hold Segment */}
            {holdWidth > 0 && (
                <div
                    className={`${holdSegment.base} ${holdColorClass} ${holdHoverClass} flex items-center justify-center overflow-hidden`}
                    data-part="hold"
                    style={{
                        left: fadeInWidth,
                        top: holdY,
                        width: holdWidth,
                        ...holdSegment.getStyle(),
                    }}
                >
                    {holdWidth >= MIN_ICON_WIDTH_PX && (
                        <RiLightbulbFlashLine className={blockIconClass} size={BLOCK_ICON_SIZE} />
                    )}
                </div>
            )}

            {/* Fade Out Segment */}
            {fadeOutWidth > 0 && (
                <div
                    className={`${fadeOutSegment.base} ${fadeColorClass} ${fadeHoverClass}`}
                    data-part="fade-out"
                    style={{
                        left: fadeInWidth + holdWidth,
                        top: fadeY,
                        width: fadeOutWidth,
                        ...fadeOutSegment.getStyle(),
                        ...(holdWidth === 0 ? { borderLeft: '1px solid var(--block-bg)' } : {}),
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

import React from 'react';
import { RiLightbulbFlashLine } from 'react-icons/ri';
import {
    transitionSegment,
    holdSegment,
    blockContainer,
    resizeHandle,
    dragHandleIndicator,
    fadeStyle,
    holdStyle,
    blockIconClass,
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
} from '../shared/TimelineBlockStyles';

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
    /** Whether the track is in collapsed state (hides icons) */
    isCollapsed?: boolean;
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
    isCollapsed = false,
}) => {
    // Calculate hold width
    const holdWidth = Math.max(0, width - fadeInWidth - fadeOutWidth);

    // All segments fill the track with 1px padding top/bottom
    const segmentHeight = trackHeight - 2;
    const segmentY = 1;

    // Get color classes based on selection state
    const fadeColorClass = (isSelected && !disabled) ? transitionSegment.selectedClass : transitionSegment.defaultClass;
    const holdColorClass = (isSelected && !disabled) ? holdSegment.selectedClass : holdSegment.defaultClass;

    // Only apply hover effects when not selected and not disabled
    const fadeHoverClass = (isSelected || disabled) ? '' : transitionSegment.hoverClass;
    const holdHoverClass = (isSelected || disabled) ? '' : holdSegment.hoverClass;

    return (
        <div
            className={`${blockContainer.base} group ${isDragging ? blockContainer.dragging : blockContainer.idle} ${(!isSelected && !disabled) ? blockContainer.hoverClass : ''} ${disabled ? 'pointer-events-none' : ''}`}
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
                    className={`${transitionSegment.base} ${fadeColorClass} ${fadeHoverClass}`}
                    data-part="fade-in"
                    style={{
                        left: 0,
                        top: segmentY,
                        width: fadeInWidth,
                        ...transitionSegment.getStyle(),
                        height: segmentHeight,
                        borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
                        borderRight: 'none',
                        ...(holdWidth === 0 && fadeOutWidth === 0 ? { borderRadius: SEGMENT_RADIUS, borderRight: undefined } : {}),
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
                        top: segmentY,
                        width: holdWidth,
                        ...holdStyle(),
                        height: segmentHeight,
                        borderRadius: fadeInWidth === 0 && fadeOutWidth === 0
                            ? SEGMENT_RADIUS
                            : fadeInWidth === 0
                                ? `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`
                                : fadeOutWidth === 0
                                    ? `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`
                                    : 0,
                    }}
                >
                    {!isCollapsed && holdWidth >= MIN_ICON_WIDTH_PX && (
                        <RiLightbulbFlashLine className={`${blockIconClass} icon-md`} />
                    )}
                </div>
            )}

            {/* Fade Out Segment */}
            {fadeOutWidth > 0 && (
                <div
                    className={`${transitionSegment.base} ${fadeColorClass} ${fadeHoverClass}`}
                    data-part="fade-out"
                    style={{
                        left: fadeInWidth + holdWidth,
                        top: segmentY,
                        width: fadeOutWidth,
                        ...transitionSegment.getStyle(),
                        height: segmentHeight,
                        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
                        borderLeft: 'none',
                        ...(holdWidth === 0 && fadeInWidth === 0 ? { borderRadius: SEGMENT_RADIUS, borderLeft: undefined } : {}),
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
                    top: -1,
                    bottom: -1,
                }}
                onMouseDown={onResizeStartMouseDown}
            >
                {/* Visible drag handle indicator */}
                <div
                    className={`${dragHandleIndicator.base} ${dragHandleIndicator.leftClass} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: 'calc(100% - 2px)' }}
                />
            </div>

            {/* Right resize handle */}
            <div
                className={resizeHandle.base}
                style={{
                    right: -resizeHandle.width / 2,
                    width: resizeHandle.width,
                    top: -1,
                    bottom: -1,
                }}
                onMouseDown={onResizeEndMouseDown}
            >
                {/* Visible drag handle indicator */}
                <div
                    className={`${dragHandleIndicator.base} ${dragHandleIndicator.rightClass} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: 'calc(100% - 2px)' }}
                />
            </div>
        </div>
    );
};

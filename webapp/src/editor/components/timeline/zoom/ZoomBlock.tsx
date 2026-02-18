import React from 'react';
import {
    transitionInSegment,
    holdSegment,
    zoomContainer,
    resizeHandle,
    dragHandleIndicator,
    TRANSITION_HEIGHT,
    HOLD_HEIGHT,
    DRAG_HANDLE_HEIGHT,
    SEGMENT_RADIUS,
} from './ZoomTrackStyles';

interface ZoomBlockProps {
    /** Left position in pixels */
    left: number;
    /** Total width of the zoom block in pixels */
    width: number;
    /** Width of the transition-in segment in pixels */
    transitionInWidth: number;
    /** Whether this block is selected */
    isSelected: boolean;
    /** Whether this block is being dragged */
    isDragging: boolean;
    /** Track height for centering */
    trackHeight: number;
    /** Mouse down handler for move drag */
    onMouseDown: (e: React.MouseEvent) => void;
    /** Click handler for selection toggle */
    onClick: (e: React.MouseEvent) => void;
    /** Mouse down handler for left (start) resize */
    onResizeStartMouseDown: (e: React.MouseEvent) => void;
    /** Mouse down handler for right (end) resize */
    onResizeEndMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Renders a zoom block on the timeline with two visual segments:
 * - Transition-in (left): shorter, striped — represents the zoom-in ramp
 * - Hold (right): taller, solid — represents the held zoom position
 *
 * Both edges have resize handles.
 */
export const ZoomBlock: React.FC<ZoomBlockProps> = ({
    left,
    width,
    transitionInWidth,
    isSelected,
    isDragging,
    trackHeight,
    onMouseDown,
    onClick,
    onResizeStartMouseDown,
    onResizeEndMouseDown,
}) => {
    // Clamp transition-in width so it never exceeds the block
    const clampedTransitionWidth = Math.min(transitionInWidth, width);
    const holdWidth = Math.max(0, width - clampedTransitionWidth);

    // Vertical centering
    const transitionY = (trackHeight - TRANSITION_HEIGHT) / 2;
    const holdY = (trackHeight - HOLD_HEIGHT) / 2;

    const transitionColorClass = isSelected ? transitionInSegment.selectedClass : transitionInSegment.defaultClass;
    const holdColorClass = isSelected ? holdSegment.selectedClass : holdSegment.defaultClass;
    const transitionHoverClass = isSelected ? '' : transitionInSegment.hoverClass;
    const holdHoverClass = isSelected ? '' : holdSegment.hoverClass;

    // If hold is zero width, give the transition-in segment rounded right corners too
    const transitionStyle = holdWidth === 0
        ? {
            ...transitionInSegment.getStyle(),
            borderRadius: SEGMENT_RADIUS,
            borderRight: undefined,
        }
        : transitionInSegment.getStyle();

    return (
        <div
            className={`${zoomContainer.base} group ${isDragging ? zoomContainer.dragging : zoomContainer.idle}`}
            style={{
                left: `${left}px`,
                width: `${width}px`,
                height: trackHeight,
                zIndex: isSelected ? 20 : 10,
            }}
            onMouseDown={onMouseDown}
            onClick={onClick}
        >
            {/* Transition-in segment */}
            {clampedTransitionWidth > 0 && (
                <div
                    className={`${transitionInSegment.base} ${transitionColorClass} ${transitionHoverClass}`}
                    style={{
                        left: 0,
                        top: transitionY,
                        width: clampedTransitionWidth,
                        ...transitionStyle,
                    }}
                />
            )}

            {/* Hold segment */}
            {holdWidth > 0 && (
                <div
                    className={`${holdSegment.base} ${holdColorClass} ${holdHoverClass}`}
                    style={{
                        left: clampedTransitionWidth,
                        top: holdY,
                        width: holdWidth,
                        ...holdSegment.getStyle(),
                        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
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
                <div
                    className={`${dragHandleIndicator.base} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: dragHandleIndicator.height }}
                />
            </div>
        </div>
    );
};

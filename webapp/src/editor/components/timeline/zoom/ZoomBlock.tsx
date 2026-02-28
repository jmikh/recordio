import React from 'react';
import { AiOutlineZoomIn, AiOutlineZoomOut } from 'react-icons/ai';
import {
    transitionInSegment,
    holdSegment,
    zoomContainer,
    resizeHandle,
    dragHandleIndicator,
    HOLD_HEIGHT,
    DRAG_HANDLE_HEIGHT,
    SEGMENT_RADIUS,
    zoomOutBlock,
} from './ZoomTrackStyles';
import { BLOCK_ICON_SIZE, MIN_ICON_WIDTH_PX } from '../TimelineBlockStyles';

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
    /** Whether a zoom-out block immediately follows this block */
    hasZoomOut?: boolean;
    /** Width of the zoom-out segment in pixels (0 = no zoom-out visible) */
    zoomOutWidth?: number;
    /** Whether the zoom track is disabled (visual only, no interaction) */
    disabled?: boolean;
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
    hasZoomOut = false,
    zoomOutWidth = 0,
    disabled = false,
}) => {
    // Clamp transition-in width so it never exceeds the block
    const clampedTransitionWidth = Math.min(transitionInWidth, width);
    const holdWidth = Math.max(0, width - clampedTransitionWidth);

    // Vertical centering — same height for both segments
    const segmentY = (trackHeight - HOLD_HEIGHT) / 2;

    const transitionColorClass = isSelected && !disabled ? transitionInSegment.selectedClass : transitionInSegment.defaultClass;
    const holdColorClass = isSelected && !disabled ? holdSegment.selectedClass : holdSegment.defaultClass;
    const transitionHoverClass = (isSelected || disabled) ? '' : transitionInSegment.hoverClass;
    const holdHoverClass = (isSelected || disabled) ? '' : holdSegment.hoverClass;

    // If hold is zero width, give the transition-in segment rounded right corners too
    // (unless a zoom-out block follows — then keep right corners flat)
    const transitionStyle = holdWidth === 0
        ? {
            ...transitionInSegment.getStyle(),
            borderRadius: hasZoomOut
                ? `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`
                : SEGMENT_RADIUS,
            borderRight: hasZoomOut ? 'none' : undefined,
        }
        : transitionInSegment.getStyle();

    return (
        <div
            className={`${zoomContainer.base} group ${isDragging ? zoomContainer.dragging : zoomContainer.idle} ${(!isSelected && !disabled) ? zoomContainer.hoverClass : ''} ${disabled ? 'pointer-events-none' : ''}`}
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
            {/* Transition-in segment */}
            {clampedTransitionWidth > 0 && (
                <div
                    className={`${transitionInSegment.base} ${transitionColorClass} ${transitionHoverClass} flex items-center justify-center overflow-hidden`}
                    style={{
                        left: 0,
                        top: segmentY,
                        width: clampedTransitionWidth,
                        ...transitionStyle,
                    }}
                >
                    {clampedTransitionWidth >= MIN_ICON_WIDTH_PX && (
                        <AiOutlineZoomIn className="text-main opacity-70" size={BLOCK_ICON_SIZE} />
                    )}
                </div>
            )}

            {/* Hold segment */}
            {holdWidth > 0 && (
                <div
                    className={`${holdSegment.base} ${holdColorClass} ${holdHoverClass}`}
                    style={{
                        left: clampedTransitionWidth,
                        top: segmentY,
                        width: holdWidth,
                        ...holdSegment.getStyle(),
                        borderRadius: hasZoomOut ? 0 : `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
                        borderRight: hasZoomOut && !isSelected ? 'none' : undefined,
                    }}
                />
            )}

            {/* Zoom-out segment (overflows the container to the right) */}
            {zoomOutWidth > 0 && (
                <div
                    className={`${zoomOutBlock.base} pointer-events-auto ${isSelected ? 'border-secondary' : ''}`}
                    style={{
                        left: width,
                        top: segmentY,
                        width: zoomOutWidth,
                        ...zoomOutBlock.getStyle(),
                        zIndex: 2,
                    }}
                >
                    {zoomOutWidth >= MIN_ICON_WIDTH_PX && (
                        <AiOutlineZoomOut className="text-main opacity-70" size={BLOCK_ICON_SIZE} />
                    )}
                </div>
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

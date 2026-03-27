import React from 'react';
import { AiOutlineZoomIn, AiOutlineZoomOut } from 'react-icons/ai';
import {
    transitionSegment,
    holdSegment,
    blockContainer,
    resizeHandle,
    dragHandleIndicator,
    zoomOutBlock,
    transitionInStyle,
    BLOCK_ICON_SIZE,
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
} from '../shared/TimelineBlockStyles';

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
    /** Whether the track is in collapsed state (hides icons) */
    isCollapsed?: boolean;
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
    isCollapsed = false,
}) => {
    // Clamp transition-in width so it never exceeds the block
    const clampedTransitionWidth = Math.min(transitionInWidth, width);
    const holdWidth = Math.max(0, width - clampedTransitionWidth);

    // All segments fill the track with 1px padding top/bottom
    const segmentHeight = trackHeight - 2;
    const segmentY = 1;

    const transitionColorClass = isSelected && !disabled ? transitionSegment.selectedClass : transitionSegment.defaultClass;
    const holdColorClass = isSelected && !disabled ? holdSegment.selectedClass : holdSegment.defaultClass;
    const transitionHoverClass = (isSelected || disabled) ? '' : transitionSegment.hoverClass;
    const holdHoverClass = (isSelected || disabled) ? '' : holdSegment.hoverClass;

    // If hold is zero width, give the transition-in segment rounded right corners too
    // (unless a zoom-out block follows — then keep right corners flat)
    const transitionStyle = holdWidth === 0
        ? {
            ...transitionSegment.getStyle(),
            borderRadius: hasZoomOut
                ? `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`
                : SEGMENT_RADIUS,
            borderRight: hasZoomOut ? 'none' : undefined,
        }
        : {
            ...transitionInStyle(),
        };

    return (
        <div
            className={`${blockContainer.base} group z-10 hover:z-[15] ${isDragging ? blockContainer.dragging : blockContainer.idle} ${(!isSelected && !disabled) ? blockContainer.hoverClass : ''} ${disabled ? 'pointer-events-none' : ''}`}
            data-part="block-container"
            style={{
                left: `${left}px`,
                width: `${width}px`,
                height: trackHeight,
                zIndex: isSelected ? 20 : undefined,
                opacity: disabled ? 0.7 : 1,
                cursor: disabled ? 'default' : undefined,
            }}
            onMouseDown={disabled ? undefined : onMouseDown}
            onClick={disabled ? undefined : onClick}
        >
            {/* Transition-in segment */}
            {clampedTransitionWidth > 0 && (
                <div
                    className={`${transitionSegment.base} ${transitionColorClass} ${transitionHoverClass} flex items-center justify-center overflow-hidden`}
                    data-part="transition-in"
                    style={{
                        left: 0,
                        top: segmentY,
                        width: clampedTransitionWidth,
                        ...transitionStyle,
                        height: segmentHeight,
                    }}
                >
                    {!isCollapsed && clampedTransitionWidth >= MIN_ICON_WIDTH_PX && (
                        <AiOutlineZoomIn className="text-main opacity-60" size={BLOCK_ICON_SIZE} />
                    )}
                </div>
            )}

            {/* Hold segment */}
            {holdWidth > 0 && (
                <div
                    className={`${holdSegment.base} ${holdColorClass} ${holdHoverClass}`}
                    data-part="hold"
                    style={{
                        left: clampedTransitionWidth,
                        top: segmentY,
                        width: holdWidth,
                        ...holdSegment.getStyle(),
                        height: segmentHeight,
                        borderRadius: hasZoomOut ? 0 : `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
                        borderRight: hasZoomOut && !isSelected ? 'none' : undefined,
                    }}
                />
            )}

            {/* Zoom-out segment (overflows the container to the right) */}
            {zoomOutWidth > 0 && (
                <div
                    className={`${zoomOutBlock.base} pointer-events-auto ${isSelected ? 'border-secondary' : ''}`}
                    data-part="zoom-out"
                    style={{
                        left: width,
                        top: segmentY,
                        width: zoomOutWidth,
                        ...zoomOutBlock.getStyle(),
                        height: segmentHeight,
                        zIndex: 2,
                    }}
                >
                    {!isCollapsed && zoomOutWidth >= MIN_ICON_WIDTH_PX && (
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
                    top: -1,
                    bottom: -1,
                }}
                onMouseDown={onResizeStartMouseDown}
            >
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
                <div
                    className={`${dragHandleIndicator.base} ${dragHandleIndicator.rightClass} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: 'calc(100% - 2px)' }}
                />
            </div>
        </div>
    );
};

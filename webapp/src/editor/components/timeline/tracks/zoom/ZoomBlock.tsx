import React from 'react';
import { LuZoomIn } from 'react-icons/lu';
import {
    holdSegment,
    blockContainer,
    trackBlockColor,
    resizeHandle,
    dragHandleIndicator,
    zoomOutBlock,
    blockIconClass,
    blockLabelClass,
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
} from '../shared/TimelineBlockStyles';

/** Minimum block width (px) before the zoom factor label is shown next to the icon */
const MIN_ZOOM_FACTOR_LABEL_WIDTH_PX = 56;

interface ZoomBlockProps {
    /** Left position in pixels */
    left: number;
    /** Total width of the zoom block in pixels */
    width: number;
    /** Zoom factor relative to the full output (e.g. 1.7 = 1.7x) */
    zoomFactor: number;
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
 * Renders a zoom block on the timeline as a single solid segment (the
 * zoom-in ramp is part of the block), followed by an optional zoom-out
 * segment overflowing to the right.
 *
 * Both edges have resize handles.
 */
export const ZoomBlock: React.FC<ZoomBlockProps> = ({
    left,
    width,
    zoomFactor,
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
    // All segments fill the track with 1px padding top/bottom
    const segmentHeight = trackHeight - 2;
    const segmentY = 1;

    const holdColorClass = isSelected && !disabled ? holdSegment.selectedClass : holdSegment.defaultClass;
    const holdHoverClass = (isSelected || disabled) ? '' : holdSegment.hoverClass;

    return (
        <div
            className={`${blockContainer.base} ${trackBlockColor.zoom.base} group z-10 hover:z-[15] ${isDragging ? blockContainer.dragging : blockContainer.idle} ${(!isSelected && !disabled) ? trackBlockColor.zoom.hover : ''} ${disabled ? 'pointer-events-none' : ''}`}
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
            {/* Zoom segment */}
            <div
                className={`${holdSegment.base} ${holdColorClass} ${holdHoverClass} flex items-center justify-center gap-1 overflow-hidden`}
                data-part="hold"
                style={{
                    left: 0,
                    top: segmentY,
                    width,
                    ...holdSegment.getStyle(),
                    height: segmentHeight,
                    borderRadius: hasZoomOut
                        ? `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`
                        : SEGMENT_RADIUS,
                    borderRight: hasZoomOut && !isSelected ? 'none' : undefined,
                }}
            >
                {!isCollapsed && width >= MIN_ICON_WIDTH_PX && (
                    <LuZoomIn className={`${blockIconClass} icon-md shrink-0`} />
                )}
                {!isCollapsed && width >= MIN_ZOOM_FACTOR_LABEL_WIDTH_PX && (
                    <span className={blockLabelClass}>
                        {parseFloat(zoomFactor.toFixed(1))}x
                    </span>
                )}
            </div>

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

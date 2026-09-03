import React from 'react';
import { LuLayers3 } from 'react-icons/lu';
import { MdBlurOn, MdOutlineTextFields, MdBorderOuter } from 'react-icons/md';
import { RiArrowRightUpFill } from 'react-icons/ri';
import type { OverlayItemType } from '@shared/types/overlay';
import {
    holdSegment,
    blockContainer,
    resizeHandle,
    dragHandleIndicator,
    blockIconClass,
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
} from '../shared/TimelineBlockStyles';

const OVERLAY_TYPE_ICONS: Record<OverlayItemType, React.ReactNode> = {
    blur: <MdBlurOn className="icon-md" />,
    text: <MdOutlineTextFields className="icon-md" />,
    arrow: <RiArrowRightUpFill className="icon-md" />,
    border: <MdBorderOuter className="icon-md" />,
};

interface OverlayBlockProps {
    left: number;
    width: number;
    isSelected: boolean;
    isDragging: boolean;
    trackHeight: number;
    /** Type of the single overlay item */
    itemType: OverlayItemType;
    /** Number of other segments overlapping with this one */
    overlapCount: number;
    /** Z-index for stacking (shorter blocks get higher z) */
    zIndex: number;
    onMouseDown: (e: React.MouseEvent) => void;
    onClick: (e: React.MouseEvent) => void;
    onResizeStartMouseDown: (e: React.MouseEvent) => void;
    onResizeEndMouseDown: (e: React.MouseEvent) => void;
    disabled?: boolean;
    isCollapsed?: boolean;
}

/**
 * A single overlay block on the timeline — contains exactly one overlay item.
 * Shows type-specific icon and overlap indicator when overlapping with other blocks.
 */
export const OverlayBlock: React.FC<OverlayBlockProps> = ({
    left,
    width,
    isSelected,
    isDragging,
    trackHeight,
    itemType,
    overlapCount,
    zIndex,
    onMouseDown,
    onClick,
    onResizeStartMouseDown,
    onResizeEndMouseDown,
    disabled = false,
    isCollapsed = false,
}) => {
    const segmentHeight = trackHeight - 2;
    const segmentY = 1;
    const holdColorClass = (isSelected && !disabled) ? holdSegment.selectedClass : holdSegment.defaultClass;

    return (
        <div
            className={`${blockContainer.base} group ${isDragging ? blockContainer.dragging : blockContainer.idle} ${(!isSelected && !disabled) ? blockContainer.hoverClass : ''} ${disabled ? 'pointer-events-none' : ''}`}
            style={{
                left: `${left}px`,
                width: `${width}px`,
                height: trackHeight,
                zIndex,
                opacity: disabled ? 0.7 : 1,
                cursor: disabled ? 'default' : undefined,
            }}
            onMouseDown={disabled ? undefined : onMouseDown}
            onClick={disabled ? undefined : onClick}
        >
            {/* Single hold segment */}
            <div
                className={`${holdSegment.base} ${holdColorClass} flex items-center justify-center overflow-hidden`}
                style={{
                    left: 0,
                    top: segmentY,
                    width: '100%',
                    ...holdSegment.getStyle(),
                    height: segmentHeight,
                    borderRadius: SEGMENT_RADIUS,
                }}
            >
                {!isCollapsed && width >= MIN_ICON_WIDTH_PX && (
                    <div className="flex items-center gap-0.5">
                        <span className={blockIconClass}>
                            {OVERLAY_TYPE_ICONS[itemType]}
                        </span>
                        {/* Overlap indicator */}
                        {overlapCount > 0 && width >= MIN_ICON_WIDTH_PX + 16 && (
                            <span className={`${blockIconClass} text-badge opacity-60`}>
                                +{overlapCount}
                            </span>
                        )}
                    </div>
                )}
            </div>

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

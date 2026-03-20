import React from 'react';
import { LuLayers3 } from 'react-icons/lu';
import {
    holdSegment,
    blockContainer,
    resizeHandle,
    dragHandleIndicator,
    blockIconClass,
    BLOCK_ICON_SIZE,
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
} from '../shared/TimelineBlockStyles';

interface OverlayBlockProps {
    left: number;
    width: number;
    isSelected: boolean;
    isDragging: boolean;
    trackHeight: number;
    itemCount: number;
    onMouseDown: (e: React.MouseEvent) => void;
    onClick: (e: React.MouseEvent) => void;
    onResizeStartMouseDown: (e: React.MouseEvent) => void;
    onResizeEndMouseDown: (e: React.MouseEvent) => void;
    disabled?: boolean;
    isCollapsed?: boolean;
}

/**
 * A single overlay block on the timeline — simple rounded rectangle
 * containing one or more overlay items. No transition zones.
 */
export const OverlayBlock: React.FC<OverlayBlockProps> = ({
    left,
    width,
    isSelected,
    isDragging,
    trackHeight,
    itemCount,
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
                zIndex: isSelected ? 20 : 10,
                opacity: disabled ? 0.7 : 1,
                cursor: disabled ? 'default' : undefined,
            }}
            onMouseDown={disabled ? undefined : onMouseDown}
            onClick={disabled ? undefined : onClick}
        >
            {/* Single hold segment (no transitions) */}
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
                        <LuLayers3 className={blockIconClass} size={BLOCK_ICON_SIZE} />
                        {itemCount > 1 && (
                            <span className={`${blockIconClass} text-[9px] font-medium`}>{itemCount}</span>
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

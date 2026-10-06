import React from 'react';
import { LuCamera, LuCameraOff } from 'react-icons/lu';
import {
    holdSegment,
    blockContainer,
    trackBlockColor,
    resizeHandle,
    dragHandleIndicator,
    blockIconClass,
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
} from '../shared/TimelineBlockStyles';

interface CameraMoveBlockProps {
    left: number;
    width: number;
    isSelected: boolean;
    isDragging: boolean;
    trackHeight: number;
    onMouseDown: (e: React.MouseEvent) => void;
    onClick: (e: React.MouseEvent) => void;
    onResizeStartMouseDown: (e: React.MouseEvent) => void;
    onResizeEndMouseDown: (e: React.MouseEvent) => void;
    /** Whether the block represents a hidden camera state */
    isHidden?: boolean;
    /** Whether the track is disabled */
    disabled?: boolean;
    /** Whether the track is in collapsed state (hides icons) */
    isCollapsed?: boolean;
}

/**
 * A single camera layout block on the timeline — one solid hold segment with
 * the camera (or camera-off) icon.
 */
export const CameraMoveBlock: React.FC<CameraMoveBlockProps> = ({
    left,
    width,
    isSelected,
    isDragging,
    trackHeight,
    onMouseDown,
    onClick,
    onResizeStartMouseDown,
    onResizeEndMouseDown,
    isHidden,
    disabled = false,
    isCollapsed = false,
}) => {
    const segmentHeight = trackHeight - 2;
    const segmentY = 1;
    const holdColorClass = (isSelected && !disabled) ? holdSegment.selectedClass : holdSegment.defaultClass;

    return (
        <div
            className={`${blockContainer.base} ${trackBlockColor.camera.base} group ${isDragging ? blockContainer.dragging : blockContainer.idle} ${(!isSelected && !disabled) ? trackBlockColor.camera.hover : ''} ${disabled ? 'pointer-events-none' : ''}`}
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
                    isHidden
                        ? <LuCameraOff className={`${blockIconClass} icon-md`} />
                        : <LuCamera className={`${blockIconClass} icon-md`} />
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

import React from 'react';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import {
    transitionSegment,
    holdSegment,
    blockContainer,
    resizeHandle,
    dragHandleIndicator,
    blockIconClass,
    BLOCK_ICON_SIZE,
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
} from '../shared/TimelineBlockStyles';

interface CameraLayoutBlockProps {
    left: number;
    width: number;
    transitionInWidth: number;
    transitionOutWidth: number;
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

export const CameraLayoutBlock: React.FC<CameraLayoutBlockProps> = ({
    left,
    width,
    transitionInWidth,
    transitionOutWidth,
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
    const clampedTransitionIn = Math.min(transitionInWidth, width / 2);
    const clampedTransitionOut = Math.min(transitionOutWidth, width / 2);
    const holdWidth = Math.max(0, width - clampedTransitionIn - clampedTransitionOut);
    const segmentHeight = trackHeight - 2;
    const segmentY = 1;

    const transitionInColor = (isSelected && !disabled) ? transitionSegment.selectedClass : transitionSegment.defaultClass;
    const transitionOutColor = (isSelected && !disabled) ? transitionSegment.selectedClass : transitionSegment.defaultClass;
    const holdColorClass = (isSelected && !disabled) ? holdSegment.selectedClass : holdSegment.defaultClass;

    // When no hold, round both transition ends
    const inStyle = holdWidth === 0 && clampedTransitionOut === 0
        ? { ...transitionSegment.getStyle(), borderRadius: SEGMENT_RADIUS }
        : { ...transitionSegment.getStyle(), borderRight: 'none' as const };
    const outStyle = holdWidth === 0 && clampedTransitionIn === 0
        ? { ...transitionSegment.getStyle(), borderRadius: SEGMENT_RADIUS }
        : { ...transitionSegment.getStyle(), borderLeft: 'none' as const };

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
            {/* Transition-in segment (left) */}
            {clampedTransitionIn > 0 && (
                <div
                    className={`${transitionSegment.base} ${transitionInColor}`}
                    style={{
                        left: 0,
                        top: segmentY,
                        width: clampedTransitionIn,
                        ...inStyle,
                        height: segmentHeight,
                        borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
                        ...(holdWidth === 0 && clampedTransitionOut === 0 ? { borderRadius: SEGMENT_RADIUS } : {}),
                        ...(holdWidth === 0 ? { borderRight: '1px solid var(--block-bg)' } : {}),
                    }}
                />
            )}

            {/* Hold segment (middle) */}
            {holdWidth > 0 && (
                <div
                    className={`${holdSegment.base} ${holdColorClass} flex items-center justify-center overflow-hidden`}
                    style={{
                        left: clampedTransitionIn,
                        top: segmentY,
                        width: holdWidth,
                        ...holdSegment.getStyle(),
                        height: segmentHeight,
                        borderRadius: clampedTransitionIn === 0 && clampedTransitionOut === 0
                            ? SEGMENT_RADIUS
                            : clampedTransitionIn === 0
                                ? `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`
                                : clampedTransitionOut === 0
                                    ? `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`
                                    : 0,
                    }}
                >
                    {!isCollapsed && holdWidth >= MIN_ICON_WIDTH_PX && (
                        isHidden
                            ? <PiWebcamSlashBold className={blockIconClass} size={BLOCK_ICON_SIZE} />
                            : <PiWebcamBold className={blockIconClass} size={BLOCK_ICON_SIZE} />
                    )}
                </div>
            )}

            {/* Transition-out segment (right) */}
            {clampedTransitionOut > 0 && (
                <div
                    className={`${transitionSegment.base} ${transitionOutColor}`}
                    style={{
                        left: clampedTransitionIn + holdWidth,
                        top: segmentY,
                        width: clampedTransitionOut,
                        ...outStyle,
                        height: segmentHeight,
                        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
                        ...(holdWidth === 0 && clampedTransitionIn === 0 ? { borderRadius: SEGMENT_RADIUS } : {}),
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

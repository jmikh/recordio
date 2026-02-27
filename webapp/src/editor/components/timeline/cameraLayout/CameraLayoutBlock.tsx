import React from 'react';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import {
    transitionInSegment,
    transitionOutSegment,
    holdSegment,
    cameraLayoutContainer,
    resizeHandle,
    dragHandleIndicator,
    HOLD_HEIGHT,
    DRAG_HANDLE_HEIGHT,
    SEGMENT_RADIUS,
} from './CameraLayoutTrackStyles';
import { blockIconClass, BLOCK_ICON_SIZE, MIN_ICON_WIDTH_PX } from '../TimelineBlockStyles';

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
}) => {
    const clampedTransitionIn = Math.min(transitionInWidth, width / 2);
    const clampedTransitionOut = Math.min(transitionOutWidth, width / 2);
    const holdWidth = Math.max(0, width - clampedTransitionIn - clampedTransitionOut);
    const segmentY = (trackHeight - HOLD_HEIGHT) / 2;

    const transitionInColor = isSelected ? transitionInSegment.selectedClass : transitionInSegment.defaultClass;
    const transitionOutColor = isSelected ? transitionOutSegment.selectedClass : transitionOutSegment.defaultClass;
    const holdColorClass = isSelected ? holdSegment.selectedClass : holdSegment.defaultClass;

    // When no hold, round both transition ends
    const inStyle = holdWidth === 0 && clampedTransitionOut === 0
        ? { ...transitionInSegment.getStyle(), borderRadius: SEGMENT_RADIUS }
        : transitionInSegment.getStyle();
    const outStyle = holdWidth === 0 && clampedTransitionIn === 0
        ? { ...transitionOutSegment.getStyle(), borderRadius: SEGMENT_RADIUS }
        : transitionOutSegment.getStyle();

    return (
        <div
            className={`${cameraLayoutContainer.base} group ${isDragging ? cameraLayoutContainer.dragging : cameraLayoutContainer.idle} ${!isSelected ? cameraLayoutContainer.hoverClass : ''}`}
            style={{
                left: `${left}px`,
                width: `${width}px`,
                height: trackHeight,
                zIndex: isSelected ? 20 : 10,
            }}
            onMouseDown={onMouseDown}
            onClick={onClick}
        >
            {/* Transition-in segment (left) */}
            {clampedTransitionIn > 0 && (
                <div
                    className={`${transitionInSegment.base} ${transitionInColor}`}
                    style={{
                        left: 0,
                        top: segmentY,
                        width: clampedTransitionIn,
                        ...inStyle,
                        ...(holdWidth === 0 ? { borderRight: '2px solid var(--block-bg)' } : {}),
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
                        borderRadius: clampedTransitionIn === 0 && clampedTransitionOut === 0
                            ? SEGMENT_RADIUS
                            : clampedTransitionIn === 0
                                ? `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`
                                : clampedTransitionOut === 0
                                    ? `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`
                                    : 0,
                    }}
                >
                    {holdWidth >= MIN_ICON_WIDTH_PX && (
                        isHidden
                            ? <PiWebcamSlashBold className={blockIconClass('primary')} size={BLOCK_ICON_SIZE} />
                            : <PiWebcamBold className={blockIconClass('primary')} size={BLOCK_ICON_SIZE} />
                    )}
                </div>
            )}

            {/* Transition-out segment (right) */}
            {clampedTransitionOut > 0 && (
                <div
                    className={`${transitionOutSegment.base} ${transitionOutColor}`}
                    style={{
                        left: clampedTransitionIn + holdWidth,
                        top: segmentY,
                        width: clampedTransitionOut,
                        ...outStyle,
                        ...(holdWidth === 0 ? { borderLeft: '2px solid var(--block-bg)' } : {}),
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

import React, { useMemo } from 'react';
import { PiWebcamBold } from 'react-icons/pi';
import { useProjectStore, useProjectTimeline } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { useTimeMapper } from '../../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import { useTimelineSegmentDrag } from '../shared/useTimelineSegmentDrag';
import { useCameraMoveHover } from './useCameraMoveHover';
import { CameraMoveBlock } from './CameraMoveBlock';
import {
    ghostCameraMove,
    blockIconClass,
    ghostIconClass,
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
} from '../shared/TimelineBlockStyles';
import { DisabledTrackOverlay } from '../shared/DisabledTrackOverlay';
import type { CameraMoveSegment } from '../../../../../types';

interface CameraMoveTrackProps {
    height: number;
    isCollapsed?: boolean;
}

/**
 * CameraMoveTrack renders camera layout segments as time-range blocks.
 * Follows the same visual pattern as ZoomTrack: transition-in zone + hold zone.
 */
export const CameraMoveTrack: React.FC<CameraMoveTrackProps> = ({ height, isCollapsed }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    const selectedId = useUIStore(s => s.selectedCameraMoveId);
    const setSelected = (id: string | null) => {
        useUIStore.getState().selectCameraMove(id);
    };

    const project = useProjectStore(s => s.project);
    const globalTransitionDurationMs = project.settings.cameraMove?.transitionDurationMs ?? 500;
    const cameraMoveEnabled = project.settings.cameraMove?.enabled ?? true;

    const timeMapper = useTimeMapper();
    const coords = useMemo(() => new TimePixelMapper(timeMapper, pixelsPerSec), [timeMapper, pixelsPerSec]);
    const outputDuration = useMemo(() => timeMapper.getOutputDuration(), [timeMapper]);

    const segments = useMemo(() =>
        (timeline.cameraMoveSegments || []).filter((s: CameraMoveSegment) => s.visible),
        [timeline.cameraMoveSegments]);

    const ghostY = 1;

    const updateCameraMove = useProjectStore(s => s.updateCameraMove);
    const deleteCameraMove = useProjectStore(s => s.deleteCameraMove);

    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useTimelineSegmentDrag<CameraMoveSegment>({
        segments,
        outputDuration,
        coords,
        timeMapper,
        onSelect: setSelected,
        onUpdate: (id, sourceStart, sourceEnd) =>
            updateCameraMove(id, { sourceStartTimeMs: sourceStart, sourceEndTimeMs: sourceEnd }),
        onDelete: deleteCameraMove,
        getAllSegments: () => timeline.cameraMoveSegments ?? [],
    });

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useCameraMoveHover(
        project,
        coords,
        dragState,
        selectedId,
        setSelected,
        outputDuration,
        segments,
        timeMapper
    );

    return (
        <div
            className="w-full relative select-none flex"
            style={{ height }}
            onMouseMove={cameraMoveEnabled ? handleMouseMove : undefined}
            onMouseLeave={cameraMoveEnabled ? handleMouseLeave : undefined}
            onPointerDown={cameraMoveEnabled ? (e) => e.stopPropagation() : undefined}
            onClick={cameraMoveEnabled ? handleClick : undefined}
            title={!cameraMoveEnabled ? 'Enable layouts to interact' : undefined}
        >
            <div className="relative flex-1" style={{ height }}>
                {!cameraMoveEnabled && <DisabledTrackOverlay height={height} />}
                {/* Camera layout blocks */}
                {segments.map((s: CameraMoveSegment) => {
                    const startX = coords.msToX(s.outputStartTimeMs);
                    const endX = coords.msToX(s.outputEndTimeMs);
                    const blockWidth = Math.max(endX - startX, 2);

                    if (blockWidth <= 0) return null;

                    const isSelected = selectedId === s.id;
                    const isDragging = dragState?.segmentId === s.id;
                    const segTransitionWidthPx = coords.msToX(s.transitionDurationMs ?? globalTransitionDurationMs);

                    return (
                        <CameraMoveBlock
                            key={s.id}
                            left={startX}
                            width={blockWidth}
                            transitionInWidth={segTransitionWidthPx}
                            transitionOutWidth={segTransitionWidthPx}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            isHidden={s.hidden}
                            disabled={!cameraMoveEnabled}
                            isCollapsed={isCollapsed}
                            onMouseDown={(e) => handleDragStart(e, 'move', s, isSelected)}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (wasDraggingRef.current) {
                                    wasDraggingRef.current = false;
                                    return;
                                }
                                if (wasSelectedBeforeMousedownRef.current) {
                                    setSelected(null);
                                }
                            }}
                            onResizeStartMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, 'resize-start', s, isSelected);
                            }}
                            onResizeEndMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, 'resize-end', s, isSelected);
                            }}
                        />
                    );
                })}

                {/* Ghost block */}
                {cameraMoveEnabled && hoverInfo && !selectedId && !dragState && (() => {
                    const ghostTransitionWidthPx = coords.msToX(globalTransitionDurationMs);
                    const totalTransitions = ghostTransitionWidthPx * 2;
                    const clampedTransitionWidth = totalTransitions > hoverInfo.width
                        ? hoverInfo.width / 2
                        : ghostTransitionWidthPx;
                    const holdWidth = Math.max(0, hoverInfo.width - clampedTransitionWidth * 2);

                    return (
                        <div
                            className={ghostCameraMove.container}
                            style={{
                                left: `${hoverInfo.x}px`,
                                width: `${hoverInfo.width}px`,
                                height,
                            }}
                        >
                            <span className={ghostCameraMove.label}>+ Layout</span>

                            {/* Ghost transition-in */}
                            {clampedTransitionWidth > 0 && (
                                <div
                                    className={ghostCameraMove.transitionIn.className}
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: ghostY,
                                        width: clampedTransitionWidth,
                                        ...ghostCameraMove.transitionIn.getStyle(),
                                        height: height - 2,
                                        ...(holdWidth <= 0 ? { borderRight: '1px solid var(--block-bg)' } : {}),
                                    }}
                                />
                            )}

                            {/* Ghost hold */}
                            {holdWidth > 0 && (
                                <div
                                    className={`${ghostCameraMove.hold.className} flex items-center justify-center overflow-hidden`}
                                    style={{
                                        position: 'absolute',
                                        left: clampedTransitionWidth,
                                        top: ghostY,
                                        width: holdWidth,
                                        ...ghostCameraMove.hold.getStyle(),
                                        height: height - 2,
                                    }}
                                >
                                    {holdWidth >= MIN_ICON_WIDTH_PX && (
                                        <PiWebcamBold className={`${ghostIconClass} icon-md`} />
                                    )}
                                </div>
                            )}

                            {/* Ghost transition-out */}
                            {clampedTransitionWidth > 0 && (
                                <div
                                    className={ghostCameraMove.transitionOut.className}
                                    style={{
                                        position: 'absolute',
                                        right: 0,
                                        top: ghostY,
                                        width: clampedTransitionWidth,
                                        ...ghostCameraMove.transitionOut.getStyle(),
                                        height: height - 2,
                                        ...(holdWidth <= 0 ? { borderLeft: '1px solid var(--block-bg)' } : {}),
                                    }}
                                />
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

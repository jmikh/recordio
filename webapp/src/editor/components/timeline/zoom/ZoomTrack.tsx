import React, { useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useZoomDrag } from './useZoomDrag';
import { useZoomHover } from './useZoomHover';
import { ZoomBlock } from './ZoomBlock';
import { resolveZoomOutputTimes, getMinZoomDuration } from './ZoomTrackUtils';
import {
    ghostZoom,
    TRANSITION_HEIGHT,
    HOLD_HEIGHT,
    SEGMENT_RADIUS,
} from './ZoomTrackStyles';
import type { ZoomSegment } from '../../../../types';

interface ZoomTrackProps {
    height: number;
}

/**
 * ZoomTrack renders zoom segments as time-range blocks on the timeline.
 *
 * Each block has:
 * - A transition-in zone (left, transitionDurationMs wide, striped)
 * - A hold zone (rest of block, solid)
 *
 * Interactions mirror the Spotlight track: move, resize-start, resize-end,
 * ghost on hover, click to add (deleting overlapping blocks).
 */
export const ZoomTrack: React.FC<ZoomTrackProps> = ({ height }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    const editingZoomId = useUIStore(s => s.selectedZoomId);
    const setEditingZoom = (id: string | null) => {
        useUIStore.getState().selectZoom(id);
    };

    const project = useProjectStore(s => s.project);
    const { transitionDurationMs } = project.settings.zoom;

    const timeMapper = useTimeMapper();

    const coords = useMemo(() => new TimePixelMapper(timeMapper, pixelsPerSec), [timeMapper, pixelsPerSec]);
    const outputDuration = useMemo(() => timeMapper.getOutputDuration(), [timeMapper]);

    // Resolve zoom segments from source → output time, filter below min duration
    const resolvedSegments = useMemo(() => {
        const all = resolveZoomOutputTimes(timeline.zoomSegments || [], timeMapper);
        const minDuration = getMinZoomDuration(transitionDurationMs);
        return all.filter(r => (r.outputEndTimeMs - r.outputStartTimeMs) >= minDuration);
    }, [timeline.zoomSegments, timeMapper, transitionDurationMs]);

    // Transition-in width in pixels
    const transitionInWidthPx = coords.msToX(transitionDurationMs);

    // Ghost vertical positions
    const transitionY = (height - TRANSITION_HEIGHT) / 2;
    const holdY = (height - HOLD_HEIGHT) / 2;

    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useZoomDrag(
        timeline,
        project,
        coords,
        outputDuration,
        setEditingZoom,
        resolvedSegments,
        timeMapper
    );

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useZoomHover(
        timeline,
        project,
        coords,
        dragState,
        editingZoomId,
        setEditingZoom,
        outputDuration,
        resolvedSegments,
        timeMapper
    );

    return (
        <div
            className="w-full relative select-none flex"
            style={{ height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleClick}
        >
            <div className="relative flex-1" style={{ height }}>

                {/* Zoom blocks */}
                {resolvedSegments.map((r) => {
                    const startX = coords.msToX(r.outputStartTimeMs);
                    const endX = coords.msToX(r.outputEndTimeMs);
                    const blockWidth = Math.max(endX - startX, 2);

                    if (blockWidth <= 0) return null;

                    const isSelected = editingZoomId === r.zoomSegment.id;
                    const isDragging = dragState?.zoomId === r.zoomSegment.id;

                    const originalSegment = (timeline.zoomSegments as ZoomSegment[]).find(a => a.id === r.zoomSegment.id);
                    if (!originalSegment) return null;

                    return (
                        <ZoomBlock
                            key={r.zoomSegment.id}
                            left={startX}
                            width={blockWidth}
                            transitionInWidth={transitionInWidthPx}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            onMouseDown={(e) => handleDragStart(e, 'move', originalSegment, isSelected)}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (wasDraggingRef.current) {
                                    wasDraggingRef.current = false;
                                    return;
                                }
                                if (wasSelectedBeforeMousedownRef.current) {
                                    setEditingZoom(null);
                                }
                            }}
                            onResizeStartMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, 'resize-start', originalSegment, isSelected);
                            }}
                            onResizeEndMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, 'resize-end', originalSegment, isSelected);
                            }}
                        />
                    );
                })}

                {/* Ghost block — shown when hovering to add a new zoom */}
                {hoverInfo && !editingZoomId && !dragState && (() => {
                    const clampedTransitionWidth = Math.min(transitionInWidthPx, hoverInfo.width);
                    const holdWidth = Math.max(0, hoverInfo.width - clampedTransitionWidth);

                    return (
                        <div
                            className={ghostZoom.container}
                            style={{
                                left: `${hoverInfo.x}px`,
                                width: `${hoverInfo.width}px`,
                                height,
                            }}
                        >
                            <span className={ghostZoom.label}>+ Zoom</span>

                            {/* Ghost transition-in */}
                            {clampedTransitionWidth > 0 && (
                                <div
                                    className={ghostZoom.transitionIn.className}
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: transitionY,
                                        width: clampedTransitionWidth,
                                        ...ghostZoom.transitionIn.getStyle(),
                                    }}
                                />
                            )}

                            {/* Ghost hold */}
                            {holdWidth > 0 && (
                                <div
                                    className={ghostZoom.hold.className}
                                    style={{
                                        position: 'absolute',
                                        left: clampedTransitionWidth,
                                        top: holdY,
                                        width: holdWidth,
                                        ...ghostZoom.hold.getStyle(),
                                        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
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

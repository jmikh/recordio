import React, { useMemo } from 'react';
import { LuZoomIn } from 'react-icons/lu';
import { useProjectStore, useProjectTimeline } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { useTimeMapper } from '../../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import { useTimelineSegmentDrag } from '../shared/useTimelineSegmentDrag';
import { useZoomHover } from './useZoomHover';
import { ZoomBlock } from './ZoomBlock';
import { K_MIN_ZOOM_HOLD_MS } from './ZoomTrackUtils';
import {
    ghostZoom,
    ghostIconClass,
    MIN_ICON_WIDTH_PX,
} from '../shared/TimelineBlockStyles';
import { DisabledTrackOverlay } from '../shared/DisabledTrackOverlay';
import type { ZoomSegment } from '@shared/types';

interface ZoomTrackProps {
    height: number;
    isCollapsed?: boolean;
}

/**
 * ZoomTrack renders zoom segments as time-range blocks on the timeline.
 *
 * Each block is a single solid segment (the zoom-in ramp is part of the block,
 * labelled with its zoom factor), followed by a zoom-out indicator in the gap.
 *
 * Interactions mirror the Spotlight track: move, resize-start, resize-end,
 * ghost on hover, click to add (deleting overlapping blocks).
 */
export const ZoomTrack: React.FC<ZoomTrackProps> = ({ height, isCollapsed }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    const editingZoomId = useUIStore(s => s.selectedZoomId);
    const setEditingZoom = (id: string | null) => {
        useUIStore.getState().selectZoom(id);
    };

    const project = useProjectStore(s => s.project);
    const { transitionDurationMs: globalTransitionDurationMs } = project.settings.zoom;
    const outputWidth = project.settings.outputSize.width;
    const zoomEnabled = project.settings.zoom.enabled ?? true;

    const timeMapper = useTimeMapper();

    const coords = useMemo(() => new TimePixelMapper(timeMapper, pixelsPerSec), [timeMapper, pixelsPerSec]);
    const outputDuration = useMemo(() => timeMapper.getOutputDuration(), [timeMapper]);

    // Filter zoom segments: only show visible ones
    const zoomSegments = useMemo(() =>
        (timeline.zoomSegments || []).filter((s: ZoomSegment) => s.visible),
        [timeline.zoomSegments]);


    // Ghost vertical position — 1px padding
    const ghostY = 1;

    const updateZoomSegment = useProjectStore(s => s.updateZoomSegment);
    const deleteZoomSegment = useProjectStore(s => s.deleteZoomSegment);

    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useTimelineSegmentDrag<ZoomSegment>({
        segments: zoomSegments,
        outputDuration,
        coords,
        timeMapper,
        onSelect: setEditingZoom,
        onUpdate: (id, sourceStart, sourceEnd) =>
            updateZoomSegment(id, { sourceStartTimeMs: sourceStart, sourceEndTimeMs: sourceEnd, type: 'manual' }),
        onDelete: deleteZoomSegment,
        getAllSegments: () => timeline.zoomSegments ?? [],
    });

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useZoomHover(
        timeline,
        project,
        coords,
        dragState,
        editingZoomId,
        setEditingZoom,
        outputDuration,
        zoomSegments,
        timeMapper
    );

    // Compute zoom-out gap ranges (the implicit ease back to full viewport).
    // Gaps are clipped to avoid overlapping the ghost "+" indicator.
    const zoomOutWidthMap = useMemo(() => {
        const widthMap = new Map<string, number>();
        // Ghost start time — clip zoom-out blocks here when ghost is visible
        const ghostStartMs = (hoverInfo && !editingZoomId && !dragState)
            ? hoverInfo.outputStartTimeMs : null;

        for (let i = 0; i < zoomSegments.length; i++) {
            const block = zoomSegments[i];
            const blockT = block.transitionDurationMs ?? globalTransitionDurationMs;
            const gapStart = block.outputEndTimeMs;
            const nextBlock = zoomSegments[i + 1];
            let gapEnd = Math.min(
                gapStart + blockT,
                nextBlock ? nextBlock.outputStartTimeMs : outputDuration
            );
            // Clip or hide the gap when the ghost overlaps it
            if (ghostStartMs !== null && ghostStartMs < gapEnd) {
                if (ghostStartMs <= gapStart) {
                    // Ghost starts at or before the gap — hide entirely
                    continue;
                }
                // Ghost starts within the gap — clip the end
                gapEnd = ghostStartMs;
            }
            if (gapEnd > gapStart) {
                const width = coords.msToX(gapEnd - gapStart);
                if (width > 0) {
                    widthMap.set(block.id, width);
                }
            }
        }
        return widthMap;
    }, [zoomSegments, globalTransitionDurationMs, outputDuration, coords, hoverInfo, editingZoomId, dragState]);

    return (
        <div
            className="w-full relative select-none flex"
            style={{ height }}
            onMouseMove={zoomEnabled ? handleMouseMove : undefined}
            onMouseLeave={zoomEnabled ? handleMouseLeave : undefined}
            onPointerDown={zoomEnabled ? (e) => e.stopPropagation() : undefined}
            onClick={zoomEnabled ? handleClick : undefined}
            title={!zoomEnabled ? 'Enable zooms to interact' : undefined}
        >
            <div className="relative flex-1" style={{ height }}>
                {!zoomEnabled && <DisabledTrackOverlay height={height} />}


                {/* Zoom blocks */}
                {zoomSegments.map((s) => {
                    const startX = coords.msToX(s.outputStartTimeMs);
                    const endX = coords.msToX(s.outputEndTimeMs);
                    const blockWidth = Math.max(endX - startX, 2);

                    if (blockWidth <= 0) return null;

                    const isSelected = editingZoomId === s.id;
                    const isDragging = dragState?.segmentId === s.id;

                    return (
                        <ZoomBlock
                            key={s.id}
                            left={startX}
                            width={blockWidth}
                            zoomFactor={outputWidth / s.rectPx.width}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            hasZoomOut={zoomOutWidthMap.has(s.id)}
                            zoomOutWidth={zoomOutWidthMap.get(s.id) ?? 0}
                            disabled={!zoomEnabled}
                            isCollapsed={isCollapsed}
                            onMouseDown={(e) => handleDragStart(e, 'move', s, isSelected)}
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
                                handleDragStart(e, 'resize-start', s, isSelected);
                            }}
                            onResizeEndMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, 'resize-end', s, isSelected);
                            }}
                        />
                    );
                })}

                {/* Ghost block — shown when hovering to add a new zoom */}
                {zoomEnabled && hoverInfo && !editingZoomId && !dragState && (
                    <div
                        className={ghostZoom.container}
                        style={{
                            left: `${hoverInfo.x}px`,
                            width: `${hoverInfo.width}px`,
                            height,
                        }}
                    >
                        <span className={ghostZoom.label}>+ Zoom</span>

                        <div
                            className={`${ghostZoom.block.className} flex items-center justify-center overflow-hidden`}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: ghostY,
                                width: hoverInfo.width,
                                ...ghostZoom.block.getStyle(),
                                height: height - 2,
                            }}
                        >
                            {hoverInfo.width >= MIN_ICON_WIDTH_PX && (
                                <LuZoomIn className={`${ghostIconClass} icon-md`} />
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

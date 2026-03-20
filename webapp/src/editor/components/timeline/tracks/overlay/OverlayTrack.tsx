import React, { useMemo } from 'react';
import { LuLayers3 } from 'react-icons/lu';
import { useProjectStore, useProjectTimeline } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { useTimeMapper } from '../../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import { useTimelineSegmentDrag } from '../shared/useTimelineSegmentDrag';
import { useOverlayHover } from './useOverlayHover';
import { OverlayBlock } from './OverlayBlock';
import {
    ghostContainerBase,
    ghostLabel,
    blockBorder,
    ghostIconClass,
    BLOCK_ICON_SIZE,
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
    holdShapeBase,
} from '../shared/TimelineBlockStyles';
import { DisabledTrackOverlay } from '../shared/DisabledTrackOverlay';
import type { OverlaySegment } from '../../../../../types/overlay';

interface OverlayTrackProps {
    height: number;
    isCollapsed?: boolean;
}

/**
 * OverlayTrack renders overlay annotation blocks on the timeline.
 * Blocks are non-overlapping and can contain multiple overlay items.
 */
export const OverlayTrack: React.FC<OverlayTrackProps> = ({ height, isCollapsed }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    const selectedId = useUIStore(s => s.selectedOverlaySegmentId);
    const setSelected = (id: string | null) => {
        useUIStore.getState().selectOverlaySegment(id);
    };

    const overlayEnabled = useProjectStore(s => s.project.settings.overlay?.enabled ?? true);

    const timeMapper = useTimeMapper();
    const coords = useMemo(() => new TimePixelMapper(timeMapper, pixelsPerSec), [timeMapper, pixelsPerSec]);
    const outputDuration = useMemo(() => timeMapper.getOutputDuration(), [timeMapper]);

    const segments = useMemo(() =>
        (timeline.overlaySegments || []).filter((b: OverlaySegment) => b.visible),
        [timeline.overlaySegments]);

    const updateOverlaySegment = useProjectStore(s => s.updateOverlaySegment);
    const deleteOverlaySegment = useProjectStore(s => s.deleteOverlaySegment);

    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useTimelineSegmentDrag<OverlaySegment>({
        segments,
        outputDuration,
        coords,
        timeMapper,
        onSelect: setSelected,
        onUpdate: (id, sourceStart, sourceEnd) =>
            updateOverlaySegment(id, { sourceStartTimeMs: sourceStart, sourceEndTimeMs: sourceEnd }),
        onDelete: deleteOverlaySegment,
        getAllSegments: () => timeline.overlaySegments ?? [],
    });

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useOverlayHover(
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
            onMouseMove={overlayEnabled ? handleMouseMove : undefined}
            onMouseLeave={overlayEnabled ? handleMouseLeave : undefined}
            onPointerDown={overlayEnabled ? (e) => e.stopPropagation() : undefined}
            onClick={overlayEnabled ? handleClick : undefined}
            title={!overlayEnabled ? 'Enable overlays to interact' : undefined}
        >
            <div className="relative flex-1" style={{ height }}>
                {!overlayEnabled && <DisabledTrackOverlay height={height} />}

                {/* Overlay blocks */}
                {segments.map((b: OverlaySegment) => {
                    const startX = coords.msToX(b.outputStartTimeMs);
                    const endX = coords.msToX(b.outputEndTimeMs);
                    const blockWidth = Math.max(endX - startX, 2);

                    if (blockWidth <= 0) return null;

                    const isSelected = selectedId === b.id;
                    const isDragging = dragState?.segmentId === b.id;

                    return (
                        <OverlayBlock
                            key={b.id}
                            left={startX}
                            width={blockWidth}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            itemCount={b.items.length}
                            disabled={!overlayEnabled}
                            isCollapsed={isCollapsed}
                            onMouseDown={(e) => handleDragStart(e, 'move', b, isSelected)}
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
                                handleDragStart(e, 'resize-start', b, isSelected);
                            }}
                            onResizeEndMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, 'resize-end', b, isSelected);
                            }}
                        />
                    );
                })}

                {/* Ghost block */}
                {overlayEnabled && hoverInfo && !selectedId && !dragState && (() => {
                    return (
                        <div
                            className={ghostContainerBase}
                            style={{
                                left: `${hoverInfo.x}px`,
                                width: `${hoverInfo.width}px`,
                                height,
                            }}
                        >
                            <span className={ghostLabel}>+ Overlay</span>
                            <div
                                className={`${blockBorder.base} flex items-center justify-center overflow-hidden`}
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 1,
                                    width: '100%',
                                    ...holdShapeBase(height - 2),
                                    borderRadius: SEGMENT_RADIUS,
                                }}
                            >
                                {hoverInfo.width >= MIN_ICON_WIDTH_PX && (
                                    <LuLayers3 className={ghostIconClass} size={BLOCK_ICON_SIZE} />
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

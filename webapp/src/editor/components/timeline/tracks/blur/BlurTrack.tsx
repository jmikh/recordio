import React, { useMemo } from 'react';
import { TbBlur } from 'react-icons/tb';
import { useProjectStore, useProjectTimeline } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { useTimeMapper } from '../../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import { useTimelineSegmentDrag } from '../shared/useTimelineSegmentDrag';
import { useBlurHover } from './useBlurHover';
import { BlurBlock } from './BlurBlock';
import {
    ghostContainerBase,
    ghostLabel,
    ghostBlock,
    ghostIconClass,
    MIN_ICON_WIDTH_PX,
    trackBlockColor,
} from '../shared/TimelineBlockStyles';
import { DisabledTrackOverlay } from '../shared/DisabledTrackOverlay';
import type { BlurSegment } from '@shared/types';

interface BlurTrackProps {
    height: number;
    isCollapsed?: boolean;
}

/**
 * BlurTrack renders blur segments as non-overlapping time-range blocks.
 * Each block blurs one or more regions, edited on the canvas when selected.
 */
export const BlurTrack: React.FC<BlurTrackProps> = ({ height, isCollapsed }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    const selectedId = useUIStore(s => s.selectedBlurSegmentId);
    const setSelected = (id: string | null) => {
        useUIStore.getState().selectBlurSegment(id);
    };

    const blurEnabled = useProjectStore(s => s.project.settings.blur?.enabled ?? true);

    const timeMapper = useTimeMapper();
    const coords = useMemo(() => new TimePixelMapper(timeMapper, pixelsPerSec), [timeMapper, pixelsPerSec]);
    const outputDuration = useMemo(() => timeMapper.getOutputDuration(), [timeMapper]);

    const segments = useMemo(() =>
        (timeline.blurSegments || []).filter((s: BlurSegment) => s.visible),
        [timeline.blurSegments]);

    const updateBlurSegment = useProjectStore(s => s.updateBlurSegment);
    const deleteBlurSegment = useProjectStore(s => s.deleteBlurSegment);

    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useTimelineSegmentDrag<BlurSegment>({
        segments,
        outputDuration,
        coords,
        timeMapper,
        onSelect: setSelected,
        onUpdate: (id, sourceStart, sourceEnd) =>
            updateBlurSegment(id, { sourceStartTimeMs: sourceStart, sourceEndTimeMs: sourceEnd }),
        onDelete: deleteBlurSegment,
        getAllSegments: () => timeline.blurSegments ?? [],
    });

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useBlurHover(
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
            onMouseMove={blurEnabled ? handleMouseMove : undefined}
            onMouseLeave={blurEnabled ? handleMouseLeave : undefined}
            onPointerDown={blurEnabled ? (e) => e.stopPropagation() : undefined}
            onClick={blurEnabled ? handleClick : undefined}
            title={!blurEnabled ? 'Enable blur to interact' : undefined}
        >
            <div className="relative flex-1" style={{ height }}>
                {!blurEnabled && <DisabledTrackOverlay height={height} />}

                {/* Blur blocks */}
                {segments.map((s: BlurSegment) => {
                    const startX = coords.msToX(s.outputStartTimeMs);
                    const endX = coords.msToX(s.outputEndTimeMs);
                    const blockWidth = Math.max(endX - startX, 2);

                    if (blockWidth <= 0) return null;

                    const isSelected = selectedId === s.id;
                    const isDragging = dragState?.segmentId === s.id;

                    return (
                        <BlurBlock
                            key={s.id}
                            left={startX}
                            width={blockWidth}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            regionCount={s.regions.length}
                            disabled={!blurEnabled}
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
                {blurEnabled && hoverInfo && !selectedId && !dragState && (
                    <div
                        className={`${ghostContainerBase} ${trackBlockColor.blur.base}`}
                        style={{
                            left: `${hoverInfo.x}px`,
                            width: `${hoverInfo.width}px`,
                            height,
                        }}
                    >
                        <span className={ghostLabel}>+ Blur</span>
                        <div
                            className={`${ghostBlock.className} flex items-center justify-center overflow-hidden`}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 1,
                                width: '100%',
                                ...ghostBlock.getStyle(),
                                height: height - 2,
                            }}
                        >
                            {hoverInfo.width >= MIN_ICON_WIDTH_PX && (
                                <TbBlur className={`${ghostIconClass} icon-md`} />
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

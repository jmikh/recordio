import React, { useMemo, useRef, useCallback } from 'react';
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
    MIN_ICON_WIDTH_PX,
    SEGMENT_RADIUS,
    holdShapeBase,
} from '../shared/TimelineBlockStyles';
import { DisabledTrackOverlay } from '../shared/DisabledTrackOverlay';
import type { OverlaySegment } from '@shared/types/overlay';

interface OverlayTrackProps {
    height: number;
    isCollapsed?: boolean;
}

/**
 * OverlayTrack renders overlay annotation blocks on the timeline.
 * Each block contains a single overlay item. Blocks may overlap.
 * Shorter blocks appear on top. Click cycling selects through overlapping blocks.
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

    // Click cycling: track which segment index was last selected at a given click spot
    const lastCycleRef = useRef<{ ids: string[]; index: number }>({ ids: [], index: -1 });
    const trackContainerRef = useRef<HTMLDivElement>(null);

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
        allowOverlap: true,
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

    /**
     * Sort segments by duration descending so shorter segments have higher z-index.
     * Returns segments with computed z-indices.
     */
    const sortedSegments = useMemo(() => {
        return segments
            .map(b => ({
                segment: b,
                duration: b.outputEndTimeMs - b.outputStartTimeMs,
            }))
            .sort((a, b) => b.duration - a.duration) // longest first = lowest z
            .map((entry, i) => ({
                ...entry,
                zIndex: 10 + i, // short segments get higher z
            }));
    }, [segments]);

    /**
     * Find all segments that overlap a given output time, ordered by z-index (highest first = shortest first).
     */
    const getSegmentsAtTime = useCallback((outputTimeMs: number) => {
        return sortedSegments
            .filter(({ segment: b }) =>
                outputTimeMs >= b.outputStartTimeMs && outputTimeMs <= b.outputEndTimeMs
            )
            .sort((a, b) => b.zIndex - a.zIndex); // highest z first
    }, [sortedSegments]);

    /**
     * Compute overlap counts for each segment (number of other segments sharing any time point).
     */
    const overlapCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const { segment: a } of sortedSegments) {
            let count = 0;
            for (const { segment: b } of sortedSegments) {
                if (a.id === b.id) continue;
                if (a.outputStartTimeMs < b.outputEndTimeMs && a.outputEndTimeMs > b.outputStartTimeMs) {
                    count++;
                }
            }
            counts.set(a.id, count);
        }
        return counts;
    }, [sortedSegments]);

    /**
     * Handle click cycling through overlapping segments.
     */
    const handleBlockClick = useCallback((e: React.MouseEvent, clickedId: string) => {
        e.stopPropagation();
        if (wasDraggingRef.current) {
            wasDraggingRef.current = false;
            return;
        }

        // Use the actual click position to find overlapping segments at that point
        const container = trackContainerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickTimeMs = coords.xToMs(clickX);
        const overlapping = getSegmentsAtTime(clickTimeMs);
        const ids = overlapping.map(o => o.segment.id);

        if (ids.length <= 1) {
            // Only deselect if the block was already selected before this mousedown
            if (selectedId === clickedId && wasSelectedBeforeMousedownRef.current) {
                setSelected(null);
                lastCycleRef.current = { ids: [], index: -1 };
            } else {
                setSelected(clickedId);
                lastCycleRef.current = { ids, index: 0 };
            }
            return;
        }

        // Multiple overlapping: cycle through
        const prevCycle = lastCycleRef.current;
        const sameGroup = prevCycle.ids.length === ids.length && prevCycle.ids.every((id, i) => id === ids[i]);

        if (sameGroup && selectedId !== null) {
            const nextIndex = prevCycle.index + 1;
            if (nextIndex < ids.length) {
                // Select next segment in stack
                setSelected(ids[nextIndex]);
                lastCycleRef.current = { ids, index: nextIndex };
            } else {
                // Cycled through all — deselect
                setSelected(null);
                lastCycleRef.current = { ids, index: -1 };
            }
        } else if (!sameGroup || selectedId === null) {
            // Start new cycle — select topmost (first in sorted list = highest z)
            setSelected(ids[0]);
            lastCycleRef.current = { ids, index: 0 };
        }
    }, [segments, selectedId, getSegmentsAtTime, setSelected, wasDraggingRef]);

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
            <div ref={trackContainerRef} className="relative flex-1" style={{ height }}>
                {!overlayEnabled && <DisabledTrackOverlay height={height} />}

                {/* Overlay blocks — z-ordered by duration */}
                {sortedSegments.map(({ segment: b, zIndex }) => {
                    const startX = coords.msToX(b.outputStartTimeMs);
                    const endX = coords.msToX(b.outputEndTimeMs);
                    const blockWidth = Math.max(endX - startX, 2);

                    if (blockWidth <= 0) return null;

                    const isSelected = selectedId === b.id;
                    const isDragging = dragState?.segmentId === b.id;
                    const overlapCount = overlapCounts.get(b.id) ?? 0;

                    return (
                        <OverlayBlock
                            key={b.id}
                            left={startX}
                            width={blockWidth}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            itemType={b.item.type}
                            overlapCount={overlapCount}
                            disabled={!overlayEnabled}
                            isCollapsed={isCollapsed}
                            zIndex={isSelected ? 100 : zIndex}
                            onMouseDown={(e) => handleDragStart(e, 'move', b, isSelected)}
                            onClick={(e) => handleBlockClick(e, b.id)}
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
                                    <LuLayers3 className={`${ghostIconClass} icon-md`} />
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

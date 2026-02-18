import { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useHistoryBatcher } from '../../../hooks/useHistoryBatcher';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { ZoomSegment } from '../../../../types';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';
import { getBlockBounds, getMinZoomDuration, doSourceRangesOverlap, type ResolvedZoomSegment } from './ZoomTrackUtils';

export interface DragState {
    type: 'move' | 'resize-start' | 'resize-end';
    zoomId: string;
    startX: number;
    /** Output-time positions at drag start */
    initialStartTimeMs: number;
    initialEndTimeMs: number;
}

export function useZoomDrag(
    timeline: any,
    project: any,
    coords: TimePixelMapper,
    outputDuration: number,
    setEditingZoom: (id: string | null) => void,
    resolvedSegments: ResolvedZoomSegment[],
    timeMapper: TimeMapper
) {
    const updateZoomSegment = useProjectStore(s => s.updateZoomSegment);
    const deleteZoomSegment = useProjectStore(s => s.deleteZoomSegment);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const [dragState, setDragState] = useState<DragState | null>(null);
    const wasDraggingRef = useRef(false);
    const wasSelectedBeforeMousedownRef = useRef(false);

    const handleDragStart = (
        e: React.MouseEvent,
        type: DragState['type'],
        segment: ZoomSegment,
        isCurrentlySelected: boolean
    ) => {
        e.stopPropagation();

        wasDraggingRef.current = false;
        wasSelectedBeforeMousedownRef.current = isCurrentlySelected;

        const range = timeMapper.mapSourceRangeToOutputRange(segment.sourceStartTimeMs, segment.sourceEndTimeMs);
        if (!range) return;

        setDragState({
            type,
            zoomId: segment.id,
            startX: e.clientX,
            initialStartTimeMs: range.start,
            initialEndTimeMs: range.end,
        });
        startInteraction();
        setEditingZoom(segment.id);

        if (type === 'resize-end') {
            setCurrentTime(range.end);
        } else {
            setCurrentTime(range.start);
        }
    };

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaTimeMs = coords.xToMs(deltaX);

        const { prevEnd, nextStart } = getBlockBounds(dragState.zoomId, resolvedSegments, outputDuration);
        const { transitionDurationMs } = project.settings.zoom;
        const minDuration = getMinZoomDuration(transitionDurationMs);

        let newStart = dragState.initialStartTimeMs;
        let newEnd = dragState.initialEndTimeMs;
        const currentDuration = newEnd - newStart;

        if (dragState.type === 'move') {
            newStart = dragState.initialStartTimeMs + deltaTimeMs;
            newEnd = dragState.initialEndTimeMs + deltaTimeMs;

            // Clamp to neighbors
            if (newStart < prevEnd) { newStart = prevEnd; newEnd = newStart + currentDuration; }
            if (newEnd > nextStart) { newEnd = nextStart; newStart = newEnd - currentDuration; }
            if (newStart < 0) { newStart = 0; newEnd = currentDuration; }
            if (newEnd > outputDuration) { newEnd = outputDuration; newStart = newEnd - currentDuration; }
        } else if (dragState.type === 'resize-start') {
            newStart = dragState.initialStartTimeMs + deltaTimeMs;
            newStart = Math.max(newStart, prevEnd);
            newStart = Math.min(newStart, newEnd - minDuration);
        } else if (dragState.type === 'resize-end') {
            newEnd = dragState.initialEndTimeMs + deltaTimeMs;
            newEnd = Math.min(newEnd, nextStart, outputDuration);
            newEnd = Math.max(newEnd, newStart + minDuration);
        }

        wasDraggingRef.current = true;

        const sourceStart = timeMapper.mapOutputToSourceTime(newStart);
        const sourceEnd = timeMapper.mapOutputToSourceTime(newEnd);

        batchAction(() => updateZoomSegment(dragState.zoomId, {
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd,
            type: 'manual',
        }));

        if (dragState.type === 'resize-end') {
            setCurrentTime(newEnd);
        } else {
            setCurrentTime(newStart);
        }
    }, [dragState, coords, updateZoomSegment, resolvedSegments, batchAction, outputDuration, setCurrentTime, timeMapper, project.settings.zoom]);

    const handleGlobalMouseUp = useCallback(() => {
        if (dragState) {
            // On move commit: delete any zoom segments that now overlap (source time)
            if (dragState.type === 'move' && wasDraggingRef.current) {
                const allSegments: ZoomSegment[] = timeline.zoomSegments || [];
                const movedSegment = allSegments.find((a: ZoomSegment) => a.id === dragState.zoomId);
                if (movedSegment) {
                    for (const existing of allSegments) {
                        if (existing.id === dragState.zoomId) continue;
                        if (doSourceRangesOverlap(movedSegment, existing)) {
                            deleteZoomSegment(existing.id);
                        }
                    }
                }
            }

            setDragState(null);
            endInteraction();
        }
    }, [dragState, endInteraction, timeline, deleteZoomSegment]);

    useEffect(() => {
        if (dragState) {
            window.addEventListener('mousemove', handleGlobalMouseMove);
            window.addEventListener('mouseup', handleGlobalMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleGlobalMouseMove);
                window.removeEventListener('mouseup', handleGlobalMouseUp);
            };
        }
    }, [dragState, handleGlobalMouseMove, handleGlobalMouseUp]);

    return {
        dragState,
        handleDragStart,
        wasDraggingRef,
        wasSelectedBeforeMousedownRef,
    };
}

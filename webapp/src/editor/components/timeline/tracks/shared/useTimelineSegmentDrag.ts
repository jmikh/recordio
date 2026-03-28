import { useState, useCallback, useEffect, useRef } from 'react';
import { useUIStore } from '../../../../stores/useUIStore';
import { useHistoryBatcher } from '../../../../hooks/useHistoryBatcher';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import type { TimeSegment } from '../../../../../types';
import { getBlockBounds, doSourceRangesOverlap } from './timelineTrackUtils';
import type { TimeMapper } from '../../../../../core/mappers/timeMapper';

// ============================================================================
// SHARED TIMELINE SEGMENT DRAG
// Generic drag hook for Zoom, Spotlight, and Caption tracks.
// All time values are in OUTPUT TIME unless noted.
// ============================================================================

/** Minimum duration in ms for any timeline block. If a block starts a drag
 *  already below this threshold, its initial duration is used as the floor
 *  instead (to avoid forcing growth of already-shrunken segments). */
export const K_MIN_TIMELINE_BLOCK_MS = 500;
export const K_DEFAULT_TIMELINE_BLOCK_MS = 3000;

export interface TimelineSegmentDragState {
    type: 'move' | 'resize-start' | 'resize-end';
    segmentId: string;
    startX: number;
    /** Output-time positions at drag start */
    initialStartTimeMs: number;
    initialEndTimeMs: number;
    /** Resolved min duration for this drag (may be < K_MIN_TIMELINE_BLOCK_MS
     *  if the segment was already undersized at drag start) */
    minDuration: number;

}

export interface UseTimelineSegmentDragConfig<T extends TimeSegment> {
    segments: T[];
    outputDuration: number;
    coords: TimePixelMapper;
    timeMapper: TimeMapper;
    onSelect: (id: string) => void;
    onUpdate: (id: string, sourceStart: number, sourceEnd: number) => void;
    onDelete: (id: string) => void;
    getAllSegments: () => T[];
    /** When true, segments can overlap — skip neighbor clamping and collision deletion */
    allowOverlap?: boolean;
}

export function useTimelineSegmentDrag<T extends TimeSegment>({
    segments,
    outputDuration,
    coords,
    timeMapper,
    onSelect,
    onUpdate,
    onDelete,
    getAllSegments,
    allowOverlap,
}: UseTimelineSegmentDragConfig<T>) {
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const [dragState, setDragState] = useState<TimelineSegmentDragState | null>(null);
    const wasDraggingRef = useRef(false);
    const wasSelectedBeforeMousedownRef = useRef(false);
    const allowOverlapRef = useRef(allowOverlap ?? false);
    allowOverlapRef.current = allowOverlap ?? false;

    const handleDragStart = (
        e: React.MouseEvent,
        type: TimelineSegmentDragState['type'],
        segment: T,
        isCurrentlySelected: boolean
    ) => {
        e.stopPropagation();

        wasDraggingRef.current = false;
        wasSelectedBeforeMousedownRef.current = isCurrentlySelected;

        if (!segment.visible) return;

        const initialDuration = segment.outputEndTimeMs - segment.outputStartTimeMs;
        const minDuration = Math.min(K_MIN_TIMELINE_BLOCK_MS, initialDuration);

        setDragState({
            type,
            segmentId: segment.id,
            startX: e.clientX,
            initialStartTimeMs: segment.outputStartTimeMs,
            initialEndTimeMs: segment.outputEndTimeMs,
            minDuration,
        });
        startInteraction();
        onSelect(segment.id);

        // Sync CTI: end edge for resize-end, start edge for everything else
        if (type === 'resize-end') {
            setCurrentTime(segment.outputEndTimeMs);
        } else {
            setCurrentTime(segment.outputStartTimeMs);
        }
    };

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaTimeMs = coords.xToMs(deltaX);

        let newStart = dragState.initialStartTimeMs;
        let newEnd = dragState.initialEndTimeMs;
        const currentDuration = newEnd - newStart;
        const { minDuration } = dragState;

        if (allowOverlapRef.current) {
            // Free movement — only clamp to [0, outputDuration]
            if (dragState.type === 'move') {
                newStart = dragState.initialStartTimeMs + deltaTimeMs;
                newEnd = dragState.initialEndTimeMs + deltaTimeMs;
                if (newStart < 0) { newStart = 0; newEnd = currentDuration; }
                if (newEnd > outputDuration) { newEnd = outputDuration; newStart = newEnd - currentDuration; }
            } else if (dragState.type === 'resize-start') {
                newStart = dragState.initialStartTimeMs + deltaTimeMs;
                newStart = Math.max(newStart, 0);
                newStart = Math.min(newStart, newEnd - minDuration);
            } else if (dragState.type === 'resize-end') {
                newEnd = dragState.initialEndTimeMs + deltaTimeMs;
                newEnd = Math.min(newEnd, outputDuration);
                newEnd = Math.max(newEnd, newStart + minDuration);
            }
        } else {
            const { prevEnd, nextStart } = getBlockBounds(
                dragState.segmentId,
                segments,
                outputDuration
            );

            if (dragState.type === 'move') {
                newStart = dragState.initialStartTimeMs + deltaTimeMs;
                newEnd = dragState.initialEndTimeMs + deltaTimeMs;

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
        }

        wasDraggingRef.current = true;

        const sourceStart = timeMapper.mapOutputToSourceTime(newStart);
        const sourceEnd = timeMapper.mapOutputToSourceTime(newEnd);
        batchAction(() => onUpdate(dragState.segmentId, sourceStart, sourceEnd));

        // Sync CTI: end edge for resize-end, start edge for move and resize-start
        if (dragState.type === 'resize-end') {
            setCurrentTime(newEnd);
        } else {
            setCurrentTime(newStart);
        }
    }, [dragState, coords, segments, outputDuration, timeMapper, batchAction, onUpdate, setCurrentTime]);

    const handleGlobalMouseUp = useCallback(() => {
        if (!dragState) return;

        if (wasDraggingRef.current && !allowOverlapRef.current) {
            const all = getAllSegments();
            const moved = all.find(s => s.id === dragState.segmentId);
            if (moved) {
                for (const existing of all) {
                    if (existing.id === dragState.segmentId) continue;
                    if (doSourceRangesOverlap(moved, existing)) {
                        onDelete(existing.id);
                    }
                }
            }
        }

        setDragState(null);
        endInteraction();
    }, [dragState, endInteraction, getAllSegments, onDelete]);

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

import { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useHistoryBatcher } from '../../../hooks/useHistoryBatcher';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { CaptionSegment } from '../../../../types';
import { getBlockBounds, doSourceRangesOverlap, type OutputCaptionSegment } from '../timelineTrackUtils';
import { K_MIN_CAPTION_DURATION_MS } from './CaptionTrackUtils';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';

export interface CaptionDragState {
    type: 'move' | 'resize-start' | 'resize-end';
    captionId: string;
    startX: number;
    /** Output-time positions at drag start (resolved from source) */
    initialStartTimeMs: number;
    initialEndTimeMs: number;
}

export function useCaptionDrag(
    timeline: any,
    coords: TimePixelMapper,
    outputDuration: number,
    selectCaption: (id: string | null) => void,
    resolvedCaptions: OutputCaptionSegment[],
    timeMapper: TimeMapper
) {
    const updateCaptionSegment = useProjectStore(s => s.updateCaptionSegment);
    const deleteCaptionSegment = useProjectStore(s => s.deleteCaptionSegment);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const [dragState, setDragState] = useState<CaptionDragState | null>(null);

    const wasDraggingRef = useRef(false);
    const wasSelectedBeforeMousedownRef = useRef(false);

    const handleDragStart = (
        e: React.MouseEvent,
        type: CaptionDragState['type'],
        segment: CaptionSegment,
        isCurrentlySelected: boolean
    ) => {
        e.stopPropagation();

        wasDraggingRef.current = false;
        wasSelectedBeforeMousedownRef.current = isCurrentlySelected;

        const range = timeMapper.mapSourceRangeToOutputRange(segment.sourceStartTimeMs, segment.sourceEndTimeMs);
        if (!range) return;

        setDragState({
            type,
            captionId: segment.id,
            startX: e.clientX,
            initialStartTimeMs: range.start,
            initialEndTimeMs: range.end,
        });
        startInteraction();
        selectCaption(segment.id);

        // Sync CTI to appropriate edge
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

        const { prevEnd, nextStart } = getBlockBounds(
            dragState.captionId,
            resolvedCaptions,
            outputDuration
        );

        let newStart = dragState.initialStartTimeMs;
        let newEnd = dragState.initialEndTimeMs;
        const currentDuration = newEnd - newStart;

        if (dragState.type === 'move') {
            newStart = dragState.initialStartTimeMs + deltaTimeMs;
            newEnd = dragState.initialEndTimeMs + deltaTimeMs;

            if (newStart < prevEnd) {
                newStart = prevEnd;
                newEnd = newStart + currentDuration;
            }
            if (newEnd > nextStart) {
                newEnd = nextStart;
                newStart = newEnd - currentDuration;
            }
            if (newStart < 0) {
                newStart = 0;
                newEnd = currentDuration;
            }
            if (newEnd > outputDuration) {
                newEnd = outputDuration;
                newStart = newEnd - currentDuration;
            }
        } else if (dragState.type === 'resize-start') {
            newStart = dragState.initialStartTimeMs + deltaTimeMs;
            newStart = Math.max(newStart, prevEnd);
            newStart = Math.min(newStart, newEnd - K_MIN_CAPTION_DURATION_MS);
        } else if (dragState.type === 'resize-end') {
            newEnd = dragState.initialEndTimeMs + deltaTimeMs;
            newEnd = Math.min(newEnd, nextStart, outputDuration);
            newEnd = Math.max(newEnd, newStart + K_MIN_CAPTION_DURATION_MS);
        }

        wasDraggingRef.current = true;

        // Convert output times back to source times for storage
        const sourceStart = timeMapper.mapOutputToSourceTime(newStart);
        const sourceEnd = timeMapper.mapOutputToSourceTime(newEnd);

        batchAction(() => updateCaptionSegment(dragState.captionId, {
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd,
        }));

        // Sync CTI
        if (dragState.type === 'resize-end') {
            setCurrentTime(newEnd);
        } else {
            setCurrentTime(newStart);
        }
    }, [dragState, coords, updateCaptionSegment, resolvedCaptions, batchAction, outputDuration, setCurrentTime, timeMapper]);

    const handleGlobalMouseUp = useCallback(() => {
        if (dragState) {
            // On commit: delete any captions whose source range overlaps the moved/resized caption
            if (wasDraggingRef.current) {
                const allCaptions: CaptionSegment[] = timeline.captionSegments || [];
                const movedCaption = allCaptions.find((s: CaptionSegment) => s.id === dragState.captionId);
                if (movedCaption) {
                    for (const existing of allCaptions) {
                        if (existing.id === dragState.captionId) continue;
                        if (doSourceRangesOverlap(movedCaption, existing)) {
                            deleteCaptionSegment(existing.id);
                        }
                    }
                }
            }

            setDragState(null);
            endInteraction();
        }
    }, [dragState, endInteraction, timeline, deleteCaptionSegment]);

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

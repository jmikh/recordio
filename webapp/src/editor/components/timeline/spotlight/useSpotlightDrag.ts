import { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useHistoryBatcher } from '../../../hooks/useHistoryBatcher';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { SpotlightAction } from '../../../../types';
import type { ResolvedSpotlight } from './SpotlightTrackUtils';
import { getSpotlightBounds, getMinSpotlightDuration, doSourceRangesOverlap } from './SpotlightTrackUtils';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';

export interface DragState {
    type: 'move' | 'resize-start' | 'resize-end';
    spotlightId: string;
    startX: number;
    /** Output-time positions at drag start (resolved from source) */
    initialStartTimeMs: number;
    initialEndTimeMs: number;
}

export function useSpotlightDrag(
    timeline: any,
    project: any,
    coords: TimePixelMapper,
    outputDuration: number,
    setEditingSpotlight: (id: string | null) => void,
    resolvedSpotlights: ResolvedSpotlight[],
    timeMapper: TimeMapper
) {
    const updateSpotlight = useProjectStore(s => s.updateSpotlight);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const [dragState, setDragState] = useState<DragState | null>(null);

    // Track whether actual dragging happened (mouse moved during drag)
    const wasDraggingRef = useRef(false);

    // Track whether item was already selected before mousedown
    const wasSelectedBeforeMousedownRef = useRef(false);

    const handleDragStart = (
        e: React.MouseEvent,
        type: DragState['type'],
        spotlight: SpotlightAction,
        isCurrentlySelected: boolean
    ) => {
        e.stopPropagation();

        wasDraggingRef.current = false;
        wasSelectedBeforeMousedownRef.current = isCurrentlySelected;

        // Get resolved output times for this spotlight via mapSourceRangeToOutputRange
        const range = timeMapper.mapSourceRangeToOutputRange(spotlight.sourceStartTimeMs, spotlight.sourceEndTimeMs);
        if (!range) return; // Shouldn't happen — only visible spotlights have drag handles

        setDragState({
            type,
            spotlightId: spotlight.id,
            startX: e.clientX,
            initialStartTimeMs: range.start,
            initialEndTimeMs: range.end,
        });
        startInteraction();
        setEditingSpotlight(spotlight.id);

        // Sync CTI to appropriate edge based on drag type
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

        const { prevEnd, nextStart } = getSpotlightBounds(
            dragState.spotlightId,
            resolvedSpotlights,
            outputDuration
        );

        let newStart = dragState.initialStartTimeMs;
        let newEnd = dragState.initialEndTimeMs;
        const currentDuration = newEnd - newStart;

        const minDuration = getMinSpotlightDuration(project.settings.spotlight.transitionDurationMs);

        if (dragState.type === 'move') {
            newStart = dragState.initialStartTimeMs + deltaTimeMs;
            newEnd = dragState.initialEndTimeMs + deltaTimeMs;

            // Clamp to boundaries
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
            newStart = Math.min(newStart, newEnd - minDuration);
        } else if (dragState.type === 'resize-end') {
            newEnd = dragState.initialEndTimeMs + deltaTimeMs;
            newEnd = Math.min(newEnd, nextStart, outputDuration);
            newEnd = Math.max(newEnd, newStart + minDuration);
        }

        wasDraggingRef.current = true;

        // Convert output times back to source times for storage
        const sourceStart = timeMapper.mapOutputToSourceTime(newStart);
        const sourceEnd = timeMapper.mapOutputToSourceTime(newEnd);

        batchAction(() => updateSpotlight(dragState.spotlightId, {
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd
        }));

        // Sync CTI to the edge being dragged
        if (dragState.type === 'resize-end') {
            setCurrentTime(newEnd);
        } else {
            setCurrentTime(newStart);
        }
    }, [dragState, coords, updateSpotlight, resolvedSpotlights, batchAction, outputDuration, setCurrentTime, timeMapper]);

    const handleGlobalMouseUp = useCallback(() => {
        if (dragState) {
            // On move commit: delete overlapping spotlights (source-time intersection)
            if (dragState.type === 'move' && wasDraggingRef.current) {
                const allSpotlights: SpotlightAction[] = timeline.spotlightActions || [];
                const movedSpotlight = allSpotlights.find((s: SpotlightAction) => s.id === dragState.spotlightId);
                if (movedSpotlight) {
                    for (const existing of allSpotlights) {
                        if (existing.id === dragState.spotlightId) continue;
                        if (doSourceRangesOverlap(movedSpotlight, existing)) {
                            deleteSpotlight(existing.id);
                        }
                    }
                }
            }

            setDragState(null);
            endInteraction();
        }
    }, [dragState, endInteraction, timeline, deleteSpotlight]);

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
        wasSelectedBeforeMousedownRef
    };
}

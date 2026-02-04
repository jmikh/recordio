import { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useHistoryBatcher } from '../../../hooks/useHistoryBatcher';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { SpotlightAction, SpotlightSettings } from '../../../../types';
import { getSpotlightBounds, getMinSpotlightDuration } from './SpotlightTrackUtils';

export interface DragState {
    type: 'move' | 'resize-start' | 'resize-end';
    spotlightId: string;
    startX: number;
    initialStartTimeMs: number;
    initialEndTimeMs: number;
}

export function useSpotlightDrag(
    timeline: any,
    project: any,
    coords: TimePixelMapper,
    outputDuration: number,
    setEditingSpotlight: (id: string | null) => void
) {
    const updateSpotlight = useProjectStore(s => s.updateSpotlight);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const [dragState, setDragState] = useState<DragState | null>(null);

    // Track whether actual dragging happened (mouse moved during drag)
    // Used to suppress toggle behavior after drag operations
    const wasDraggingRef = useRef(false);

    // Track whether item was already selected before mousedown
    // Used for toggle: if already selected and pure click → deselect
    const wasSelectedBeforeMousedownRef = useRef(false);

    const settings: SpotlightSettings = project.settings.spotlight;
    const minDuration = getMinSpotlightDuration(settings);

    const handleDragStart = (
        e: React.MouseEvent,
        type: DragState['type'],
        spotlight: SpotlightAction,
        isCurrentlySelected: boolean
    ) => {
        e.stopPropagation();

        wasDraggingRef.current = false; // Reset on drag start
        wasSelectedBeforeMousedownRef.current = isCurrentlySelected; // Track selection state

        setDragState({
            type,
            spotlightId: spotlight.id,
            startX: e.clientX,
            initialStartTimeMs: spotlight.outputStartTimeMs,
            initialEndTimeMs: spotlight.outputEndTimeMs,
        });
        startInteraction();
        // Select on drag start (but refs control toggle behavior on click end)
        setEditingSpotlight(spotlight.id);

        // Sync CTI to appropriate edge based on drag type
        if (type === 'resize-end') {
            setCurrentTime(spotlight.outputEndTimeMs);
        } else {
            // 'move' or 'resize-start' -> follow start time
            setCurrentTime(spotlight.outputStartTimeMs);
        }
    };

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaTimeMs = coords.xToMs(deltaX);

        const spotlightActions = timeline.spotlightActions || [];
        const { prevEnd, nextStart } = getSpotlightBounds(
            dragState.spotlightId,
            spotlightActions,
            outputDuration
        );

        let newStart = dragState.initialStartTimeMs;
        let newEnd = dragState.initialEndTimeMs;
        const currentDuration = newEnd - newStart;

        if (dragState.type === 'move') {
            // Move entire spotlight
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
            // Also clamp to [0, outputDuration]
            if (newStart < 0) {
                newStart = 0;
                newEnd = currentDuration;
            }
            if (newEnd > outputDuration) {
                newEnd = outputDuration;
                newStart = newEnd - currentDuration;
            }
        } else if (dragState.type === 'resize-start') {
            // Resize from start (left edge)
            newStart = dragState.initialStartTimeMs + deltaTimeMs;

            // Clamp: can't go before prevEnd or make duration < min
            newStart = Math.max(newStart, prevEnd);
            newStart = Math.min(newStart, newEnd - minDuration);
        } else if (dragState.type === 'resize-end') {
            // Resize from end (right edge)
            newEnd = dragState.initialEndTimeMs + deltaTimeMs;

            // Clamp: can't go past nextStart or make duration < min
            newEnd = Math.min(newEnd, nextStart, outputDuration);
            newEnd = Math.max(newEnd, newStart + minDuration);
        }

        // Mark that actual dragging happened (suppress click toggle)
        wasDraggingRef.current = true;

        batchAction(() => updateSpotlight(dragState.spotlightId, {
            outputStartTimeMs: newStart,
            outputEndTimeMs: newEnd
        }));

        // Sync CTI to the edge being dragged
        if (dragState.type === 'resize-end') {
            setCurrentTime(newEnd);
        } else {
            // 'move' or 'resize-start' -> follow start time
            setCurrentTime(newStart);
        }
    }, [dragState, coords, updateSpotlight, timeline, minDuration, batchAction, outputDuration, setCurrentTime]);

    const handleGlobalMouseUp = useCallback(() => {
        if (dragState) {
            setDragState(null);
            endInteraction();
        }
    }, [dragState, endInteraction]);

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

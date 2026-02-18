import { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useHistoryBatcher } from '../../../hooks/useHistoryBatcher';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { ZoomAction, ZoomSettings } from '../../../../types';
import { getZoomBlockBounds, prepareZoomActionsForUI, type PreparedZoomAction } from './ZoomTrackUtils';

export interface DragState {
    type: 'move';
    motionId: string;
    startX: number;
    initialOutputEndTime: number; // Anchor in Output Time (for drag calculations)
    initialSourceEndTime: number; // Original source time (for conversions)
}

export function useZoomDrag(
    timeline: any,
    project: any,
    coords: TimePixelMapper,
    outputDuration: number,
    setEditingZoom: (id: string | null) => void,
    preparedActions: PreparedZoomAction[]
) {
    const updateZoomAction = useProjectStore(s => s.updateZoomAction);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();
    const timeMapper = useTimeMapper();

    const [dragState, setDragState] = useState<DragState | null>(null);

    // Track whether actual dragging happened (mouse moved during drag)
    const wasDraggingRef = useRef(false);

    // Track whether item was already selected before mousedown
    const wasSelectedBeforeMousedownRef = useRef(false);

    const handleDragStart = (e: React.MouseEvent, type: 'move', action: ZoomAction, isCurrentlySelected: boolean) => {
        e.stopPropagation();

        // Find the prepared action to get its output time
        const preparedAction = preparedActions.find(p => p.id === action.id);
        if (!preparedAction) return;

        const outputEndTimeX = coords.msToX(preparedAction.outputEndTime);
        if (outputEndTimeX === -1) return;

        wasDraggingRef.current = false;
        wasSelectedBeforeMousedownRef.current = isCurrentlySelected;

        setDragState({
            type,
            motionId: action.id,
            startX: e.clientX,
            initialOutputEndTime: preparedAction.outputEndTime,
            initialSourceEndTime: action.sourceEndTimeMs,
        });
        startInteraction();
        setEditingZoom(action.id);
    };

    /**
     * Handles the actual dragging logic.
     * Works in output time for UI interactions, then converts to source time for storage.
     */
    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaTimeMs = coords.xToMs(deltaX);

        let targetOutputEndTime = dragState.initialOutputEndTime + deltaTimeMs;

        // Get boundaries using prepared actions (in output time)
        const { prevEnd, nextEnd } = getZoomBlockBounds(
            dragState.motionId, preparedActions, outputDuration
        );

        const { transitionDurationMs } = project.settings.zoom;

        // Clamp output end time to boundaries
        // Left: must leave room for at least transitionDurationMs (our own transition)
        targetOutputEndTime = Math.max(targetOutputEndTime, prevEnd + transitionDurationMs);
        // Right: leave room for next zoom's transition, or output duration
        const rightBoundary = nextEnd < outputDuration
            ? nextEnd - transitionDurationMs
            : outputDuration;
        targetOutputEndTime = Math.min(targetOutputEndTime, rightBoundary);

        // Convert target output time back to source time
        const targetSourceEndTime = timeMapper.mapOutputToSourceTime(targetOutputEndTime);
        if (targetSourceEndTime === -1) return; // Invalid time

        // Mark that actual dragging happened
        wasDraggingRef.current = true;

        batchAction(() => updateZoomAction(dragState.motionId, {
            sourceEndTimeMs: targetSourceEndTime,
            type: 'manual'
        }));
    }, [dragState, coords, updateZoomAction, preparedActions, project.settings.zoom, batchAction, outputDuration, timeMapper]);

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

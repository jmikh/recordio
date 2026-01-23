import { useState, useCallback, useEffect } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useHistoryBatcher } from '../../../hooks/useHistoryBatcher';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { ViewportMotion } from '../../../../core/types';
import { getZoomBlockBounds } from './ZoomTrackUtils';

// Actually Project type is likely in core/types or similar. 
// Checking imports in ZoomTrack.tsx: import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
// It uses `project` from `useProjectStore`.

export interface DragState {
    type: 'move';
    motionId: string;
    startX: number;
    initialOutputEndTime: number; // Anchor in Output Time
}

export function useZoomDrag(
    timeline: any, // Typed correctly if possible, else any for now matching usage
    project: any,
    coords: TimePixelMapper,
    outputDuration: number,
    setEditingZoom: (id: string | null) => void
) {
    const updateViewportMotion = useProjectStore(s => s.updateViewportMotion);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const [dragState, setDragState] = useState<DragState | null>(null);

    const handleDragStart = (e: React.MouseEvent, type: 'move', motion: ViewportMotion) => {
        e.stopPropagation();

        const outputEndTimeX = coords.msToX(motion.outputEndTimeMs);
        if (outputEndTimeX === -1) return; // Should be impossible if clicked

        setDragState({
            type,
            motionId: motion.id,
            startX: e.clientX,
            initialOutputEndTime: motion.outputEndTimeMs,
        });
        startInteraction();
        setEditingZoom(motion.id);
    };

    /**
     * Handles the actual dragging logic (Move).
     * Attached to window to track mouse movements outside the track area.
     * Prevents overlap with adjacent blocks and dynamically adjusts duration.
     */
    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaTimeMs = coords.xToMs(deltaX);

        const motions = timeline.viewportMotions || [];
        let targetOutputEndTime = dragState.initialOutputEndTime + deltaTimeMs;

        // Get boundaries (excluding self)
        // Use output duration as the boundary for zoom blocks
        const { prevEnd, nextStart } = getZoomBlockBounds(
            dragState.motionId, motions, outputDuration
        );

        const { minZoomDurationMs, maxZoomDurationMs } = project.settings.zoom;

        // Clamp sourceEndTime to boundaries
        // Left: must leave room for at least minZoomDurationMs
        targetOutputEndTime = Math.max(targetOutputEndTime, prevEnd + minZoomDurationMs);
        // Right: cannot exceed next block start or output duration
        targetOutputEndTime = Math.min(targetOutputEndTime, nextStart, outputDuration);

        // Calculate duration based on available space
        const availableSpace = targetOutputEndTime - prevEnd;
        const targetDuration = Math.max(minZoomDurationMs, Math.min(maxZoomDurationMs, availableSpace));

        batchAction(() => updateViewportMotion(dragState.motionId, {
            outputEndTimeMs: targetOutputEndTime,
            durationMs: targetDuration,
            type: 'manual'
        }));
    }, [dragState, coords, updateViewportMotion, timeline, project.settings.zoom, batchAction, outputDuration]);

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
        handleDragStart
    };
}

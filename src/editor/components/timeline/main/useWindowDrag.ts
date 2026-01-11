import { useState, useEffect } from 'react';
import type { OutputWindow, Timeline as TimelineType } from '../../../../core/types';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useHistoryBatcher } from '../../../hooks/useHistoryBatcher';
import { TimePixelMapper } from '../../../utils/timePixelMapper';

export interface DragState {
    windowId: string;
    type: 'left' | 'right';
    startX: number;
    outputStartMs: number;
    initialWindow: OutputWindow;
    currentWindow: OutputWindow;
    constraints: {
        minStart: number;
        maxEnd: number;
    };
}

export const useWindowDrag = (timeline: TimelineType, coords: TimePixelMapper) => {
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const setPreviewTime = useUIStore(s => s.setPreviewTime);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const setIsPlaying = useUIStore(s => s.setIsPlaying);
    const setIsResizingWindow = useUIStore(s => s.setIsResizingWindow);

    const [dragState, setDragState] = useState<DragState | null>(null);

    // History Batcher
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const MinWindowDurationMs = 250;

    useEffect(() => {
        if (!dragState) return;

        const handleGlobalMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - dragState.startX;
            const outputDeltaMs = coords.xToMs(deltaX);
            const win = dragState.initialWindow;
            const { minStart, maxEnd } = dragState.constraints;

            // Convert output time delta to source time delta
            // When dragging a window with speed, the visual width represents output time,
            // but we're modifying source time (startMs/endMs)
            const speed = win.speed || 1.0;
            const sourceDeltaMs = outputDeltaMs * speed;

            let newWindow = { ...win };

            if (dragState.type === 'left') {
                const proposedStart = win.startMs + sourceDeltaMs;
                // Cannot go before minStart, cannot cross endMs (min dur 100ms)
                newWindow.startMs = Math.min(Math.max(proposedStart, minStart), win.endMs - MinWindowDurationMs);
            } else if (dragState.type === 'right') {
                const proposedEnd = win.endMs + sourceDeltaMs;
                // Cannot go past maxEnd, cannot cross startMs
                newWindow.endMs = Math.max(Math.min(proposedEnd, maxEnd), win.startMs + MinWindowDurationMs);
            }

            // Live Update to Store (Batched)
            // Batch continuous updates (e.g. 60fps drag) into a single undoable history action.
            if (newWindow.startMs !== dragState.currentWindow.startMs || newWindow.endMs !== dragState.currentWindow.endMs) {
                batchAction(() => {
                    updateOutputWindow(dragState.windowId, newWindow);
                });
                setDragState(prev => prev ? { ...prev, currentWindow: newWindow } : null);

                // Update Playhead Position & Reset Preview
                // Sync the main playhead to the edge being dragged for precise editing feedback.
                setPreviewTime(null);

                if (dragState.type === 'left') {
                    // Left Edge Drag: Sync Playhead to the new start of the clip + 1ms (first visible frame)
                    setCurrentTime(dragState.outputStartMs + 1);

                } else if (dragState.type === 'right') {
                    // Right Edge Drag: Sync Playhead to the new end of the clip - 1ms (last visible frame)
                    const speed = newWindow.speed || 1.0;
                    const newDuration = (newWindow.endMs - newWindow.startMs) / speed;
                    const rightSideOutputTime = dragState.outputStartMs + newDuration;
                    setCurrentTime(rightSideOutputTime - 1);
                }
            }
        };

        const handleGlobalMouseUp = () => {
            if (dragState) {
                endInteraction();
                setIsResizingWindow(false);
            }
            setDragState(null);
        };

        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [dragState, coords, updateOutputWindow, batchAction, endInteraction, setPreviewTime, setCurrentTime, setIsResizingWindow]);

    const handleDragStart = (e: React.MouseEvent, id: string, type: 'left' | 'right') => {
        e.preventDefault();
        e.stopPropagation();

        const winIndex = timeline.outputWindows.findIndex(w => w.id === id);
        if (winIndex === -1) return;
        const win = timeline.outputWindows[winIndex];

        let minStart = 0;
        let maxEnd = timeline.durationMs || 10000;
        let outputStartMs = 0;

        // Calculate output start for this window
        for (let i = 0; i < winIndex; i++) {
            const w = timeline.outputWindows[i];
            const speed = w.speed || 1.0;
            outputStartMs += (w.endMs - w.startMs) / speed;
        }

        if (winIndex > 0) {
            minStart = timeline.outputWindows[winIndex - 1].endMs;
        }
        if (winIndex < timeline.outputWindows.length - 1) {
            maxEnd = timeline.outputWindows[winIndex + 1].startMs;
        }

        startInteraction();
        setIsResizingWindow(true);
        setIsPlaying(false);

        setDragState({
            windowId: id,
            type,
            startX: e.clientX,
            outputStartMs,
            initialWindow: win,
            currentWindow: win,
            constraints: { minStart, maxEnd }
        });
    };

    return { dragState, handleDragStart };
};

import { useState, useEffect } from 'react';
import type { OutputWindow, Timeline as TimelineType } from '../../../../../types';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { useHistoryBatcher } from '../../../../hooks/useHistoryBatcher';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import { MIN_WINDOW_DURATION_MS } from './constants';

// Minimum pixel over-drag past the zero-gap boundary before triggering a merge.
// Prevents accidental merges from sub-pixel jitter.
const MERGE_THRESHOLD_PX = 5;

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
    adjacentWindowId: string | null;
    pendingMerge: boolean;
}

export const useWindowDrag = (timeline: TimelineType, coords: TimePixelMapper) => {
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const mergeWindows = useProjectStore(s => s.mergeWindows);
    const setPreviewTime = useUIStore(s => s.setPreviewTime);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const setIsPlaying = useUIStore(s => s.setIsPlaying);
    const setIsResizingWindow = useUIStore(s => s.setIsResizingWindow);

    const [dragState, setDragState] = useState<DragState | null>(null);

    // History Batcher
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();



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

            // Create new window with only serializable properties to avoid circular references
            let newStartMs = win.startMs;
            let newEndMs = win.endMs;

            if (dragState.type === 'left') {
                const proposedStart = win.startMs + sourceDeltaMs;
                // Cannot go before minStart, cannot cross endMs (min dur 100ms)
                newStartMs = Math.min(Math.max(proposedStart, minStart), win.endMs - MIN_WINDOW_DURATION_MS);

                // Merge detection: track pending merge state for commit on mouseup
                if (dragState.adjacentWindowId && proposedStart < minStart) {
                    const overDragPx = Math.abs(deltaX) - Math.abs(coords.msToX((minStart - win.startMs) / speed));
                    if (overDragPx > MERGE_THRESHOLD_PX) {
                        if (!dragState.pendingMerge) {
                            setDragState(prev => prev ? { ...prev, pendingMerge: true } : null);
                        }
                    } else if (dragState.pendingMerge) {
                        setDragState(prev => prev ? { ...prev, pendingMerge: false } : null);
                    }
                } else if (dragState.pendingMerge) {
                    setDragState(prev => prev ? { ...prev, pendingMerge: false } : null);
                }
            } else if (dragState.type === 'right') {
                const proposedEnd = win.endMs + sourceDeltaMs;
                // Cannot go past maxEnd, cannot cross startMs
                newEndMs = Math.max(Math.min(proposedEnd, maxEnd), win.startMs + MIN_WINDOW_DURATION_MS);

                // Merge detection: track pending merge state for commit on mouseup
                if (dragState.adjacentWindowId && proposedEnd > maxEnd) {
                    const overDragPx = Math.abs(deltaX) - Math.abs(coords.msToX((maxEnd - win.endMs) / speed));
                    if (overDragPx > MERGE_THRESHOLD_PX) {
                        if (!dragState.pendingMerge) {
                            setDragState(prev => prev ? { ...prev, pendingMerge: true } : null);
                        }
                    } else if (dragState.pendingMerge) {
                        setDragState(prev => prev ? { ...prev, pendingMerge: false } : null);
                    }
                } else if (dragState.pendingMerge) {
                    setDragState(prev => prev ? { ...prev, pendingMerge: false } : null);
                }
            }

            // Only update if values changed
            if (newStartMs !== dragState.currentWindow.startMs || newEndMs !== dragState.currentWindow.endMs) {
                // Create new window object with only serializable properties
                const newWindow: OutputWindow = {
                    id: win.id,
                    startMs: newStartMs,
                    endMs: newEndMs,
                    speed: win.speed
                };

                // Live Update to Store (Batched)
                // Batch continuous updates (e.g. 60fps drag) into a single undoable history action.
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
                // Commit merge if pending
                if (dragState.pendingMerge && dragState.adjacentWindowId) {
                    const keepId = dragState.type === 'left' ? dragState.adjacentWindowId : dragState.windowId;
                    const removeId = dragState.type === 'left' ? dragState.windowId : dragState.adjacentWindowId;
                    batchAction(() => {
                        mergeWindows(keepId, removeId);
                    });
                }
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
    }, [dragState, coords, updateOutputWindow, mergeWindows, batchAction, endInteraction, setPreviewTime, setCurrentTime, setIsResizingWindow]);

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

        // Determine adjacent window for potential merge
        let adjacentWindowId: string | null = null;
        if (type === 'left' && winIndex > 0) {
            minStart = timeline.outputWindows[winIndex - 1].endMs;
            adjacentWindowId = timeline.outputWindows[winIndex - 1].id;
        }
        if (type === 'right' && winIndex < timeline.outputWindows.length - 1) {
            maxEnd = timeline.outputWindows[winIndex + 1].startMs;
            adjacentWindowId = timeline.outputWindows[winIndex + 1].id;
        }
        // Still need constraints for the non-drag side
        if (type === 'right' && winIndex > 0) {
            minStart = timeline.outputWindows[winIndex - 1].endMs;
        }
        if (type === 'left' && winIndex < timeline.outputWindows.length - 1) {
            maxEnd = timeline.outputWindows[winIndex + 1].startMs;
        }

        startInteraction();
        setIsResizingWindow(true);
        setIsPlaying(false);

        // Create clean window object with only serializable properties to avoid circular references
        const cleanWindow: OutputWindow = {
            id: win.id,
            startMs: win.startMs,
            endMs: win.endMs,
            speed: win.speed
        };

        setDragState({
            windowId: id,
            type,
            startX: e.clientX,
            outputStartMs,
            initialWindow: cleanWindow,
            currentWindow: cleanWindow,
            constraints: { minStart, maxEnd },
            adjacentWindowId,
            pendingMerge: false
        });
    };

    return { dragState, handleDragStart };
};

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { OutputWindow, Timeline as TimelineType } from '../../../core/types';
import { useProjectStore, useProjectSources } from '../../stores/useProjectStore';
import { useAudioAnalysis } from '../../hooks/useAudioAnalysis';
import { WaveformSegment } from './WaveformSegment';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useUIStore } from '../../stores/useUIStore';
import { TimeMapper } from '../../../core/timeMapper';
import { TimePixelMapper } from '../../utils/timePixelMapper';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

export const GROUP_HEADER_HEIGHT = 24;

interface MainTrackProps {
    timeline: TimelineType;
    pixelsPerSec: number;
    accumulatedX: number;
    trackHeight: number;
}

interface DragState {
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

export const MainTrack: React.FC<MainTrackProps> = ({
    timeline,
    pixelsPerSec,
    trackHeight,
}) => {
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const selectWindow = useUIStore(s => s.selectWindow);
    const selectedWindowId = useUIStore(s => s.selectedWindowId);

    // UI Actions
    const setPreviewTime = useUIStore(s => s.setPreviewTime);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const setIsResizingWindow = useUIStore(s => s.setIsResizingWindow);

    const sources = useProjectSources();
    const [dragState, setDragState] = useState<DragState | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // History Batcher
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Create TimePixelMapper for coordinate conversions
    const coords = useMemo(() => {
        const timeMapper = new TimeMapper(timeline.outputWindows);
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeline.outputWindows, pixelsPerSec]);

    // Deselect window when clicking outside this track component
    // This allows clicking on Headers or Rulers to deselect the window, 
    // while clicking inside the track (handled by onClick below) also deselects if not on a window.
    useClickOutside(containerRef, () => {
        if (selectedWindowId) selectWindow(null);
    });

    // Prepare Audio Analysis for Screen and Camera
    const screenSourceId = timeline.recording.screenSourceId;
    const cameraSourceId = timeline.recording.cameraSourceId;

    const screenSource = sources[screenSourceId];
    const cameraSource = cameraSourceId ? sources[cameraSourceId] : null;

    const screenAudio = useAudioAnalysis(screenSourceId, screenSource?.url);
    const cameraAudio = useAudioAnalysis(cameraSourceId || '', cameraSource?.url || '');

    // --- Dragging Logic ---
    // Uses HistoryBatcher to provide live store updates during drag interactions (batches hundreds of updates into one history step).

    useEffect(() => {
        if (!dragState) return;

        const handleGlobalMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - dragState.startX;
            const deltaMs = coords.xToMs(deltaX);
            const win = dragState.initialWindow;
            const { minStart, maxEnd } = dragState.constraints;

            let newWindow = { ...win };

            if (dragState.type === 'left') {
                const proposedStart = win.startMs + deltaMs;
                // Cannot go before minStart, cannot cross endMs (min dur 100ms)
                newWindow.startMs = Math.min(Math.max(proposedStart, minStart), win.endMs - 100);
            } else if (dragState.type === 'right') {
                const proposedEnd = win.endMs + deltaMs;
                // Cannot go past maxEnd, cannot cross startMs
                newWindow.endMs = Math.max(Math.min(proposedEnd, maxEnd), win.startMs + 100);
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
                    const newDuration = newWindow.endMs - newWindow.startMs;
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
    }, [dragState, coords, updateOutputWindow, batchAction, endInteraction, setPreviewTime, setCurrentTime]);

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
            outputStartMs += (w.endMs - w.startMs);
        }

        if (winIndex > 0) {
            minStart = timeline.outputWindows[winIndex - 1].endMs;
        }
        if (winIndex < timeline.outputWindows.length - 1) {
            maxEnd = timeline.outputWindows[winIndex + 1].startMs;
        }

        startInteraction();
        setIsResizingWindow(true);

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

    // Calculate layout
    let currentX = 0;
    const trackContentHeight = Math.max(0, trackHeight - GROUP_HEADER_HEIGHT);

    return (
        <div ref={containerRef} className="w-full relative bg-[#2a2a2a]/50 flex" style={{ height: trackHeight }}>

            {/* Content Container */}
            <div className="relative flex-1" style={{ height: trackHeight }}>

                {timeline.outputWindows.map((w) => {
                    const win = (dragState && dragState.windowId === w.id) ? dragState.currentWindow : w;
                    const isSelected = selectedWindowId === w.id;
                    const durationMs = win.endMs - win.startMs;
                    const left = currentX;
                    const width = coords.msToX(durationMs);
                    currentX += width; // Accumulate for next window

                    const hasCamera = !!timeline.recording.cameraSourceId;
                    const sourceStartMs = win.startMs;
                    const sourceEndMs = win.endMs;

                    return (
                        <div
                            key={w.id}
                            className={`absolute top-0 bottom-0 group border rounded-lg overflow-hidden flex flex-col transition-colors ${isSelected ? 'border-yellow-500 border-2' : 'border-white/20 hover:border-white/40'}`}
                            style={{ left: `${left}px`, width: `${width}px` }}
                            onClick={(e) => {
                                e.stopPropagation();
                                selectWindow(w.id);
                            }}
                        >
                            {/* Group Header */}
                            <div
                                style={{ height: GROUP_HEADER_HEIGHT }}
                                className="bg-white/5 border-b border-white/10 px-2 flex items-center text-xs text-white/50 select-none"
                            >
                                {(durationMs / 1000).toFixed(1)}s
                            </div>

                            {/* Tracks Area */}
                            <div className="relative flex-1 w-full">
                                {/* 1. Screen Segment */}
                                <div className={`absolute left-0 right-0 top-0 ${hasCamera ? 'bottom-1/2' : 'bottom-0'} bg-blue-900/60 border-y border-blue-500/40 first:border-t-0 last:border-b-0 overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center`}>
                                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                                        {!screenAudio.isLoading && (
                                            <WaveformSegment
                                                peaks={screenAudio.peaks}
                                                sourceStartMs={sourceStartMs}
                                                sourceEndMs={sourceEndMs}
                                                width={width}
                                                height={hasCamera ? trackContentHeight / 2 : trackContentHeight}
                                                color="#bfdbfe" // blue-200
                                            />
                                        )}
                                    </div>
                                </div>


                                {/* 2. Camera Segment (if exists) */}
                                {
                                    hasCamera && (
                                        <div className="absolute left-0 right-0 bottom-0 top-1/2 bg-purple-900/60 border-b border-purple-500/40 overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center">
                                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                                                {!cameraAudio.isLoading && (
                                                    <WaveformSegment
                                                        peaks={cameraAudio.peaks}
                                                        sourceStartMs={sourceStartMs}
                                                        sourceEndMs={sourceEndMs}
                                                        width={width}
                                                        height={trackContentHeight / 2}
                                                        color="#e9d5ff" // purple-200
                                                    />
                                                )}
                                            </div>
                                        </div>

                                    )}
                            </div>

                            {/* Resize Handles (Overlay entire group) */}
                            <div
                                className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-white/10 z-20"
                                onMouseDown={(e) => handleDragStart(e, w.id, 'left')}
                            />
                            <div
                                className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-white/10 z-20"
                                onMouseDown={(e) => handleDragStart(e, w.id, 'right')}
                            />
                        </div>
                    );
                })}
            </div >
        </div >
    );
};

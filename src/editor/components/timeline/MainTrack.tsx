import React, { useState, useEffect } from 'react';
import type { OutputWindow, Timeline as TimelineType } from '../../../core/types';
import { useProjectStore } from '../../stores/useProjectStore';


interface MainTrackProps {
    timeline: TimelineType;
    pixelsPerSec: number;
    accumulatedX: number; // For layout positioning if needed, but we mostly use absolute based on prev widths
    trackHeight: number;
}

interface DragState {
    windowId: string;
    type: 'left' | 'right' | 'move';
    startX: number;
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
    const [dragState, setDragState] = useState<DragState | null>(null);

    // --- Dragging Logic ---
    useEffect(() => {
        if (!dragState) return;

        const handleGlobalMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - dragState.startX;
            const deltaMs = (deltaX / pixelsPerSec) * 1000;
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
            } else if (dragState.type === 'move') {
                const duration = win.endMs - win.startMs;
                const proposedStart = win.startMs + deltaMs;

                let safeStart = Math.max(proposedStart, minStart);
                let safeEnd = safeStart + duration;

                if (safeEnd > maxEnd) {
                    safeEnd = maxEnd;
                    safeStart = safeEnd - duration;
                }

                newWindow.startMs = safeStart;
                newWindow.endMs = safeEnd;
            }

            setDragState(prev => prev ? { ...prev, currentWindow: newWindow } : null);
        };

        const handleGlobalMouseUp = () => {
            if (dragState) {
                updateOutputWindow(dragState.windowId, dragState.currentWindow);
            }
            setDragState(null);
        };

        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [dragState, pixelsPerSec, updateOutputWindow]);

    const handleDragStart = (e: React.MouseEvent, id: string, type: 'left' | 'right' | 'move') => {
        e.preventDefault();
        e.stopPropagation();

        const winIndex = timeline.outputWindows.findIndex(w => w.id === id);
        if (winIndex === -1) return;
        const win = timeline.outputWindows[winIndex];

        let minStart = 0;
        let maxEnd = timeline.durationMs || 10000;

        if (winIndex > 0) {
            minStart = timeline.outputWindows[winIndex - 1].endMs;
        }
        if (winIndex < timeline.outputWindows.length - 1) {
            maxEnd = timeline.outputWindows[winIndex + 1].startMs;
        }

        setDragState({
            windowId: id,
            type,
            startX: e.clientX,
            initialWindow: win,
            currentWindow: win,
            constraints: { minStart, maxEnd }
        });
    };

    // Calculate layout
    let currentX = 0;

    return (
        <div className="w-full relative bg-[#2a2a2a]/50" style={{ height: trackHeight }}>
            <div className="absolute left-2 top-0 text-[10px] text-gray-500 font-mono pointer-events-none sticky left-0 z-10">MAIN</div>

            {timeline.outputWindows.map((w, i) => {
                const win = (dragState && dragState.windowId === w.id) ? dragState.currentWindow : w;
                const duration = win.endMs - win.startMs;
                const left = currentX;
                const width = (duration / 1000) * pixelsPerSec;
                currentX += width; // Accumulate for next window

                const hasCamera = !!timeline.recording.cameraSourceId;

                return (
                    <div
                        key={w.id}
                        className="absolute top-0 bottom-0 group"
                        style={{ left: `${left}px`, width: `${width}px` }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => handleDragStart(e, w.id, 'move')}
                    >
                        {/* 1. Screen Segment */}
                        <div className={`absolute left-0 right-0 top-0 ${hasCamera ? 'bottom-1/2' : 'bottom-0'} bg-blue-900/60 border border-blue-500/40 rounded-sm overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center`}>
                            {/* Waveform Visualization (Simulated) */}
                            <div className="absolute inset-0 opacity-20 pointer-events-none flex items-center gap-[2px] justify-center overflow-hidden">
                                {Array.from({ length: Math.min(20, Math.floor(width / 4)) }).map((_, idx) => (
                                    <div
                                        key={idx}
                                        className="w-[2px] bg-blue-200 rounded-full"
                                        style={{ height: `${20 + Math.random() * 60}%` }}
                                    />
                                ))}
                            </div>
                            <span className="text-[10px] text-blue-100/70 font-medium truncate px-1 pointer-events-none">
                                Screen Part {i + 1}
                            </span>
                        </div>

                        {/* 2. Camera Segment (if exists) */}
                        {hasCamera && (
                            <div className="absolute left-0 right-0 bottom-0 top-1/2 bg-purple-900/60 border border-purple-500/40 rounded-sm overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center border-t-0">
                                {/* Waveform Visualization (Simulated) */}
                                <div className="absolute inset-0 opacity-20 pointer-events-none flex items-center gap-[2px] justify-center overflow-hidden">
                                    {Array.from({ length: Math.min(20, Math.floor(width / 4)) }).map((_, idx) => (
                                        <div
                                            key={idx}
                                            className="w-[2px] bg-purple-200 rounded-full"
                                            style={{ height: `${20 + Math.random() * 60}%` }}
                                        />
                                    ))}
                                </div>
                                <span className="text-[10px] text-purple-100/70 font-medium truncate px-1 pointer-events-none">
                                    Camera
                                </span>
                            </div>
                        )}

                        {/* Resize Handles */}
                        <div
                            className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-white/30 z-20"
                            onMouseDown={(e) => handleDragStart(e, w.id, 'left')}
                        />
                        <div
                            className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-white/30 z-20"
                            onMouseDown={(e) => handleDragStart(e, w.id, 'right')}
                        />
                    </div>
                );
            })}
        </div>
    );
};

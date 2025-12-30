import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useProjectStore, useProjectTimeline } from '../stores/useProjectStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { TimelineRuler } from './TimelineRuler';
import type { OutputWindow } from '../../core/types';


// Constants
const MIN_PIXELS_PER_SEC = 10;
const MAX_PIXELS_PER_SEC = 200;
const TRACK_HEIGHT = 40;

export function Timeline() {
    const containerRef = useRef<HTMLDivElement>(null);

    // -- Stores --
    const timeline = useProjectTimeline();
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const splitWindow = useProjectStore(s => s.splitWindow);
    const userEvents = useProjectStore(s => s.userEvents);

    const isPlaying = usePlaybackStore(s => s.isPlaying);
    const currentTimeMs = usePlaybackStore(s => s.currentTimeMs);
    const setIsPlaying = usePlaybackStore(s => s.setIsPlaying);
    const setCurrentTime = usePlaybackStore(s => s.setCurrentTime);

    // Zoom Level (Timeline Scale)
    const [pixelsPerSec, setPixelsPerSec] = useState(100);

    const totalDuration = timeline.durationMs || 10000;
    const totalWidth = (totalDuration / 1000) * pixelsPerSec;

    // Interaction State
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [isCTIScrubbing, setIsCTIScrubbing] = useState(false);

    // Dragging State
    interface DragState {
        windowId: string;
        type: 'left' | 'right' | 'move';
        startX: number;
        initialWindow: OutputWindow;
        currentWindow: OutputWindow; // The modified window (visual state)
        constraints: {
            minStart: number;
            maxEnd: number;
        };
    }

    const [dragState, setDragState] = useState<DragState | null>(null);

    // --- Mouse Handlers ---

    const getTimeFromEvent = (e: React.MouseEvent | MouseEvent) => {
        if (!containerRef.current) return 0;
        const rect = containerRef.current.getBoundingClientRect();
        const scrollLeft = containerRef.current.scrollLeft || 0;
        const x = e.clientX - rect.left + scrollLeft;
        const time = (x / pixelsPerSec) * 1000;
        return Math.max(0, time);
    };

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const time = getTimeFromEvent(e);
        setHoverTime(time);

        if (isCTIScrubbing) {
            setCurrentTime(Math.max(0, Math.min(time, totalDuration)));
        }
    }, [isCTIScrubbing, pixelsPerSec, totalDuration, setCurrentTime]);

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsCTIScrubbing(true);
        const time = getTimeFromEvent(e);
        setCurrentTime(Math.max(0, Math.min(time, totalDuration)));
    };

    const handleMouseLeave = () => {
        setHoverTime(null);
        setIsCTIScrubbing(false);
    };

    const handleMouseUp = () => {
        setIsCTIScrubbing(false);
    };

    // --- Split Action ---
    const handleSplit = () => {
        // Find active window at currentTimeMs
        const activeWinIndex = timeline.outputWindows.findIndex(w => currentTimeMs > w.startMs && currentTimeMs < w.endMs);
        if (activeWinIndex === -1) return;

        const win = timeline.outputWindows[activeWinIndex];

        // Atomic split action
        splitWindow(win.id, currentTimeMs);
    };

    // --- Dragging Logic for Operating Windows ---
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

        // Strict Neighbor Constraints (No Overlap)
        let minStart = 0;
        let maxEnd = totalDuration;

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

    // --- Format Helper ---
    const formatFullTime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        const dec = Math.floor((ms % 1000) / 100);
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${dec}`;
    };

    // --- Derived Data for Source Rows ---
    const recording = timeline.recording;
    const timelineOffset = recording.timelineOffsetMs;

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] select-none text-white font-sans">
            {/* 1. Toolbar */}
            <div className="h-10 flex items-center px-4 bg-[#252526] border-b border-[#333] shrink-0 justify-between">
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSplit}
                        className="px-3 py-1 bg-[#333] hover:bg-[#444] rounded text-xs border border-[#555]"
                        title="Split at Playhead"
                    >
                        Split
                    </button>
                    {/* Future: Delete button */}
                </div>

                <div className="flex items-center gap-4 bg-[#111] px-4 py-1 rounded-full border border-[#333]">
                    <button onClick={() => setIsPlaying(!isPlaying)} className="hover:text-green-400">
                        {isPlaying ? '⏸' : '▶️'}
                    </button>
                    <div className="font-mono text-xs text-gray-400 w-32 text-center">
                        {formatFullTime(currentTimeMs)} / {formatFullTime(totalDuration)}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500">Scale</span>
                    <input
                        type="range" min={MIN_PIXELS_PER_SEC} max={MAX_PIXELS_PER_SEC}
                        value={pixelsPerSec}
                        onChange={(e) => setPixelsPerSec(Number(e.target.value))}
                        className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                </div>
            </div>

            {/* 2. Timeline Surface */}
            <div
                className="flex-1 overflow-x-auto overflow-y-hidden relative custom-scrollbar bg-[#1e1e1e]"
                ref={containerRef}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeave}
                onMouseUp={handleMouseUp}
            >
                <div
                    className="relative min-w-full"
                    style={{ width: `${Math.max(totalWidth + 400, 0)}px` }}
                >
                    {/* Ruler */}
                    <TimelineRuler totalWidth={totalWidth} pixelsPerSec={pixelsPerSec} />

                    {/* Tracks Container */}
                    <div className="py-2 flex flex-col gap-2 relative pl-0">

                        {/* ROW 1: Output Windows */}
                        <div className="w-full relative bg-[#2a2a2a]/50" style={{ height: TRACK_HEIGHT }}>
                            <div className="absolute left-2 top-0 text-[10px] text-gray-500 font-mono pointer-events-none">OUTPUT</div>
                            {timeline.outputWindows.map(w => {
                                const win = (dragState && dragState.windowId === w.id) ? dragState.currentWindow : w;
                                const left = (win.startMs / 1000) * pixelsPerSec;
                                const width = ((win.endMs - win.startMs) / 1000) * pixelsPerSec;

                                return (
                                    <div
                                        key={w.id}
                                        className="absolute top-0 bottom-0 bg-green-600/90 border border-green-400/50 rounded-sm overflow-hidden group hover:brightness-110 transition-colors cursor-pointer box-border"
                                        style={{ left: `${left}px`, width: `${width}px` }}
                                        onClick={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => handleDragStart(e, w.id, 'move')}
                                    >
                                        <div className="px-1 text-[10px] text-white/90 truncate pointer-events-none mt-1">
                                            Main
                                        </div>
                                        {/* Resize Handles */}
                                        <div className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-white/30 z-20"
                                            onMouseDown={(e) => handleDragStart(e, w.id, 'left')} />
                                        <div className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-white/30 z-20"
                                            onMouseDown={(e) => handleDragStart(e, w.id, 'right')} />
                                    </div>
                                );
                            })}
                        </div>

                        {/* ROW 2: Screen Source Video */}
                        <div className="w-full relative bg-[#252526]" style={{ height: TRACK_HEIGHT }}>
                            <div className="absolute left-2 top-0 text-[10px] text-gray-500 font-mono pointer-events-none">SOURCE</div>
                            {/* Represents the full recording source, shifted by offset */}
                            <div
                                className="absolute top-1 bottom-1 bg-blue-900/40 border border-blue-500/30 rounded-sm"
                                style={{
                                    left: `${(timelineOffset / 1000) * pixelsPerSec}px`,
                                    // Make it span effectively infinite or reasonable max for visualization
                                    width: `${(totalDuration / 1000) * pixelsPerSec}px`
                                }}
                            >
                                <div className="px-2 text-[10px] text-blue-300/50">Screen Recording</div>
                            </div>
                        </div>

                        {/* ROW 3: Viewport Motions */}
                        <div className="w-full relative bg-[#252526]" style={{ height: TRACK_HEIGHT }}>
                            <div className="absolute left-2 top-0 text-[10px] text-gray-500 font-mono pointer-events-none">MOTION</div>
                            {recording.viewportMotions?.map((m, i) => {
                                // Motions are stored in Source Time.
                                // Timeline Time = Source Time + Offset
                                const timelineEndMs = m.sourceEndTimeMs + timelineOffset;
                                const timelineStartMs = timelineEndMs - m.durationMs;

                                // Check if mapped times are valid (visible)
                                if (timelineEndMs === -1 || timelineStartMs === -1) return null;

                                const left = (timelineStartMs / 1000) * pixelsPerSec;
                                const width = ((timelineEndMs - timelineStartMs) / 1000) * pixelsPerSec;

                                if (width <= 0) return null;

                                return (
                                    <div
                                        key={i}
                                        className="absolute top-1 bottom-1 bg-purple-900/60 border border-purple-500/50 rounded-sm"
                                        style={{ left: `${left}px`, width: `${Math.max(width, 2)}px` }}
                                    >
                                        <div className="text-[9px] text-purple-200/50 px-1 truncate">{m.reason}</div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* ROW 4: Events (Clicks/Drags) */}
                        <div className="w-full relative bg-[#252526]" style={{ height: TRACK_HEIGHT }}>
                            <div className="absolute left-2 top-0 text-[10px] text-gray-500 font-mono pointer-events-none">EVENTS</div>

                            {/* Clicks */}
                            {userEvents?.mouseClicks?.map((c, i) => {
                                const timeMs = c.timestamp + timelineOffset;
                                const left = (timeMs / 1000) * pixelsPerSec;
                                return (
                                    <div
                                        key={`c-${i}`}
                                        className="absolute top-3 w-2 h-2 rounded-full bg-yellow-500 hover:scale-125 transition-transform"
                                        style={{ left: `${left}px` }}
                                        title={`Click at ${formatFullTime(timeMs)}`}
                                    />
                                );
                            })}

                            {/* Drags */}
                            {userEvents?.drags?.map((d, i) => {
                                // Assuming drag starts at d.timestamp.
                                // Use explicit endTime if available, else standard fallback
                                const startMs = d.timestamp + timelineOffset;
                                const endMs = (d.endTime !== undefined)
                                    ? d.endTime + timelineOffset
                                    : (d.path && d.path.length > 0)
                                        ? d.path[d.path.length - 1].timestamp + timelineOffset
                                        : startMs + 500; // fallback duration

                                const left = (startMs / 1000) * pixelsPerSec;
                                const width = ((endMs - startMs) / 1000) * pixelsPerSec;

                                return (
                                    <div
                                        key={`d-${i}`}
                                        className="absolute top-4 h-1 bg-yellow-600/60 rounded-full"
                                        style={{ left: `${left}px`, width: `${width}px` }}
                                    />
                                );
                            })}

                            {/* Keyboard Events */}
                            {userEvents?.keyboardEvents?.map((k, i) => {
                                const timeMs = k.timestamp + timelineOffset;
                                const left = (timeMs / 1000) * pixelsPerSec;
                                // Simple marker for now
                                return (
                                    <div
                                        key={`k-${i}`}
                                        className="absolute top-6 w-2 h-2 rounded-sm bg-cyan-500 hover:scale-125 transition-transform"
                                        style={{ left: `${left}px` }}
                                        title={`Key: ${k.key} at ${formatFullTime(timeMs)}`}
                                    />
                                );
                            })}
                        </div>

                    </div>

                    {/* Hover Line */}
                    {hoverTime !== null && (
                        <div
                            className="absolute top-0 bottom-0 w-[1px] bg-white/30 z-20 pointer-events-none"
                            style={{ left: `${(hoverTime / 1000) * pixelsPerSec}px` }}
                        />
                    )}

                    {/* CTI */}
                    <div
                        className="absolute top-0 bottom-0 w-[1px] bg-red-500 z-30 pointer-events-none"
                        style={{ left: `${(currentTimeMs / 1000) * pixelsPerSec}px` }}
                    >
                        <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-red-500"></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

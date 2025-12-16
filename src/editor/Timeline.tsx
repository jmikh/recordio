import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useEditorStore } from './store';
import { getTotalDuration } from './utils';

// Constants
const MIN_PIXELS_PER_SEC = 10;
const MAX_PIXELS_PER_SEC = 200;

export function Timeline() {
    const containerRef = useRef<HTMLDivElement>(null);
    const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
    const {
        segments,
        metadata,
        currentTime,
        splitSegment,
        updateSegment,
        setCurrentTime,
        isPlaying,
        setIsPlaying
    } = useEditorStore();

    // Zoom Level (Timeline Scale)
    const [pixelsPerSec, setPixelsPerSec] = useState(100);

    const totalDuration = useMemo(() => getTotalDuration(segments), [segments]);
    const totalWidth = (totalDuration / 1000) * pixelsPerSec;

    // Interaction State
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [isCTIScrubbing, setIsCTIScrubbing] = useState(false);

    // Drag State (for trimming)
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragType, setDragType] = useState<'left' | 'right' | null>(null);
    const [dragStartX, setDragStartX] = useState(0);
    const [dragStartVal, setDragStartVal] = useState(0);

    // Helpers
    const formatTimeCode = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Draw Ruler
    useEffect(() => {
        const canvas = rulerCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Handle high DPI
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(totalWidth + 500, window.innerWidth); // Ensure it fills view
        const height = 24;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#64748b'; // slate-500
        ctx.strokeStyle = '#334155'; // slate-700
        ctx.font = '10px monospace';
        ctx.textBaseline = 'top';

        // Tick Interval logic
        // If scale is high (>50), show every 0.1s. If low, show every 1s or 5s.
        let majorInterval = 1000; // 1s
        let minorInterval = 100; // 0.1s

        if (pixelsPerSec < 20) {
            majorInterval = 5000;
            minorInterval = 1000;
        } else if (pixelsPerSec < 50) {
            majorInterval = 2000;
            minorInterval = 500;
        }

        const durationMs = (width / pixelsPerSec) * 1000;

        ctx.beginPath();
        for (let t = 0; t <= durationMs; t += minorInterval) {
            const x = (t / 1000) * pixelsPerSec;

            // Major Tick
            if (t % majorInterval === 0) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.fillText(formatTimeCode(t), x + 4, 2);
            }
            // Minor Tick
            else {
                ctx.moveTo(x, height - 6);
                ctx.lineTo(x, height);
            }
        }
        ctx.stroke();

    }, [totalWidth, pixelsPerSec, segments]); // Redraw when scale or duration changes


    // --- Mouse Handlers ---

    const getTimeFromEvent = (e: React.MouseEvent | MouseEvent) => {
        if (!containerRef.current) return 0;
        const rect = containerRef.current.getBoundingClientRect();
        // Mouse X relative to container viewport
        // But container Scrolls, so we must add scrollLeft
        const x = e.clientX - rect.left + containerRef.current.scrollLeft;
        return (x / pixelsPerSec) * 1000;
    };

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const time = getTimeFromEvent(e);
        setHoverTime(time);

        if (isCTIScrubbing) {
            setCurrentTime(Math.max(0, Math.min(time, totalDuration)));
        }
    }, [isCTIScrubbing, pixelsPerSec, totalDuration, setCurrentTime]);

    const handleMouseDown = (e: React.MouseEvent) => {
        // Only start scrubbing if not clicking a clip handle
        // (Clip handles stopPropagation, so this should be fine)
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

    // Global drag end for CTI scrubbing (just in case mouse leaves during drag)
    useEffect(() => {
        const up = () => setIsCTIScrubbing(false);
        window.addEventListener('mouseup', up);
        return () => window.removeEventListener('mouseup', up);
    }, []);


    // --- Trimming interactions (Existing) ---
    const handleDragStart = (e: React.MouseEvent, id: string, type: 'left' | 'right', currentVal: number) => {
        e.stopPropagation(); // Prevent CTI scrubbing
        setDraggingId(id);
        setDragType(type);
        setDragStartX(e.clientX);
        setDragStartVal(currentVal);
    };

    useEffect(() => {
        const handleWinMouseMove = (e: MouseEvent) => {
            if (!draggingId || !dragType) return;
            const deltaX = e.clientX - dragStartX;
            const deltaMs = (deltaX / pixelsPerSec) * 1000;

            const segment = segments.find(s => s.id === draggingId);
            if (!segment) return;

            // Logic...
            let newStart = segment.sourceStart;
            let newEnd = segment.sourceEnd;

            if (dragType === 'left') {
                newStart = Math.min(Math.max(0, dragStartVal + deltaMs), segment.sourceEnd - 100);
            } else {
                newEnd = Math.max(segment.sourceStart + 100, dragStartVal + deltaMs);
            }
            updateSegment(draggingId, newStart, newEnd);
        };

        const handleWinMouseUp = () => {
            setDraggingId(null);
            setDragType(null);
        };

        if (draggingId) {
            window.addEventListener('mousemove', handleWinMouseMove);
            window.addEventListener('mouseup', handleWinMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleWinMouseMove);
                window.removeEventListener('mouseup', handleWinMouseUp);
            };
        }
    }, [draggingId, dragType, dragStartX, dragStartVal, segments, pixelsPerSec, updateSegment]);


    // Styling constants
    const TRACK_HEIGHT = 40;

    // --- Format Helper for Toolbar ---
    const formatFullTime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        const dec = Math.floor((ms % 1000) / 100);
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${dec}`;
    };

    // Calculate segments layout
    const virtualSegments = useMemo(() => {
        let currentVirtual = 0;
        return segments.map(seg => {
            const duration = seg.sourceEnd - seg.sourceStart;
            const start = currentVirtual;
            currentVirtual += duration;
            return { ...seg, virtualStart: start, virtualEnd: currentVirtual, duration };
        });
    }, [segments]);

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] select-none text-white font-sans">
            {/* 1. Toolbar */}
            <div className="h-10 flex items-center px-2 bg-[#252526] border-b border-[#333] shrink-0 justify-between">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => splitSegment(currentTime)}
                        className="flex items-center gap-1 px-3 py-1 bg-[#333] hover:bg-[#444] rounded text-xs font-medium transition-colors"
                    >
                        ✂️ Split
                    </button>
                    <div className="w-[1px] h-4 bg-[#444] mx-2"></div>
                </div>

                <div className="flex items-center gap-4 bg-[#111] px-4 py-1 rounded-full border border-[#333]">
                    <button onClick={() => setIsPlaying(!isPlaying)} className="hover:text-green-400">
                        {isPlaying ? '⏸' : '▶️'}
                    </button>
                    <div className="font-mono text-xs text-gray-400 w-32 text-center">
                        {formatFullTime(currentTime)} / {formatFullTime(totalDuration)}
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

            {/* 2. Timeline Surface (Handles Scroll & Mouse events) */}
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
                    {/* Ruler (Canvas) */}
                    <div className="sticky top-0 z-10 bg-[#1e1e1e] border-b border-[#333]">
                        <canvas ref={rulerCanvasRef} className="block pointer-events-none" style={{ height: '24px' }} />
                    </div>

                    {/* Tracks Container */}
                    <div className="py-2 flex flex-col gap-1">

                        {/* Video Track */}
                        <div className="relative w-full" style={{ height: TRACK_HEIGHT }}>
                            {virtualSegments.map((seg) => {
                                const left = (seg.virtualStart / 1000) * pixelsPerSec;
                                const width = (seg.duration / 1000) * pixelsPerSec;

                                return (
                                    <div
                                        key={seg.id}
                                        className="absolute top-0 bottom-0 bg-green-600/90 border border-green-500/50 rounded-md overflow-hidden group hover:brightness-110 transition-all cursor-pointer box-border"
                                        style={{ left: `${left}px`, width: `${width}px` }}
                                        onClick={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()} // Prevent CTI scrubbing start when clicking clip
                                    >
                                        <div className="flex items-center px-2 h-full gap-2 text-xs font-medium text-white shadow-sm">
                                            <span>🎥 Clip</span>
                                            <span className="opacity-70 font-normal">{(seg.duration / 1000).toFixed(1)}s</span>
                                        </div>

                                        <div
                                            className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-white/30 z-20"
                                            onMouseDown={(e) => handleDragStart(e, seg.id, 'left', seg.sourceStart)}
                                        />
                                        <div
                                            className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-white/30 z-20"
                                            onMouseDown={(e) => handleDragStart(e, seg.id, 'right', seg.sourceEnd)}
                                        />
                                    </div>
                                );
                            })}
                        </div>

                        {/* Zoom Track */}
                        <div className="relative w-full" style={{ height: TRACK_HEIGHT }}>
                            {metadata.map((item, index) => {
                                let virtualStart = -1;
                                let currentVirtual = 0;
                                let found = false;
                                for (const seg of segments) {
                                    if (item.timestamp >= seg.sourceStart && item.timestamp <= seg.sourceEnd) {
                                        virtualStart = currentVirtual + (item.timestamp - seg.sourceStart);
                                        found = true;
                                        break;
                                    }
                                    currentVirtual += (seg.sourceEnd - seg.sourceStart);
                                }

                                if (!found) return null;

                                const duration = 3000;
                                const left = (virtualStart / 1000) * pixelsPerSec;
                                const width = (duration / 1000) * pixelsPerSec;

                                return (
                                    <div
                                        key={index}
                                        className="absolute top-0 bottom-0 bg-[#00acc1] border border-[#00acc1] rounded-md overflow-hidden text-xs text-white flex items-center px-2 shadow-sm"
                                        style={{ left: `${left}px`, width: `${width}px` }}
                                    >
                                        🔍 Zoom
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Hover Line (Phantom CTI) */}
                    {hoverTime !== null && (
                        <div
                            className="absolute top-0 bottom-0 w-[1px] bg-white/30 z-20 pointer-events-none"
                            style={{ left: `${(hoverTime / 1000) * pixelsPerSec}px` }}
                        />
                    )}

                    {/* CTI (Current Time Indicator) */}
                    <div
                        className="absolute top-0 bottom-0 w-[1px] bg-red-500 z-30 pointer-events-none"
                        style={{ left: `${(currentTime / 1000) * pixelsPerSec}px` }}
                    >
                        <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-red-500"></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

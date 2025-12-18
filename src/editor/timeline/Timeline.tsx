import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { useProject } from '../../hooks/useProject';
import { TimelineRuler } from './TimelineRuler';
import { TimelineTrackVideo } from './TimelineTrackVideo';
import type { Clip } from '../../core/types';

// Constants
const MIN_PIXELS_PER_SEC = 10;
const MAX_PIXELS_PER_SEC = 200;
const TRACK_HEIGHT = 40;

export function Timeline() {
    const containerRef = useRef<HTMLDivElement>(null);

    // Legacy store for UI state (zoom/pixelsPerSec could move to store but keeping local for now if preferred)
    // Actually using store for isPlaying/currentTime since App.tsx might still drive it separately?
    // Plan said "Subsribe to useProject".
    // useProject has currentTimeMs and isPlaying.
    const {
        project,
        currentTimeMs,
        isPlaying,
        setCurrentTime,
        setIsPlaying,
        splitAt,
        updateClip
    } = useProject();

    // Zoom Level (Timeline Scale)
    const [pixelsPerSec, setPixelsPerSec] = useState(100);

    // TODO: Calculate total duration dynamically or from project
    // Project duration might not be updated automatically by core yet?
    // Let's calculate max end time of all clips.
    const totalDuration = useMemo(() => {
        let max = 10000; // Default min duration
        project.timeline.tracks.forEach(t => {
            t.clips.forEach(c => {
                const end = userClipEnd(c);
                if (end > max) max = end;
            });
        });
        return max;
    }, [project]);

    const totalWidth = (totalDuration / 1000) * pixelsPerSec;

    // Interaction State
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [isCTIScrubbing, setIsCTIScrubbing] = useState(false);

    // Dragging State
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragType, setDragType] = useState<'left' | 'right' | null>(null);
    const [dragStartX, setDragStartX] = useState(0);

    // Snapshot of clip BEFORE drag starts, to calculate deltas correctly
    // We store the COPY of the clip to avoid reference issues.
    const [initialClipState, setInitialClipState] = useState<Clip | null>(null);

    // --- Mouse Handlers ---

    const getTimeFromEvent = (e: React.MouseEvent | MouseEvent) => {
        if (!containerRef.current) return 0;
        const rect = containerRef.current.getBoundingClientRect();
        // Determine scroll offset safely
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

    // --- Dragging Logic for Trimming ---
    useEffect(() => {
        if (!draggingId || !dragType || !initialClipState) return;

        const handleGlobalMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - dragStartX;
            const deltaMs = (deltaX / pixelsPerSec) * 1000;
            const clip = initialClipState;

            // Find the track for this clip (expensive lookup but safe)
            const track = project.timeline.tracks.find(t => t.clips.some(c => c.id === clip.id));
            if (!track) return;

            let newClip = { ...clip };

            if (dragType === 'left') {
                // Moving Start: Affects timelineIn AND sourceIn
                // Delta is additive. 
                // Ex: Drag right (+100ms). Start moves later.
                // sourceIn increases by delta * speed.

                // Constraints:
                // 1. Cannot move past end (timelineIn < timelineOut)
                // 2. Cannot move before 0 (timelineIn >= 0)
                // 3. sourceIn cannot exceed sourceOut
                // 4. sourceIn cannot be < 0

                const proposedTimelineIn = Math.max(0, clip.timelineInMs + deltaMs);
                const timelineDelta = proposedTimelineIn - clip.timelineInMs;
                const sourceDelta = timelineDelta * clip.speed; // if speed 2x, 1s timeline = 2s source

                const proposedSourceIn = clip.sourceInMs + sourceDelta;

                // Check invalid duration
                if (proposedSourceIn >= clip.sourceOutMs) return;

                newClip.timelineInMs = proposedTimelineIn;
                newClip.sourceInMs = proposedSourceIn;

            } else {
                // Moving End: Affects sourceOut only (timelineIn constant)
                // Ex: Drag right (+100ms). Duration increases.
                // sourceOut increases.

                // Timeline delta is what we see. Source delta derived.
                const sourceDelta = deltaMs * clip.speed;
                const proposedSourceOut = clip.sourceOutMs + sourceDelta;

                // Check invalid duration (sourceIn < sourceOut)
                if (proposedSourceOut <= clip.sourceInMs) return;

                // Check Max Source Duration? (Source constraints not strictly enforced here but should be)
                // Assuming we can extend infinitely for now or relying on validation to fail/clamp?
                // Ideally we clamp to source media duration.
                // Assuming infinite source for now or user responsibility.

                newClip.sourceOutMs = proposedSourceOut;
            }

            // Dispatch Update
            updateClip(track.id, newClip);
        };

        const handleGlobalMouseUp = () => {
            setDraggingId(null);
            setDragType(null);
            setInitialClipState(null);
        };

        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [draggingId, dragType, dragStartX, initialClipState, pixelsPerSec, project, updateClip]);

    const handleDragStart = (e: React.MouseEvent, id: string, type: 'left' | 'right') => {
        e.preventDefault();
        e.stopPropagation();

        // Find the clip object
        let foundClip: Clip | null = null;
        for (const t of project.timeline.tracks) {
            const c = t.clips.find(c => c.id === id);
            if (c) {
                foundClip = c;
                break;
            }
        }

        if (foundClip) {
            setDraggingId(id);
            setDragType(type);
            setDragStartX(e.clientX);
            setInitialClipState(foundClip);
        }
    };

    // --- Format Helper ---
    const formatFullTime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        const dec = Math.floor((ms % 1000) / 100);
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${dec}`;
    };

    // Find video tracks (assume all are video type for now or filter)
    // We want to render them.
    const videoTracks = project.timeline.tracks.filter(t => t.type === 'video');

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] select-none text-white font-sans">
            {/* 1. Toolbar */}
            <div className="h-10 flex items-center px-2 bg-[#252526] border-b border-[#333] shrink-0 justify-between">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => splitAt(currentTimeMs)}
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
                    <div className="py-2 flex flex-col gap-1">

                        {videoTracks.map(track => (
                            <TimelineTrackVideo
                                key={track.id}
                                clips={track.clips}
                                pixelsPerSec={pixelsPerSec}
                                trackHeight={TRACK_HEIGHT}
                                onDragStart={handleDragStart}
                            />
                        ))}
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

// Helper
function userClipEnd(c: Clip) {
    return c.timelineInMs + (c.sourceOutMs - c.sourceInMs) / c.speed;
}

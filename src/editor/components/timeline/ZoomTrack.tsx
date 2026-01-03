import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { TimeMapper } from '../../../core/timeMapper';
import type { ViewportMotion } from '../../../core/types';

interface ZoomTrackProps {
    pixelsPerSec: number;
    height: number;
    timelineOffset: number;
}

interface DragState {
    type: 'move' | 'resize-left';
    motionId: string;
    startX: number;
    initialSourceEndTime: number;
    initialDuration: number;
    constraintMinTime: number; // Hard limit for (SourceEndTime - Duration) or SourceEndTime depending on op
    constraintMaxTime: number; // Hard limit for SourceEndTime
}

interface HoverInfo {
    timeMs: number; // Mouse time
    x: number;
    sourceStartTime: number;
    sourceEndTime: number;
    width: number;
    isValid: boolean;
}

export const ZoomTrack: React.FC<ZoomTrackProps> = ({ pixelsPerSec, height, timelineOffset }) => {
    const timeline = useProjectTimeline();
    const addViewportMotion = useProjectStore(s => s.addViewportMotion);
    const updateViewportMotion = useProjectStore(s => s.updateViewportMotion);
    const editingZoomId = useProjectStore(s => s.activeZoomId);
    const setEditingZoom = useProjectStore(s => s.setEditingZoom);
    const project = useProjectStore(s => s.project);

    // Memoize TimeMapper for consistent usage
    const timeMapper = useMemo(() => {
        return new TimeMapper(timelineOffset, timeline.outputWindows);
    }, [timelineOffset, timeline.outputWindows]);

    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);

    // ------------------------------------------------------------------
    // MOUSE HANDLERS (HOVER & CLICK-TO-ADD)
    // ------------------------------------------------------------------

    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const timeMs = (x / pixelsPerSec) * 1000;
        let mouseSourceTimeMs = timeMs - timelineOffset; // This is simplistic, assuming linear offset. Ideally use inverse mapping if possible, but standard here.

        // Calculate Max Source Time based on last window
        // This prevents floating point issues where we click "past" the end
        const lastWindow = timeline.outputWindows[timeline.outputWindows.length - 1];
        if (lastWindow) {
            const maxSourceTime = lastWindow.endMs - timelineOffset;
            if (mouseSourceTimeMs > maxSourceTime) {
                mouseSourceTimeMs = maxSourceTime;
            }
        }

        if (mouseSourceTimeMs < 0) {
            setHoverInfo(null);
            return;
        }

        const motions = timeline.recording.viewportMotions || [];

        // 1. Check if we are inside an existing motion
        const isInside = motions.some(m => {
            const start = m.sourceEndTimeMs - m.durationMs;
            const end = m.sourceEndTimeMs;
            return mouseSourceTimeMs > start && mouseSourceTimeMs < end;
        });

        if (isInside) {
            setHoverInfo(null);
            return;
        }

        // 2. Calculate Available Duration backwards (to the left)
        // Find the closest previous motion end
        let prevEnd = 0;
        for (const m of motions) {
            if (m.sourceEndTimeMs <= mouseSourceTimeMs) {
                if (m.sourceEndTimeMs > prevEnd) {
                    prevEnd = m.sourceEndTimeMs;
                }
            }
        }

        const defaultDur = project.settings.zoom.defaultDurationMs;
        const availableDuration = mouseSourceTimeMs - prevEnd;

        // Clamp duration
        const actualDuration = Math.min(defaultDur, availableDuration);

        // If duration is too small (e.g. < 50ms), maybe don't show or invalid? 
        if (actualDuration < 50) {
            setHoverInfo(null);
            return;
        }

        const sourceEndTime = mouseSourceTimeMs;
        const sourceStartTime = mouseSourceTimeMs - actualDuration;

        // Calculate visual width/position using TimeMapper to be safe with cuts
        // (Though current logic implies simplistic Time->X, let's try to be consistent)
        // Actually, if we use timeMs directly for X, we assume linear. 
        // Let's use standard per-pixel logic for width for now to match other parts.
        const width = (actualDuration / 1000) * pixelsPerSec;

        setHoverInfo({
            timeMs,
            x,
            sourceStartTime,
            sourceEndTime,
            width,
            isValid: true
        });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return;

        // If currently editing a zoom, a click on the background should exit edit mode
        // instead of creating a new one (preventing accidental creation)
        if (editingZoomId) {
            setEditingZoom(null);
            return;
        }

        if (!hoverInfo || !hoverInfo.isValid) return;

        // Create Motion
        const newMotion: ViewportMotion = {
            id: crypto.randomUUID(),
            sourceEndTimeMs: hoverInfo.sourceEndTime,
            durationMs: hoverInfo.sourceEndTime - hoverInfo.sourceStartTime,
            reason: 'Manual Zoom',
            rect: { ...project.settings.outputSize, x: 0, y: 0 }
        };

        addViewportMotion(newMotion);
        setEditingZoom(newMotion.id);
        setHoverInfo(null);
    };


    // ------------------------------------------------------------------
    // DRAG HANDLERS (MOVE & RESIZE)
    // ------------------------------------------------------------------

    const handleDragStart = (e: React.MouseEvent, type: 'move' | 'resize-left', motion: ViewportMotion) => {
        e.stopPropagation();

        // Calculate Constraints
        const motions = timeline.recording.viewportMotions || [];
        const sortedMotions = [...motions].sort((a, b) => a.sourceEndTimeMs - b.sourceEndTimeMs);
        const myIndex = sortedMotions.findIndex(m => m.id === motion.id);

        const prevMotion = myIndex > 0 ? sortedMotions[myIndex - 1] : null;
        const nextMotion = myIndex < sortedMotions.length - 1 ? sortedMotions[myIndex + 1] : null;

        let constraintMinTime = 0;
        let constraintMaxTime = Infinity;

        if (prevMotion) {
            constraintMinTime = prevMotion.sourceEndTimeMs;
        }

        if (nextMotion) {
            constraintMaxTime = nextMotion.sourceEndTimeMs - nextMotion.durationMs;
        }

        setDragState({
            type,
            motionId: motion.id,
            startX: e.clientX,
            initialSourceEndTime: motion.sourceEndTimeMs,
            initialDuration: motion.durationMs,
            constraintMinTime,
            constraintMaxTime
        });
        setEditingZoom(motion.id);
    };

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaTimeMs = (deltaX / pixelsPerSec) * 1000;

        const { initialSourceEndTime, initialDuration, constraintMinTime, constraintMaxTime } = dragState;

        // Apply Logic
        if (dragState.type === 'move') {
            let newEndTime = initialSourceEndTime + deltaTimeMs;
            const newStartTime = newEndTime - initialDuration;

            // Constrain Start
            if (newStartTime < constraintMinTime) {
                newEndTime = constraintMinTime + initialDuration;
            }

            // Constrain End
            if (newEndTime > constraintMaxTime) {
                newEndTime = constraintMaxTime;
            }

            // Also clamp 0
            if ((newEndTime - initialDuration) < 0) {
                newEndTime = initialDuration;
            }

            updateViewportMotion(dragState.motionId, {
                sourceEndTimeMs: newEndTime
            });
        } else if (dragState.type === 'resize-left') {
            let newDuration = initialDuration - deltaTimeMs;

            const MIN_DURATION = 100;
            if (newDuration < MIN_DURATION) newDuration = MIN_DURATION;

            const maxDuration = initialSourceEndTime - constraintMinTime;
            if (newDuration > maxDuration) newDuration = maxDuration;

            if (initialSourceEndTime - newDuration < 0) {
                newDuration = initialSourceEndTime;
            }

            updateViewportMotion(dragState.motionId, {
                durationMs: newDuration
            });
        }

    }, [dragState, pixelsPerSec, updateViewportMotion]);

    const handleGlobalMouseUp = useCallback(() => {
        if (dragState) {
            setDragState(null);
        }
    }, [dragState]);

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


    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------

    return (
        <div
            className="w-full relative bg-[#252526] select-none"
            style={{ height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleClick}
        >
            <div className="absolute left-2 top-0 text-[10px] text-gray-500 font-mono pointer-events-none z-10">MOTION</div>

            {/* Existing Motions */}
            {timeline.recording.viewportMotions?.map((m) => {
                const outputEndTime = timeMapper.mapSourceToOutputTime(m.sourceEndTimeMs);
                if (outputEndTime === -1) return null;

                const outputStartTime = outputEndTime - m.durationMs;
                const timelineEndMs = timeMapper.mapOutputToTimelineTime(outputEndTime);
                const timelineStartMs = timeMapper.mapOutputToTimelineTime(Math.max(0, outputStartTime));

                if (timelineEndMs === -1 || timelineStartMs === -1) return null;

                const left = (timelineStartMs / 1000) * pixelsPerSec;
                const width = ((timelineEndMs - timelineStartMs) / 1000) * pixelsPerSec;

                if (width <= 0) return null;

                const isSelected = editingZoomId === m.id;
                const isDragging = dragState?.motionId === m.id;

                return (
                    <div
                        key={m.id}
                        className={`absolute top-[4px] bottom-[4px] group rounded-sm transition-colors border
                            ${isSelected ? 'bg-purple-500/40 border-purple-400' : 'bg-purple-500/20 border-purple-500/30 hover:bg-purple-500/30'}
                            ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
                        `}
                        style={{
                            left: `${left}px`,
                            width: `${Math.max(width, 2)}px`,
                            zIndex: isSelected ? 20 : 10
                        }}
                        onMouseDown={(e) => handleDragStart(e, 'move', m)}
                        onClick={(e) => {
                            e.stopPropagation();
                            setEditingZoom(m.id);
                        }}
                    >
                        {/* Left Resize Handle */}
                        <div
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-purple-400/50 z-20"
                            onMouseDown={(e) => handleDragStart(e, 'resize-left', m)}
                        />

                        {/* Right Edge (Keyframe) - Thicker, Opaque */}
                        <div
                            className={`absolute right-0 top-0 bottom-0 w-1.5 ${isSelected ? 'bg-yellow-400' : 'bg-purple-500'} shadow-sm`}
                        />

                        {/* Label (Optional) */}
                        {width > 40 && (
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[9px] text-purple-200/70 pointer-events-none truncate max-w-full">
                                {parseFloat((project.settings.outputSize.width / m.rect.width).toFixed(1))}x
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Add Zoom Indicator */}
            {hoverInfo && !editingZoomId && !dragState && hoverInfo.isValid && (
                <div
                    className="absolute top-[4px] bottom-[4px] pointer-events-none z-0 border border-yellow-500/50 bg-yellow-500/10 rounded-sm flex items-center justify-center"
                    style={{
                        // Use calculated width (pixel based on time)
                        // Position: right aligned to mouse X (hoverInfo.x).
                        // Left = Right - Width
                        left: `${hoverInfo.x - hoverInfo.width}px`,
                        width: `${hoverInfo.width}px`
                    }}
                >
                    {/* Add Zoom Label (Above) */}
                    <div className="absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-yellow-200/90 pointer-events-none bg-[#252526]/80 px-1 rounded">
                        Add Zoom
                    </div>

                    {/* Right Handle */}
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-yellow-500/50" />

                    {/* Plus Icon */}
                    <span className="text-yellow-200 text-lg font-light leading-none">+</span>
                </div>
            )}
        </div>
    );
};

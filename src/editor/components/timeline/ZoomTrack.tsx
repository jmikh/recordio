import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { TimeMapper } from '../../../core/timeMapper';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
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
    initialOutputTime: number; // Anchor in Output Time
    initialSourceEndTime: number;
    initialDuration: number;
    // Constraints can stay relative or simplified
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

    // UI State
    const editingZoomId = useUIStore(s => s.selectedZoomId);
    const setEditingZoom = (id: string | null) => {
        const store = useUIStore.getState();
        store.selectZoom(id);
    };

    const project = useProjectStore(s => s.project);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

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
        // Since we are handling mouse on the wrapper (including header), 
        const rawX = e.clientX - rect.left;
        const x = rawX;

        // Output Time (Continuous)
        const outputTimeMs = (x / pixelsPerSec) * 1000;

        // Map Output -> Source
        // If we are in a gap or after end, mapOutputToSourceTime returns -1?
        // Actually mapOutputToSourceTime handles 0..Total mapped.
        // If x is past end, outputTimeMs > total. map returns -1.
        let mouseSourceTimeMs = timeMapper.mapOutputToSourceTime(outputTimeMs);

        if (mouseSourceTimeMs === -1) {
            setHoverInfo(null);
            return;
        }

        const motions = timeline.recording.viewportMotions || [];

        // 1. Check if we are inside an existing motion
        // We check using source interval
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

        if (actualDuration < 50) {
            setHoverInfo(null);
            return;
        }

        const sourceEndTime = mouseSourceTimeMs;
        const sourceStartTime = mouseSourceTimeMs - actualDuration;

        // Calculate visual width mapping back to Output
        const outputEndTime = outputTimeMs;
        // Start might map to -1 if duration spans across cut into gap.
        // We assume contiguous for adding new zoom? Or we clamp?
        // If we just mapped Output->Source, then `sourceEndTime` is valid.
        // `sourceStartTime` might be in gap?
        // Check output start
        let outputStartTime = timeMapper.mapSourceToOutputTime(sourceStartTime);

        // If start is invalid (gap), clamp to nearest window start?
        // Since we are "adding" a zoom, maybe we just use standard width (pixels)?
        // If the duration is truly 600ms, and it fits in the clip, fine.
        // If it crosses a cut, it might effectively be shorter visually.
        // Let's rely on TimeMapper mapping.

        if (outputStartTime === -1) {
            // Fallback: If map fails, it means start is not visible.
            // We can find the window containing sourceEndTime and clamp to its start.
            // But for Hover UI, maybe just `outputEndTime - duration` is easier visual approximation?
            // No, `left` depends on it.
            // Let's assume standard width for hover to avoid jitter.
            outputStartTime = outputEndTime - actualDuration;
        }

        const width = ((outputEndTime - outputStartTime) / 1000) * pixelsPerSec;

        setHoverInfo({
            timeMs: outputTimeMs,
            x, // X is relative to track content start
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

        const outputEndTime = timeMapper.mapSourceToOutputTime(motion.sourceEndTimeMs);
        if (outputEndTime === -1) return; // Should be impossible if clicked

        setDragState({
            type,
            motionId: motion.id,
            startX: e.clientX,
            initialOutputTime: outputEndTime,
            initialSourceEndTime: motion.sourceEndTimeMs,
            initialDuration: motion.durationMs
        });
        startInteraction();
        setEditingZoom(motion.id);
    };

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaTimeMs = (deltaX / pixelsPerSec) * 1000;

        const { initialOutputTime, initialDuration } = dragState;

        // Apply Logic
        if (dragState.type === 'move') {
            const newOutputTime = initialOutputTime + deltaTimeMs;
            const newSourceEndTime = timeMapper.mapOutputToSourceTime(newOutputTime);

            if (newSourceEndTime !== -1) {
                batchAction(() => updateViewportMotion(dragState.motionId, {
                    sourceEndTimeMs: newSourceEndTime
                }));
            }
        } else if (dragState.type === 'resize-left') {
            let newDuration = initialDuration - deltaTimeMs;

            const MIN_DURATION = 100;
            if (newDuration < MIN_DURATION) newDuration = MIN_DURATION;

            // Optional: Max Duration constraint could be complicated with gaps
            // For now, let's just allow it, if it starts in a gap, visualization handles it.

            // Check bounds?
            // if (initialSourceEndTime - newDuration < 0) ...

            batchAction(() => updateViewportMotion(dragState.motionId, {
                durationMs: newDuration
            }));
        }

    }, [dragState, pixelsPerSec, updateViewportMotion, timeMapper, batchAction]);

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


    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------

    return (
        <div
            className="w-full relative bg-[#252526] select-none flex"
            style={{ height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleClick}
        >


            {/* Content Area */}
            <div className="relative flex-1" style={{ height }}>
                {/* Existing Motions */}
                {timeline.recording.viewportMotions?.map((m) => {
                    const outputEndTime = timeMapper.mapSourceToOutputTime(m.sourceEndTimeMs);
                    if (outputEndTime === -1) return null;

                    const sourceStartTime = m.sourceEndTimeMs - m.durationMs;
                    let outputStartTime = timeMapper.mapSourceToOutputTime(sourceStartTime);

                    // If start is invalid (in gap), clamp to specific window start
                    // We know outputEndTime is valid, so find its window.
                    if (outputStartTime === -1) {
                        const win = timeline.outputWindows.find(w => m.sourceEndTimeMs >= w.startMs && m.sourceEndTimeMs <= w.endMs);
                        if (win) {
                            outputStartTime = timeMapper.mapTimelineToOutputTime(win.startMs);
                        } else {
                            // Should technically not happen if outputEndTime is valid (which relies on being in a window)
                            return null; // fallback
                        }
                    }

                    if (outputStartTime === -1) return null;

                    const left = (outputStartTime / 1000) * pixelsPerSec;
                    const width = ((outputEndTime - outputStartTime) / 1000) * pixelsPerSec;

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
        </div>
    );
};

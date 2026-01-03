import React, { useState, useEffect, useCallback } from 'react';
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
}

export const ZoomTrack: React.FC<ZoomTrackProps> = ({ pixelsPerSec, height, timelineOffset }) => {
    const timeline = useProjectTimeline();
    const addViewportMotion = useProjectStore(s => s.addViewportMotion);
    const updateViewportMotion = useProjectStore(s => s.updateViewportMotion);
    const editingZoomId = useProjectStore(s => s.editingZoomId);
    const setEditingZoom = useProjectStore(s => s.setEditingZoom);
    const setEditingCrop = useProjectStore(s => s.setEditingCrop);
    const project = useProjectStore(s => s.project);

    const [hoverInfo, setHoverInfo] = useState<{ timeMs: number, x: number } | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);

    // ------------------------------------------------------------------
    // MOUSE HANDLERS (HOVER & CLICK-TO-ADD)
    // ------------------------------------------------------------------

    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const timeMs = (x / pixelsPerSec) * 1000;
        setHoverInfo({ timeMs, x });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return; // Ignore click if we were dragging
        if (!hoverInfo) return;

        const sourceTimeMs = hoverInfo.timeMs - timelineOffset;
        if (sourceTimeMs < 0) return;

        // Create Motion
        const defaultDur = project.settings.zoom.defaultDurationMs || 1500;

        const newMotion: ViewportMotion = {
            id: crypto.randomUUID(),
            sourceEndTimeMs: sourceTimeMs,
            durationMs: defaultDur,
            reason: 'Manual Zoom',
            rect: { ...project.settings.outputSize, x: 0, y: 0 } // Default to full screen
        };

        addViewportMotion(newMotion);
        setEditingZoom(newMotion.id);
        setEditingCrop(true);
    };


    // ------------------------------------------------------------------
    // DRAG HANDLERS (MOVE & RESIZE)
    // ------------------------------------------------------------------

    const handleDragStart = (e: React.MouseEvent, type: 'move' | 'resize-left', motion: ViewportMotion) => {
        e.stopPropagation();
        setDragState({
            type,
            motionId: motion.id,
            startX: e.clientX,
            initialSourceEndTime: motion.sourceEndTimeMs,
            initialDuration: motion.durationMs
        });
        setEditingZoom(motion.id);
    };

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaTimeMs = (deltaX / pixelsPerSec) * 1000;

        // Apply Logic
        if (dragState.type === 'move') {
            const newEndTime = Math.max(0, dragState.initialSourceEndTime + deltaTimeMs);
            updateViewportMotion(dragState.motionId, {
                sourceEndTimeMs: newEndTime
            });
        } else if (dragState.type === 'resize-left') {
            // Dragging left handle:
            // Moving Left (negative delta) -> Duration Increases (Start time moves earlier)
            // Moving Right (positive delta) -> Duration Decreases (Start time moves later)
            // End Time remains FIXED.

            // New Duration = Initial Duration - Delta
            // Example: Drag left by -1 sec. Delta = -1000. New Dur = Init - (-1000) = Init + 1000. Correct.
            const newDuration = Math.max(100, dragState.initialDuration - deltaTimeMs);

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
            className="w-full relative bg-[#252526] overflow-hidden select-none"
            style={{ height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
        >
            <div className="absolute left-2 top-0 text-[10px] text-gray-500 font-mono pointer-events-none z-10">MOTION</div>

            {/* Existing Motions */}
            {timeline.recording.viewportMotions?.map((m) => {
                const timeMapper = new TimeMapper(timelineOffset, timeline.outputWindows);

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
                                {m.reason}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Add Zoom Indicator */}
            {hoverInfo && !editingZoomId && !dragState && (
                <div
                    className="absolute top-0 bottom-0 w-[1px] bg-yellow-500/50 dashed z-0 pointer-events-none flex items-center justify-center"
                    style={{ left: `${hoverInfo.x}px` }}
                >
                    <div className="bg-yellow-500/20 text-yellow-200 text-[9px] px-1 rounded transform -translate-y-4 whitespace-nowrap">
                        + Add Zoom
                    </div>
                </div>
            )}
        </div>
    );
};

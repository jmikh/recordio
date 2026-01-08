import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { TimeMapper } from '../../../core/timeMapper';
import { TimePixelMapper } from '../../utils/timePixelMapper';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import type { ViewportMotion } from '../../../core/types';


interface ZoomTrackProps {
    height: number;
}

interface DragState {
    type: 'move';
    motionId: string;
    startX: number;
    initialOutputTime: number; // Anchor in Output Time
    initialSourceEndTime: number;
    // Constraints can stay relative or simplified
}

interface HoverInfo {
    x: number;
    sourceEndTime: number;
    durationMs: number;
    width: number;
}

/**
 * Calculate boundary constraints for a zoom block.
 * Returns the end of the previous block (or 0) and the start of the next block (or timelineEnd).
 * 
 * This scans all other blocks to find the closest ones in either direction.
 */
function getZoomBlockBounds(
    targetMotionId: string | null,
    motions: ViewportMotion[],
    timelineEnd: number
): { prevEnd: number; nextStart: number } {
    // Find the current block position to determine what's "before" and "after"
    const currentMotion = targetMotionId
        ? motions.find(m => m.id === targetMotionId)
        : null;

    // If no current motion, default to finding closest to start
    const referenceEnd = currentMotion?.sourceEndTimeMs ?? 0;
    const referenceStart = currentMotion
        ? currentMotion.sourceEndTimeMs - currentMotion.durationMs
        : 0;

    let prevEnd = 0;
    let nextStart = timelineEnd;

    for (const m of motions) {
        if (m.id === targetMotionId) continue;
        const mEnd = m.sourceEndTimeMs;
        const mStart = m.sourceEndTimeMs - m.durationMs;

        // A block is "previous" if it's entirely before our current start
        if (mEnd <= referenceStart && mEnd > prevEnd) {
            prevEnd = mEnd;
        }
        // A block is "next" if it starts at or after our current end
        if (mStart >= referenceEnd && mStart < nextStart) {
            nextStart = mStart;
        }
    }

    return { prevEnd, nextStart };
}

export const ZoomTrack: React.FC<ZoomTrackProps> = ({ height }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
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

    // Memoize TimeMapper and TimePixelMapper for consistent usage
    const timeMapper = useMemo(() => {
        return new TimeMapper(timeline.outputWindows);
    }, [timeline.outputWindows]);

    const coords = useMemo(() => {
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeMapper, pixelsPerSec]);

    // Derive output duration from output windows
    const outputDuration = useMemo(() => {
        return timeMapper.getOutputDuration();
    }, [timeMapper]);

    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);

    // ------------------------------------------------------------------
    // MOUSE HANDLERS (HOVER & CLICK-TO-ADD)
    // ------------------------------------------------------------------

    /**
     * Handles hover interactions for 'Add Zoom' ghost block.
     * DISABLED while dragging to prevent interference/ghost blocks appearing during drag.
     */
    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;

        // Convert x to source time (chains through TimeMapper)
        let mouseSourceTimeMs = coords.xToSourceTime(x);

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

        const defaultDur = project.settings.zoom.maxZoomDurationMs;
        const availableDuration = mouseSourceTimeMs - prevEnd;

        // Clamp duration
        let actualDuration = Math.min(defaultDur, availableDuration);
        let sourceEndTime = mouseSourceTimeMs;

        if (actualDuration < project.settings.zoom.minZoomDurationMs) {
            actualDuration = project.settings.zoom.minZoomDurationMs;
            sourceEndTime = prevEnd + actualDuration;
        }

        // Calculate visual width and position
        const width = coords.msToX(actualDuration);
        const constrainedX = coords.sourceTimeToX(sourceEndTime);

        setHoverInfo({
            x: constrainedX,
            durationMs: actualDuration,
            sourceEndTime,
            width,
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

        if (!hoverInfo) return;

        // Create Motion
        const newMotion: ViewportMotion = {
            id: crypto.randomUUID(),
            sourceEndTimeMs: hoverInfo.sourceEndTime,
            durationMs: hoverInfo.durationMs,
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

    const handleDragStart = (e: React.MouseEvent, type: 'move', motion: ViewportMotion) => {
        e.stopPropagation();

        const outputEndTimeX = coords.sourceTimeToX(motion.sourceEndTimeMs);
        if (outputEndTimeX === -1) return; // Should be impossible if clicked

        const outputEndTime = coords.xToMs(outputEndTimeX);
        setDragState({
            type,
            motionId: motion.id,
            startX: e.clientX,
            initialOutputTime: outputEndTime,
            initialSourceEndTime: motion.sourceEndTimeMs
        });
        startInteraction();
        setEditingZoom(motion.id);
    };

    /**
     * Handles the actual dragging logic (Move).
     * Attached to window to track mouse movements outside the track area.
     * Prevents overlap with adjacent blocks and dynamically adjusts duration.
     */
    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaX = e.clientX - dragState.startX;
        const deltaTimeMs = coords.xToMs(deltaX);

        const motions = timeline.recording.viewportMotions || [];
        let targetSourceEnd = dragState.initialSourceEndTime + deltaTimeMs;

        // Get boundaries (excluding self)
        // Use output duration as the boundary for zoom blocks
        const { prevEnd, nextStart } = getZoomBlockBounds(
            dragState.motionId, motions, outputDuration
        );

        const { minZoomDurationMs, maxZoomDurationMs } = project.settings.zoom;

        // Clamp sourceEndTime to boundaries
        // Left: must leave room for at least minZoomDurationMs
        targetSourceEnd = Math.max(targetSourceEnd, prevEnd + minZoomDurationMs);
        // Right: cannot exceed next block start or output duration
        targetSourceEnd = Math.min(targetSourceEnd, nextStart, outputDuration);

        // Calculate duration based on available space
        const availableSpace = targetSourceEnd - prevEnd;
        const targetDuration = Math.max(minZoomDurationMs, Math.min(maxZoomDurationMs, availableSpace));

        batchAction(() => updateViewportMotion(dragState.motionId, {
            sourceEndTimeMs: targetSourceEnd,
            durationMs: targetDuration
        }));
    }, [dragState, coords, updateViewportMotion, timeline, project.settings.zoom, batchAction]);

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
                    const endX = coords.sourceTimeToX(m.sourceEndTimeMs);
                    if (endX === -1) return null;

                    const width = coords.msToX(m.durationMs);
                    const left = endX - width;

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
                                console.log('viewportMotion', m);
                                setEditingZoom(m.id);
                            }}
                        >
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
                {hoverInfo && !editingZoomId && !dragState && (
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

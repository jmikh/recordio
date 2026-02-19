import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { ZoomSegment } from '../../../../types';
import type { TimelineSegmentDragState as DragState } from '../useTimelineSegmentDrag';

import { K_DEFAULT_TIMELINE_BLOCK_MS, K_MIN_TIMELINE_BLOCK_MS } from '../useTimelineSegmentDrag';
import { getValidBlockRange, doSourceRangesOverlap } from '../timelineTrackUtils';
import { rectFromCenter } from '../../../../core/geometry';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';

export interface HoverInfo {
    x: number;
    outputStartTimeMs: number;
    outputEndTimeMs: number;
    width: number;
}

export function useZoomHover(
    timeline: any,
    project: any,
    coords: TimePixelMapper,
    dragState: DragState | null,
    editingZoomId: string | null,
    setEditingZoom: (id: string | null) => void,
    outputDuration: number,
    zoomSegments: ZoomSegment[],
    timeMapper: TimeMapper
) {
    const addZoomSegment = useProjectStore(s => s.addZoomSegment);
    const deleteZoomSegment = useProjectStore(s => s.deleteZoomSegment);
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const hoverInfoSetAtRef = useRef<number>(0);

    // Clear ghost whenever a zoom is selected (covers the case where the mouse
    // didn't move after selection, so handleMouseMove never had a chance to clear).
    useEffect(() => {
        if (editingZoomId) setHoverInfo(null);
    }, [editingZoomId]);

    const handleMouseMove = (e: React.MouseEvent) => {
        // No ghost while dragging or when something is selected
        if (dragState || editingZoomId || selectedSpotlightId) {
            setHoverInfo(null);
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const mouseTimeMs = coords.xToMs(x);

        if (mouseTimeMs > outputDuration || mouseTimeMs < 0) {
            setHoverInfo(null);
            return;
        }

        // Don't show ghost if mouse is inside an existing block
        const isInside = zoomSegments.some(r =>
            mouseTimeMs >= r.outputStartTimeMs && mouseTimeMs <= r.outputEndTimeMs
        );
        if (isInside) {
            setHoverInfo(null);
            return;
        }

        const range = getValidBlockRange(
            mouseTimeMs,
            zoomSegments,
            outputDuration,
            K_MIN_TIMELINE_BLOCK_MS,
            K_DEFAULT_TIMELINE_BLOCK_MS
        );
        if (!range) {
            setHoverInfo(null);
            return;
        }

        const width = coords.msToX(range.end - range.start);
        const leftX = coords.msToX(range.start);

        // Only stamp when ghost first appears (null → non-null)
        if (!hoverInfo) {
            hoverInfoSetAtRef.current = Date.now();
        }
        setHoverInfo({
            x: leftX,
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end,
            width,
        });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return;

        const currentSelectedZoomId = useUIStore.getState().selectedZoomId;
        if (currentSelectedZoomId) {
            setEditingZoom(null);
            setHoverInfo(null);
            return;
        }

        // Require the ghost to have been visible for at least 200ms (prevents
        // accidental adds from mouse-jitter between rapid deselect clicks)
        if (!hoverInfo || Date.now() - hoverInfoSetAtRef.current < 200) return;

        // Convert output placement times → source times
        const sourceStart = timeMapper.mapOutputToSourceTime(hoverInfo.outputStartTimeMs);
        const sourceEnd = timeMapper.mapOutputToSourceTime(hoverInfo.outputEndTimeMs);

        // Use half the output size, centered — user can resize in canvas
        const outputSize = project.settings.outputSize;
        const initialRect = rectFromCenter(
            { x: outputSize.width / 2, y: outputSize.height / 2 },
            { width: outputSize.width / 2, height: outputSize.height / 2 }
        );

        const newSegment: ZoomSegment = {
            id: crypto.randomUUID(),
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd,
            outputStartTimeMs: hoverInfo.outputStartTimeMs,
            outputEndTimeMs: hoverInfo.outputEndTimeMs,
            visible: true,
            rectPx: initialRect,
            reason: 'manual',
            type: 'manual',
        };

        // Delete any existing zoom segments that overlap the new one (source time)
        const allSegments: ZoomSegment[] = timeline.zoomSegments || [];
        for (const existing of allSegments) {
            if (doSourceRangesOverlap(newSegment, existing)) {
                deleteZoomSegment(existing.id);
            }
        }

        addZoomSegment(newSegment);
        setEditingZoom(newSegment.id);
        setHoverInfo(null);
    };

    return {
        hoverInfo,
        handleMouseMove,
        handleMouseLeave,
        handleClick,
    };
}

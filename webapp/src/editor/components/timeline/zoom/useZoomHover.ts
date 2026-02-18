import { useState } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { ZoomSegment } from '../../../../types';
import type { DragState } from './useZoomDrag';
import { K_MIN_ZOOM_HOLD_MS, K_DEFAULT_ZOOM_HOLD_MS } from './ZoomTrackUtils';
import { getValidBlockRange, doSourceRangesOverlap } from '../timelineTrackUtils';
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

    const { transitionDurationMs } = project.settings.zoom;

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
            transitionDurationMs + K_MIN_ZOOM_HOLD_MS,
            transitionDurationMs + K_DEFAULT_ZOOM_HOLD_MS
        );
        if (!range) {
            setHoverInfo(null);
            return;
        }

        const width = coords.msToX(range.end - range.start);
        const leftX = coords.msToX(range.start);

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

        if (editingZoomId) {
            setEditingZoom(null);
            return;
        }

        if (!hoverInfo) return;

        // Convert output placement times → source times
        const sourceStart = timeMapper.mapOutputToSourceTime(hoverInfo.outputStartTimeMs);
        const sourceEnd = timeMapper.mapOutputToSourceTime(hoverInfo.outputEndTimeMs);

        // Use the output size as the initial rect (full viewport — user can resize in canvas)
        const outputSize = project.settings.outputSize;
        const initialRect = {
            x: 0,
            y: 0,
            width: outputSize.width,
            height: outputSize.height,
        };

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

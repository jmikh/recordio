import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import type { OverlaySegment } from '../../../../../types/overlay';
import type { TimelineSegmentDragState as DragState } from '../shared/useTimelineSegmentDrag';
import { K_DEFAULT_TIMELINE_BLOCK_MS, K_MIN_TIMELINE_BLOCK_MS } from '../shared/useTimelineSegmentDrag';
import type { TimeMapper } from '../../../../../core/mappers/timeMapper';

export interface OverlayHoverInfo {
    x: number;
    outputStartTimeMs: number;
    outputEndTimeMs: number;
    width: number;
}

export function useOverlayHover(
    coords: TimePixelMapper,
    dragState: DragState | null,
    selectedId: string | null,
    setSelected: (id: string | null) => void,
    outputDuration: number,
    segments: OverlaySegment[],
    timeMapper: TimeMapper
) {
    const addOverlaySegment = useProjectStore(s => s.addOverlaySegment);
    const [hoverInfo, setHoverInfo] = useState<OverlayHoverInfo | null>(null);
    const hoverInfoSetAtRef = useRef<number>(0);

    useEffect(() => {
        if (selectedId) setHoverInfo(null);
    }, [selectedId]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState || selectedId) {
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

        // Only show ghost over empty areas — hide when hovering over an existing segment
        const isOverSegment = segments.some(s =>
            mouseTimeMs >= s.outputStartTimeMs && mouseTimeMs <= s.outputEndTimeMs
        );
        if (isOverSegment) {
            setHoverInfo(null);
            return;
        }

        // Center a default-duration block on the cursor, clamped to [0, outputDuration].
        const halfDuration = K_DEFAULT_TIMELINE_BLOCK_MS / 2;
        let start = mouseTimeMs - halfDuration;
        let end = mouseTimeMs + halfDuration;

        if (start < 0) { start = 0; end = Math.min(K_DEFAULT_TIMELINE_BLOCK_MS, outputDuration); }
        if (end > outputDuration) { end = outputDuration; start = Math.max(0, end - K_DEFAULT_TIMELINE_BLOCK_MS); }

        // Enforce minimum duration
        if (end - start < K_MIN_TIMELINE_BLOCK_MS) {
            setHoverInfo(null);
            return;
        }

        const width = coords.msToX(end - start);
        const leftX = coords.msToX(start);

        if (!hoverInfo) {
            hoverInfoSetAtRef.current = Date.now();
        }
        setHoverInfo({
            x: leftX,
            outputStartTimeMs: start,
            outputEndTimeMs: end,
            width,
        });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return;

        const currentSelectedId = useUIStore.getState().selectedOverlaySegmentId;
        if (currentSelectedId) {
            setSelected(null);
            setHoverInfo(null);
            return;
        }

        if (!hoverInfo || Date.now() - hoverInfoSetAtRef.current < 200) return;

        const sourceStart = timeMapper.mapOutputToSourceTime(hoverInfo.outputStartTimeMs);
        const sourceEnd = timeMapper.mapOutputToSourceTime(hoverInfo.outputEndTimeMs);

        // Create a new segment with a default blur item
        const newSegment: OverlaySegment = {
            id: crypto.randomUUID(),
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd,
            outputStartTimeMs: hoverInfo.outputStartTimeMs,
            outputEndTimeMs: hoverInfo.outputEndTimeMs,
            visible: true,
            item: {
                id: crypto.randomUUID(),
                type: 'blur',
                rectPx: { x: 0, y: 0, width: 100, height: 100 },
                blurRadiusPx: 20,
                borderRadiusPx: [0, 0, 0, 0],
            },
        };

        // No overlap deletion — overlaps are fine
        addOverlaySegment(newSegment);
        setSelected(newSegment.id);
        setHoverInfo(null);
    };

    return { hoverInfo, handleMouseMove, handleMouseLeave, handleClick };
}

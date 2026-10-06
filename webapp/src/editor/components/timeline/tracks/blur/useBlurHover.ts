import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import type { BlurSegment } from '@shared/types';
import type { TimelineSegmentDragState as DragState } from '../shared/useTimelineSegmentDrag';
import { K_DEFAULT_TIMELINE_BLOCK_MS, K_MIN_TIMELINE_BLOCK_MS } from '../shared/useTimelineSegmentDrag';
import { getValidBlockRange } from '../shared/timelineTrackUtils';
import type { TimeMapper } from '@shared/mappers/timeMapper';
import { createBlurSegment } from '../../../../blur/blurDefaults';

export interface BlurHoverInfo {
    x: number;
    outputStartTimeMs: number;
    outputEndTimeMs: number;
    width: number;
}

export function useBlurHover(
    coords: TimePixelMapper,
    dragState: DragState | null,
    selectedId: string | null,
    setSelected: (id: string | null) => void,
    outputDuration: number,
    segments: BlurSegment[],
    timeMapper: TimeMapper
) {
    const addBlurSegment = useProjectStore(s => s.addBlurSegment);
    const [hoverInfo, setHoverInfo] = useState<BlurHoverInfo | null>(null);
    const hoverInfoSetAtRef = useRef<number>(0);

    useEffect(() => {
        if (selectedId) setHoverInfo(null);
    }, [selectedId]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState || selectedId || useUIStore.getState().highlightRange) {
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

        // Only show ghost over empty areas — blur blocks never overlap
        const isInside = segments.some(s =>
            mouseTimeMs >= s.outputStartTimeMs && mouseTimeMs <= s.outputEndTimeMs
        );
        if (isInside) {
            setHoverInfo(null);
            return;
        }

        const range = getValidBlockRange(
            mouseTimeMs,
            segments,
            outputDuration,
            K_MIN_TIMELINE_BLOCK_MS,
            K_DEFAULT_TIMELINE_BLOCK_MS
        );
        if (!range) {
            setHoverInfo(null);
            return;
        }

        if (!hoverInfo) {
            hoverInfoSetAtRef.current = Date.now();
        }
        setHoverInfo({
            x: coords.msToX(range.start),
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end,
            width: coords.msToX(range.end - range.start),
        });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return;

        if (useUIStore.getState().selectedBlurSegmentId) {
            setSelected(null);
            setHoverInfo(null);
            return;
        }

        if (!hoverInfo || Date.now() - hoverInfoSetAtRef.current < 200) return;

        const outputSize = useProjectStore.getState().project.settings.outputSize;
        const newSegment = createBlurSegment(hoverInfo.outputStartTimeMs, hoverInfo.outputEndTimeMs, timeMapper, outputSize);

        addBlurSegment(newSegment);
        setSelected(newSegment.id);
        setHoverInfo(null);
    };

    return { hoverInfo, handleMouseMove, handleMouseLeave, handleClick };
}

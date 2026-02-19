import { useState, useEffect } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { CaptionSegment } from '../../../../types';
import type { CaptionDragState } from './useCaptionDrag';
import { getValidBlockRange } from '../timelineTrackUtils';
import { K_DEFAULT_TIMELINE_BLOCK_MS, K_MIN_TIMELINE_BLOCK_MS } from '../useTimelineSegmentDrag';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';

export interface CaptionHoverInfo {
    x: number;
    outputStartTimeMs: number;
    outputEndTimeMs: number;
    width: number;
}

export function useCaptionHover(
    timeline: any,
    coords: TimePixelMapper,
    dragState: CaptionDragState | null,
    selectedCaptionId: string | null,
    outputDuration: number,
    captionSegments: CaptionSegment[],
    timeMapper: TimeMapper
) {
    const addCaptionSegment = useProjectStore(s => s.addCaptionSegment);
    const selectCaption = useUIStore(s => s.selectCaption);
    const [hoverInfo, setHoverInfo] = useState<CaptionHoverInfo | null>(null);

    // Clear ghost whenever a caption is selected.
    useEffect(() => {
        if (selectedCaptionId) setHoverInfo(null);
    }, [selectedCaptionId]);

    /**
     * Ghost hover for 'Add Caption'.
     * Disabled while dragging or when a caption is selected.
     */
    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState || selectedCaptionId) {
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

        // Check if inside an existing caption
        const isInside = captionSegments.some(r =>
            mouseTimeMs >= r.outputStartTimeMs && mouseTimeMs <= r.outputEndTimeMs
        );

        if (isInside) {
            setHoverInfo(null);
            return;
        }

        const range = getValidBlockRange(
            mouseTimeMs,
            captionSegments,
            outputDuration,
            K_MIN_TIMELINE_BLOCK_MS,
            K_DEFAULT_TIMELINE_BLOCK_MS,
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

        const currentSelectedCaptionId = useUIStore.getState().selectedCaptionId;
        if (currentSelectedCaptionId) {
            selectCaption(null);
            setHoverInfo(null);
            return;
        }

        if (!hoverInfo) return;

        // Convert output times → source times
        const sourceStart = timeMapper.mapOutputToSourceTime(hoverInfo.outputStartTimeMs);
        const sourceEnd = timeMapper.mapOutputToSourceTime(hoverInfo.outputEndTimeMs);

        const newCaption: CaptionSegment = {
            id: crypto.randomUUID(),
            text: '',
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd,
            outputStartTimeMs: hoverInfo.outputStartTimeMs,
            outputEndTimeMs: hoverInfo.outputEndTimeMs,
            visible: true,
        };

        addCaptionSegment(newCaption);
        selectCaption(newCaption.id);
        setHoverInfo(null);
    };

    return {
        hoverInfo,
        handleMouseMove,
        handleMouseLeave,
        handleClick,
    };
}

import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import type { OverlayBlock } from '../../../../../types/overlay';
import type { TimelineSegmentDragState as DragState } from '../shared/useTimelineSegmentDrag';
import { K_DEFAULT_TIMELINE_BLOCK_MS, K_MIN_TIMELINE_BLOCK_MS } from '../shared/useTimelineSegmentDrag';
import { getValidBlockRange, doSourceRangesOverlap } from '../shared/timelineTrackUtils';
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
    blocks: OverlayBlock[],
    timeMapper: TimeMapper
) {
    const addOverlayBlock = useProjectStore(s => s.addOverlayBlock);
    const deleteOverlayBlock = useProjectStore(s => s.deleteOverlayBlock);
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

        const isInside = blocks.some(b =>
            mouseTimeMs >= b.outputStartTimeMs && mouseTimeMs <= b.outputEndTimeMs
        );
        if (isInside) {
            setHoverInfo(null);
            return;
        }

        const range = getValidBlockRange(
            mouseTimeMs,
            blocks,
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

        const currentSelectedId = useUIStore.getState().selectedOverlayBlockId;
        if (currentSelectedId) {
            setSelected(null);
            setHoverInfo(null);
            return;
        }

        if (!hoverInfo || Date.now() - hoverInfoSetAtRef.current < 200) return;

        const sourceStart = timeMapper.mapOutputToSourceTime(hoverInfo.outputStartTimeMs);
        const sourceEnd = timeMapper.mapOutputToSourceTime(hoverInfo.outputEndTimeMs);

        const newBlock: OverlayBlock = {
            id: crypto.randomUUID(),
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd,
            outputStartTimeMs: hoverInfo.outputStartTimeMs,
            outputEndTimeMs: hoverInfo.outputEndTimeMs,
            visible: true,
            items: [],
        };

        // Delete overlapping blocks (shouldn't happen with non-overlap, but be safe)
        const allBlocks = useProjectStore.getState().project.timeline.overlayBlocks || [];
        for (const existing of allBlocks) {
            if (doSourceRangesOverlap(newBlock, existing)) {
                deleteOverlayBlock(existing.id);
            }
        }

        addOverlayBlock(newBlock);
        setSelected(newBlock.id);
        setHoverInfo(null);
    };

    return { hoverInfo, handleMouseMove, handleMouseLeave, handleClick };
}

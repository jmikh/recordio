import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { CameraLayoutSegment } from '../../../../types';
import type { TimelineSegmentDragState as DragState } from '../useTimelineSegmentDrag';
import { K_DEFAULT_TIMELINE_BLOCK_MS, K_MIN_TIMELINE_BLOCK_MS } from '../useTimelineSegmentDrag';
import { getValidBlockRange, doSourceRangesOverlap } from '../timelineTrackUtils';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';

export interface CameraLayoutHoverInfo {
    x: number;
    outputStartTimeMs: number;
    outputEndTimeMs: number;
    width: number;
}

export function useCameraLayoutHover(
    project: any,
    coords: TimePixelMapper,
    dragState: DragState | null,
    selectedId: string | null,
    setSelected: (id: string | null) => void,
    outputDuration: number,
    segments: CameraLayoutSegment[],
    timeMapper: TimeMapper
) {
    const addCameraLayout = useProjectStore(s => s.addCameraLayout);
    const deleteCameraLayout = useProjectStore(s => s.deleteCameraLayout);
    const [hoverInfo, setHoverInfo] = useState<CameraLayoutHoverInfo | null>(null);
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

        const isInside = segments.some(r =>
            mouseTimeMs >= r.outputStartTimeMs && mouseTimeMs <= r.outputEndTimeMs
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

        const currentSelectedId = useUIStore.getState().selectedCameraLayoutId;
        if (currentSelectedId) {
            setSelected(null);
            setHoverInfo(null);
            return;
        }

        if (!hoverInfo || Date.now() - hoverInfoSetAtRef.current < 200) return;

        const sourceStart = timeMapper.mapOutputToSourceTime(hoverInfo.outputStartTimeMs);
        const sourceEnd = timeMapper.mapOutputToSourceTime(hoverInfo.outputEndTimeMs);

        // Use current camera settings as defaults for the new block
        const cameraSettings = project.settings.camera;
        const cameraLayoutSettings = project.settings.cameraLayout;

        const w = cameraSettings?.widthPx ?? 300;
        const h = cameraSettings?.heightPx ?? 300;
        const shapeVal = cameraSettings?.shape ?? 'circle';
        // Bake borderRadiusPx from shape — painter renders purely on radius
        const bakedRadius = shapeVal === 'circle'
            ? Math.min(w, h) / 2
            : (cameraSettings?.borderRadiusPx ?? 10);

        const newSegment: CameraLayoutSegment = {
            id: crypto.randomUUID(),
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd,
            outputStartTimeMs: hoverInfo.outputStartTimeMs,
            outputEndTimeMs: hoverInfo.outputEndTimeMs,
            visible: true,
            xPx: cameraSettings?.xPx ?? 25,
            yPx: cameraSettings?.yPx ?? 755,
            widthPx: w,
            heightPx: h,
            shape: shapeVal,
            borderRadiusPx: bakedRadius,
            transitionDurationMs: cameraLayoutSettings?.transitionDurationMs ?? 500,
            easing: cameraLayoutSettings?.easing ?? 'ease-in-out',
        };

        // Delete overlapping blocks
        const allSegments = project.timeline?.cameraLayoutSegments || [];
        for (const existing of allSegments) {
            if (doSourceRangesOverlap(newSegment, existing)) {
                deleteCameraLayout(existing.id);
            }
        }

        addCameraLayout(newSegment);
        setSelected(newSegment.id);
        setHoverInfo(null);
    };

    return { hoverInfo, handleMouseMove, handleMouseLeave, handleClick };
}

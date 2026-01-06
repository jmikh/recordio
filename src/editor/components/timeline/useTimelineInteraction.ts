import { useState, useCallback } from 'react';
import type { RefObject } from 'react';
import { TimeMapper } from '../../../core/timeMapper';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { CanvasMode } from '../../stores/useUIStore';

interface UseTimelineInteractionProps {
    containerRef: RefObject<HTMLDivElement | null>;
    pixelsPerSec: number;
    totalOutputDuration: number;
    timeMapper: TimeMapper;
    canvasMode: CanvasMode;
    timelineOffsetLeft?: number;
}

export function useTimelineInteraction({
    containerRef,
    pixelsPerSec,
    totalOutputDuration,
    timeMapper,
    canvasMode,
    timelineOffsetLeft,
}: UseTimelineInteractionProps) {
    const isPlaying = usePlaybackStore(s => s.isPlaying);
    const setCurrentTime = usePlaybackStore(s => s.setCurrentTime);
    const setPreviewTime = usePlaybackStore(s => s.setPreviewTime);

    // Interaction State
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [isCTIScrubbing, setIsCTIScrubbing] = useState(false);

    const getTimeFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
        if (!containerRef.current) return { outputTime: 0, timelineTime: 0 };
        const rect = containerRef.current.getBoundingClientRect();
        const scrollLeft = containerRef.current.scrollLeft || 0;
        // Subtract timelineOffsetLeft from x calculation
        const x = e.clientX - rect.left + scrollLeft - (timelineOffsetLeft || 0);

        // Visual X -> Output Time
        const outputTime = Math.max(0, (x / pixelsPerSec) * 1000);

        // Map to Timeline Time
        const clampedOutputTime = Math.min(outputTime, totalOutputDuration);
        const timelineTime = timeMapper.mapOutputToTimelineTime(clampedOutputTime);

        return { outputTime, timelineTime };
    }, [containerRef, pixelsPerSec, totalOutputDuration, timeMapper]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const { outputTime, timelineTime } = getTimeFromEvent(e);

        // Hover uses Visual/Output Time
        setHoverTime(outputTime);

        const isBlockingEdit = canvasMode === CanvasMode.CropEdit || canvasMode === CanvasMode.ZoomEdit;

        if (isCTIScrubbing) {
            if (timelineTime !== -1) {
                setCurrentTime(timelineTime);
            }
        } else if (!isPlaying && !isBlockingEdit) {
            if (timelineTime !== -1) {
                setPreviewTime(timelineTime);
            }
        } else {
            setPreviewTime(null);
        }
    }, [getTimeFromEvent, isCTIScrubbing, isPlaying, canvasMode, setCurrentTime, setPreviewTime]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        setIsCTIScrubbing(true);
        const { timelineTime } = getTimeFromEvent(e);
        if (timelineTime !== -1) {
            setCurrentTime(timelineTime);
        }
    }, [getTimeFromEvent, setCurrentTime]);

    const handleMouseLeave = useCallback(() => {
        setHoverTime(null);
        setPreviewTime(null);
        setIsCTIScrubbing(false);
    }, [setPreviewTime]);

    const handleMouseUp = useCallback(() => {
        setIsCTIScrubbing(false);
    }, []);

    return {
        hoverTime,
        isCTIScrubbing,
        handleMouseMove,
        handleMouseDown,
        handleMouseLeave,
        handleMouseUp
    };
}

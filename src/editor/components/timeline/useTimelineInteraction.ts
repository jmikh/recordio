import { useState, useCallback } from 'react';
import type { RefObject } from 'react';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';

interface UseTimelineInteractionProps {
    containerRef: RefObject<HTMLDivElement | null>;
    totalOutputDuration: number;
    timelineOffsetLeft?: number;
}

export function useTimelineInteraction({
    containerRef,
    totalOutputDuration,
    timelineOffsetLeft,
}: UseTimelineInteractionProps) {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const canvasMode = useUIStore(s => s.canvasMode);
    const isPlaying = useUIStore(s => s.isPlaying);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const setPreviewTime = useUIStore(s => s.setPreviewTime);

    // Interaction State
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [isCTIScrubbing, setIsCTIScrubbing] = useState(false);

    const getTimeFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
        if (!containerRef.current) return { outputTime: 0 };
        const rect = containerRef.current.getBoundingClientRect();
        const scrollLeft = containerRef.current.scrollLeft || 0;
        // Subtract timelineOffsetLeft from x calculation
        const x = e.clientX - rect.left + scrollLeft - (timelineOffsetLeft || 0);

        // Visual X -> Output Time
        const outputTime = Math.max(0, (x / pixelsPerSec) * 1000);

        // Clamp to total duration
        const clampedOutputTime = Math.min(outputTime, totalOutputDuration);

        return { outputTime: clampedOutputTime };
    }, [containerRef, pixelsPerSec, totalOutputDuration, timelineOffsetLeft]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const { outputTime } = getTimeFromEvent(e);

        // Hover uses Output Time
        setHoverTime(outputTime);

        const isBlockingEdit = canvasMode === CanvasMode.CropEdit || canvasMode === CanvasMode.ZoomEdit;

        if (isCTIScrubbing) {
            setCurrentTime(outputTime);
        } else if (!isPlaying && !isBlockingEdit) {
            setPreviewTime(outputTime);
        } else {
            setPreviewTime(null);
        }
    }, [getTimeFromEvent, isCTIScrubbing, isPlaying, canvasMode, setCurrentTime, setPreviewTime]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        setIsCTIScrubbing(true);
        const { outputTime } = getTimeFromEvent(e);
        setCurrentTime(outputTime);
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

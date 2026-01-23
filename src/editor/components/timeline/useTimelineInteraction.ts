import { useState, useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useTimeMapper } from '../../hooks/useTimeMapper';

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
    const selectedZoomId = useUIStore(s => s.selectedZoomId);

    const viewportMotions = useProjectStore(s => s.project.timeline.viewportMotions);

    const timeMapper = useTimeMapper();

    // Interaction State
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [isCTIScrubbing, setIsCTIScrubbing] = useState(false);

    // When a zoom is selected, set currentTime to its end output time and clear hover/preview
    useEffect(() => {
        if (selectedZoomId) {
            const motion = viewportMotions?.find(m => m.id === selectedZoomId);
            if (motion) {
                // Use cached output time
                const outputTime = motion.outputEndTimeMs;
                if (outputTime !== -1) {
                    setCurrentTime(outputTime);
                }
            }
            setPreviewTime(null);
            setHoverTime(null);
        }
    }, [selectedZoomId, viewportMotions, timeMapper, setCurrentTime, setPreviewTime]);

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
        // If external drag operating, do not interfere with time/preview
        if (useUIStore.getState().isResizingWindow) return;

        const { outputTime } = getTimeFromEvent(e);

        // Hover uses Output Time - but hide during blocking edits
        if (canvasMode !== CanvasMode.Preview) {
            setHoverTime(null);
        } else {
            setHoverTime(outputTime);
        }

        if (isCTIScrubbing) {
            setCurrentTime(outputTime);
            setPreviewTime(null);
        } else if (!isPlaying && canvasMode === CanvasMode.Preview) {
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

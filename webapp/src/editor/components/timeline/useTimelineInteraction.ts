import { useState, useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useTimeMapper } from '../../hooks/useTimeMapper';

const DRAG_THRESHOLD_PX = 5;
const RULER_HEIGHT = 26;

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
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const selectZoom = useUIStore(s => s.selectZoom);
    const selectSpotlight = useUIStore(s => s.selectSpotlight);

    const zoomSegments = useProjectStore(s => s.project.timeline.zoomSegments);

    const timeMapper = useTimeMapper();

    // Interaction State
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [isCTIScrubbing, setIsCTIScrubbing] = useState(false);

    // Highlight drag state
    const [isDraggingHighlight, setIsDraggingHighlight] = useState(false);
    const dragAnchorRef = useRef<{ outputMs: number; clientX: number } | null>(null);

    // When a zoom is selected, set currentTime to its start output time and clear hover/preview
    useEffect(() => {
        if (selectedZoomId) {
            const segment = zoomSegments?.find(m => m.id === selectedZoomId);
            if (segment) {
                const outputTime = timeMapper.mapSourceToOutputTime(segment.sourceStartTimeMs);
                if (outputTime !== -1) {
                    setCurrentTime(outputTime);
                }
            }
            setPreviewTime(null);
            setHoverTime(null);
        }
    }, [selectedZoomId, zoomSegments, timeMapper, setCurrentTime, setPreviewTime]);

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

    // Update highlight range from any MouseEvent (React or native)
    const updateHighlightFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
        if (!dragAnchorRef.current) return;
        const { outputTime } = getTimeFromEvent(e);
        const startMs = Math.min(dragAnchorRef.current.outputMs, outputTime);
        const endMs = Math.max(dragAnchorRef.current.outputMs, outputTime);
        useUIStore.getState().setHighlightRange({ startMs, endMs });
        setCurrentTime(outputTime);
        setHoverTime(null);
        setPreviewTime(null);
    }, [getTimeFromEvent, setCurrentTime, setPreviewTime]);

    // Finalize highlight drag (shared between in-timeline and global mouseup)
    const finalizeHighlightDrag = useCallback(() => {
        const range = useUIStore.getState().highlightRange;
        if (range && (range.endMs - range.startMs) < 50) {
            useUIStore.getState().setHighlightRange(null);
        }
        dragAnchorRef.current = null;
        setIsDraggingHighlight(false);
        setIsCTIScrubbing(false);
    }, []);

    // Global listeners for highlight drag that continues outside the timeline
    useEffect(() => {
        if (!isDraggingHighlight) return;

        const onGlobalMouseMove = (e: MouseEvent) => {
            updateHighlightFromEvent(e);
        };
        const onGlobalMouseUp = () => {
            finalizeHighlightDrag();
        };

        window.addEventListener('mousemove', onGlobalMouseMove);
        window.addEventListener('mouseup', onGlobalMouseUp);
        return () => {
            window.removeEventListener('mousemove', onGlobalMouseMove);
            window.removeEventListener('mouseup', onGlobalMouseUp);
        };
    }, [isDraggingHighlight, updateHighlightFromEvent, finalizeHighlightDrag]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        // If external drag operating, do not interfere with time/preview
        if (useUIStore.getState().isResizingWindow) return;

        // During highlight drag, global listeners handle tracking — skip local handling
        if (isDraggingHighlight) return;

        const { outputTime } = getTimeFromEvent(e);

        // Check if drag threshold exceeded to start highlight
        if (dragAnchorRef.current) {
            const dx = Math.abs(e.clientX - dragAnchorRef.current.clientX);
            if (dx >= DRAG_THRESHOLD_PX) {
                setIsDraggingHighlight(true);
                setIsCTIScrubbing(false);
                // Immediately update range so there's no visual gap
                updateHighlightFromEvent(e);
                return;
            }
        }

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
    }, [getTimeFromEvent, isCTIScrubbing, isDraggingHighlight, isPlaying, canvasMode, setCurrentTime, setPreviewTime, updateHighlightFromEvent]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Deselect zoom/spotlight when clicking on timeline to change CTI
        if (selectedZoomId) selectZoom(null);
        if (selectedSpotlightId) selectSpotlight(null);

        const { outputTime } = getTimeFromEvent(e);

        // Check if mousedown is in the ruler area
        const containerRect = containerRef.current?.getBoundingClientRect();
        const relativeY = containerRect ? e.clientY - containerRect.top : RULER_HEIGHT + 1;
        const isInRuler = relativeY < RULER_HEIGHT;

        // Clear any existing highlight
        useUIStore.getState().setHighlightRange(null);

        if (isInRuler) {
            // Potential highlight drag — record anchor, set CTI, defer scrub decision
            dragAnchorRef.current = { outputMs: outputTime, clientX: e.clientX };
            setCurrentTime(outputTime);
        } else {
            // Below ruler: normal CTI scrub behavior
            dragAnchorRef.current = null;
            setIsCTIScrubbing(true);
            setCurrentTime(outputTime);
        }
    }, [getTimeFromEvent, setCurrentTime, selectedZoomId, selectedSpotlightId, selectZoom, selectSpotlight, containerRef]);

    const handleMouseLeave = useCallback(() => {
        setHoverTime(null);
        setPreviewTime(null);
        // If highlight drag is active, let global listeners handle it — don't cancel
        if (!isDraggingHighlight) {
            setIsCTIScrubbing(false);
            dragAnchorRef.current = null;
        }
    }, [setPreviewTime, isDraggingHighlight]);

    const handleMouseUp = useCallback(() => {
        // If highlight drag is active, global listener handles mouseup
        if (isDraggingHighlight) return;
        dragAnchorRef.current = null;
        setIsCTIScrubbing(false);
    }, [isDraggingHighlight]);

    return {
        hoverTime,
        isCTIScrubbing,
        isDraggingHighlight,
        handleMouseMove,
        handleMouseDown,
        handleMouseLeave,
        handleMouseUp
    };
}

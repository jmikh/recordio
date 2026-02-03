import React, { useEffect, useMemo } from 'react';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { FaScissors } from 'react-icons/fa6';

interface TimelinePlayheadProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    pixelsPerSec: number;
}

const MIN_DISTANCE_MS = 500; // Minimum distance from window boundaries

export const TimelinePlayhead: React.FC<TimelinePlayheadProps> = ({
    containerRef,
    pixelsPerSec,
}) => {
    //console.log('[Rerender] TimelinePlayhead');
    const playheadRef = React.useRef<HTMLDivElement>(null);
    const scissorsRef = React.useRef<HTMLButtonElement>(null);

    const canvasMode = useUIStore(s => s.canvasMode);
    const isPlaying = useUIStore(s => s.isPlaying);
    const currentTimeMs = useUIStore(s => s.currentTimeMs);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    const timeline = useProjectTimeline();
    const splitWindow = useProjectStore(s => s.splitWindow);

    // Check if current time is at least 500ms from both window boundaries
    const canShowScissors = useMemo(() => {
        // Find the window containing the current time
        const currentWindow = outputWindows.find(
            w => currentTimeMs >= w.startMs && currentTimeMs <= w.endMs
        );

        if (!currentWindow) return false;

        const distanceFromStart = currentTimeMs - currentWindow.startMs;
        const distanceFromEnd = currentWindow.endMs - currentTimeMs;

        return distanceFromStart >= MIN_DISTANCE_MS && distanceFromEnd >= MIN_DISTANCE_MS;
    }, [currentTimeMs, outputWindows]);

    const showScissors = canvasMode === CanvasMode.Preview && !isPlaying && canShowScissors;

    // Initial position
    useEffect(() => {
        if (playheadRef.current) {
            const time = useUIStore.getState().currentTimeMs;
            playheadRef.current.style.left = `${(time / 1000) * pixelsPerSec}px`;
        }
    }, [pixelsPerSec]);

    // Transient updates for 60fps performance
    useEffect(() => {
        const unsub = useUIStore.subscribe((state) => {
            const time = state.currentTimeMs;

            // 1. Update Position
            if (playheadRef.current) {
                playheadRef.current.style.left = `${(time / 1000) * pixelsPerSec}px`;
            }

            // 2. Auto-Scroll (Page Flip Logic)
            if (state.isPlaying && containerRef.current) {
                // Optimization: Throttle sensitive scroll checks or minimal checks
                // Only check if time changed significantly or simply run checks

                const outputTime = time;
                const px = (outputTime / 1000) * pixelsPerSec;
                const container = containerRef.current;
                const scrollLeft = container.scrollLeft;
                const clientWidth = container.clientWidth;

                if (px > scrollLeft + clientWidth) {
                    container.scrollTo({ left: px, behavior: 'auto' });
                } else if (px < scrollLeft) {
                    container.scrollTo({ left: px, behavior: 'auto' });
                }
            }
        });

        return unsub;
    }, [pixelsPerSec, containerRef]); // Re-subscribe if zoom changes

    // Split window at current playhead position (same logic as TimelineToolbar)
    const handleScissorsClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const currentTime = useUIStore.getState().currentTimeMs;
        const timeMapper = getTimeMapper(timeline.outputWindows);

        const result = timeMapper.getWindowAtOutputTime(currentTime);
        if (!result) return;

        const { window: win, outputStartMs } = result;
        const outputOffset = currentTime - outputStartMs;
        const speed = win.speed || 1.0;
        const sourceOffset = outputOffset * speed; // Convert output time to source time
        const splitTime = win.startMs + sourceOffset;

        splitWindow(win.id, splitTime);
    };

    // Prevent event capture by other components
    const handleMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    const handleMouseEnter = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    return (
        <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 w-[1px] bg-destructive z-[var(--z-index-overlay)]"
            style={{ left: `0px`, height: '100%', pointerEvents: 'none' }}
        >
            {/* Scissors button - shown only in preview mode when not playing and 500ms from boundaries */}
            {showScissors && (
                <button
                    ref={scissorsRef}
                    onClick={handleScissorsClick}
                    onMouseDown={handleMouseDown}
                    onMouseEnter={handleMouseEnter}
                    className="absolute top-9 -translate-x-1/2 p-1.5 rounded-full bg-black/60 text-main border border-transparent hover:bg-black/80 hover:text-highlighted hover:border-border-hover hover:scale-110 cursor-pointer transition-all duration-150 z-[var(--z-index-tooltip)]"
                    style={{ pointerEvents: 'auto' }}
                    title="Split at playhead"
                >
                    <FaScissors size={12} />
                </button>
            )}
            {/* Arrow indicator */}
            <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-destructive"></div>
        </div>
    );
};

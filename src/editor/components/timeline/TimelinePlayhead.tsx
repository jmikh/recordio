import React, { useEffect } from 'react';
import { useUIStore } from '../../stores/useUIStore';

interface TimelinePlayheadProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    pixelsPerSec: number;
}

export const TimelinePlayhead: React.FC<TimelinePlayheadProps> = ({
    containerRef,
    pixelsPerSec,
}) => {
    // We subscribe deeply to avoid parent re-renders
    const currentTimeMs = useUIStore(s => s.currentTimeMs);
    const isPlaying = useUIStore(s => s.isPlaying);

    // Auto-Scroll Logic (Page Flip)
    useEffect(() => {
        if (!isPlaying || !containerRef.current) return;

        // currentTimeMs is already in output time
        const outputTime = currentTimeMs;
        const px = (outputTime / 1000) * pixelsPerSec;
        const container = containerRef.current;
        const scrollLeft = container.scrollLeft;
        const clientWidth = container.clientWidth;

        // Thresholds
        // If playhead goes past the right edge (minus small buffer)
        // Or if it simply isn't visible?
        // Let's implement strict "Page" logic:

        if (px > scrollLeft + clientWidth) {
            // Scroll Forward
            // Snap to: Playhead Position (Place it at start of view)
            container.scrollTo({ left: px, behavior: 'auto' });
        } else if (px < scrollLeft) {
            // Scroll Backward (e.g. looped or scrubbed back)
            // Snap to: Playhead Position
            container.scrollTo({ left: px, behavior: 'auto' });
        }

    }, [currentTimeMs, isPlaying, pixelsPerSec, containerRef]);

    // Render Playhead Line - currentTimeMs is already in output time
    const ctiOutputTime = currentTimeMs;
    const left = (ctiOutputTime / 1000) * pixelsPerSec;

    return (
        <div
            className="absolute top-0 bottom-0 w-[1px] bg-red-500 z-30 pointer-events-none"
            style={{ left: `${left}px`, height: '100%' }} // height 100% of relative parent
        >
            <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-red-500"></div>
        </div>
    );
};

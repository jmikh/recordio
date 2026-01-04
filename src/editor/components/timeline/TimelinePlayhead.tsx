import React, { useEffect } from 'react';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { TimeMapper } from '../../../core/timeMapper';

interface TimelinePlayheadProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    pixelsPerSec: number;
    timeMapper: TimeMapper;
}

export const TimelinePlayhead: React.FC<TimelinePlayheadProps> = ({
    containerRef,
    pixelsPerSec,
    timeMapper
}) => {
    // We subscribe deeply to avoid parent re-renders
    const currentTimeMs = usePlaybackStore(s => s.currentTimeMs);
    const isPlaying = usePlaybackStore(s => s.isPlaying);

    // Auto-Scroll Logic (Page Flip)
    useEffect(() => {
        if (!isPlaying || !containerRef.current) return;

        const outputTime = timeMapper.mapTimelineToOutputTime(currentTimeMs);
        if (outputTime === -1) return;

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

    }, [currentTimeMs, isPlaying, pixelsPerSec, containerRef, timeMapper]);

    // Render Playhead Line
    const ctiOutputTime = timeMapper.mapTimelineToOutputTime(currentTimeMs);
    if (ctiOutputTime === -1) return null;

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

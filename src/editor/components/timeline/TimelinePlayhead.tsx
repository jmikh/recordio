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
    console.log('[Rerender] TimelinePlayhead');
    const playheadRef = React.useRef<HTMLDivElement>(null);
    // const isPlaying = useUIStore(s => s.isPlaying); // Removed unused

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

    return (
        <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 w-[1px] bg-red-500 z-30 pointer-events-none"
            style={{ left: `0px`, height: '100%' }}
        >
            <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-red-500"></div>
        </div>
    );
};

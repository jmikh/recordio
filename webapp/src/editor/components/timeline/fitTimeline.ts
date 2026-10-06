import { useUIStore } from '../../stores/useUIStore';

export const MIN_PIXELS_PER_SEC = 1;
export const MAX_PIXELS_PER_SEC = 200;

// Breathing room on the right so the end of the project isn't flush with the edge
const FIT_PADDING_PX = 50;

/**
 * Sets the timeline zoom so the whole output duration fits the visible timeline width.
 * Used by the toolbar's Fit button and on editor load.
 */
export function fitTimelineToScreen(totalDurationMs: number) {
    const { timelineContainerRef, setPixelsPerSec } = useUIStore.getState();
    const container = timelineContainerRef?.current;
    if (!container || totalDurationMs <= 0) return;

    const availableWidth = container.clientWidth - FIT_PADDING_PX;
    if (availableWidth <= 0) return;

    const fitPps = (availableWidth * 1000) / totalDurationMs;
    const clampedPps = Math.max(MIN_PIXELS_PER_SEC, Math.min(MAX_PIXELS_PER_SEC, fitPps));
    console.log('[FitDebug] fit', { clientWidth: container.clientWidth, totalDurationMs, fitPps, clampedPps, t: performance.now() });
    setPixelsPerSec(clampedPps);
}

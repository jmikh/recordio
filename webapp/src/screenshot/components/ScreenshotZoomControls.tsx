/**
 * Floating view-zoom control over the canvas area: zoom out, the current
 * percentage (click = back to fit-to-width), zoom in. Shortcuts ⌘− / ⌘0 /
 * ⌘+ live in useScreenshotShortcuts; ⌘/ctrl + wheel and pinch are handled
 * by ScreenshotCanvas.
 */
import { LuZoomIn, LuZoomOut } from 'react-icons/lu';
import { Button } from '@shared/components';
import { MAX_ZOOM, MIN_ZOOM, effectiveZoom, useScreenshotUIStore } from '../store/useScreenshotUIStore';

export function ScreenshotZoomControls() {
    const scale = useScreenshotUIStore(effectiveZoom);
    const isFit = useScreenshotUIStore(s => s.zoom === null);
    const zoomIn = useScreenshotUIStore(s => s.zoomIn);
    const zoomOut = useScreenshotUIStore(s => s.zoomOut);
    const resetZoom = useScreenshotUIStore(s => s.resetZoom);
    const percent = Math.round(scale * 100);

    return (
        <div
            role="group"
            aria-label="Zoom"
            className="absolute bottom-4 right-6 flex items-center gap-0.5 p-1 bg-surface-raised border border-border rounded-[var(--radius-md)] shadow-float"
        >
            <Button variant="ghost" icon={LuZoomOut} aria-label="Zoom out" title="Zoom out (⌘−)" onClick={zoomOut} disabled={scale <= MIN_ZOOM} />
            <Button
                variant="ghost"
                onClick={resetZoom}
                disabled={isFit}
                aria-label={`Zoom ${percent}%, fit to width`}
                title="Fit to width (⌘0)"
                className="w-14 justify-center text-xs tabular-nums"
            >
                {percent}%
            </Button>
            <Button variant="ghost" icon={LuZoomIn} aria-label="Zoom in" title="Zoom in (⌘+)" onClick={zoomIn} disabled={scale >= MAX_ZOOM} />
        </div>
    );
}

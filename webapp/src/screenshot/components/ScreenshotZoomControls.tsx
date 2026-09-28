/**
 * The editor's view-zoom control over the canvas area — ZoomControls wired
 * to the UI store. Shortcuts ⌘− / ⌘0 / ⌘+ live in useScreenshotShortcuts;
 * ⌘/ctrl + wheel and pinch are handled by ScreenshotCanvas.
 */
import { MAX_ZOOM, MIN_ZOOM, effectiveZoom, useScreenshotUIStore } from '../store/useScreenshotUIStore';
import { ZoomControls } from './ZoomControls';

export function ScreenshotZoomControls() {
    const scale = useScreenshotUIStore(effectiveZoom);
    const isFit = useScreenshotUIStore(s => s.zoom === null);
    const zoomIn = useScreenshotUIStore(s => s.zoomIn);
    const zoomOut = useScreenshotUIStore(s => s.zoomOut);
    const resetZoom = useScreenshotUIStore(s => s.resetZoom);

    return (
        <ZoomControls
            scale={scale}
            isFit={isFit}
            canZoomOut={scale > MIN_ZOOM}
            canZoomIn={scale < MAX_ZOOM}
            onZoomOut={zoomOut}
            onZoomIn={zoomIn}
            onFit={resetZoom}
            showShortcuts
        />
    );
}

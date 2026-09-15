/**
 * Store-spanning editor actions shared by the toolbar, inspector and
 * keyboard shortcuts (plans/screenshots Step 8).
 */
import { useScreenshotStore } from './store/useScreenshotStore';
import { useScreenshotUIStore, type ScreenshotTool } from './store/useScreenshotUIStore';
import { effectiveCrop } from './geometry';

/** Enters crop mode with the current crop (or the full source) as the draft. */
export function startCrop(): void {
    const doc = useScreenshotStore.getState().doc;
    if (!doc) return;
    const ui = useScreenshotUIStore.getState();
    ui.setTool('crop');
    ui.setCropDraft(effectiveCrop(doc));
}

/** Commits the draft as the document crop (one history entry) and returns to select. */
export function applyCrop(): void {
    const { cropDraft } = useScreenshotUIStore.getState();
    const doc = useScreenshotStore.getState().doc;
    if (!cropDraft || !doc) return;
    const full = cropDraft.x === 0 && cropDraft.y === 0
        && cropDraft.width === doc.source.widthPx && cropDraft.height === doc.source.heightPx;
    useScreenshotStore.getState().setCrop(full ? null : {
        x: Math.round(cropDraft.x),
        y: Math.round(cropDraft.y),
        width: Math.round(cropDraft.width),
        height: Math.round(cropDraft.height),
    });
    useScreenshotUIStore.getState().setTool('select');
}

/** Removes the crop entirely. */
export function resetCrop(): void {
    useScreenshotStore.getState().setCrop(null);
    useScreenshotUIStore.getState().setTool('select');
}

export function cancelCrop(): void {
    useScreenshotUIStore.getState().setTool('select');
}

/** Switches tools; crop goes through startCrop so it always has a draft. */
export function chooseTool(tool: ScreenshotTool): void {
    if (tool === 'crop') {
        startCrop();
        return;
    }
    useScreenshotUIStore.getState().setTool(tool);
}

export function deleteSelected(): void {
    const { selectedId, select } = useScreenshotUIStore.getState();
    if (!selectedId) return;
    useScreenshotStore.getState().removeAnnotation(selectedId);
    select(null);
}

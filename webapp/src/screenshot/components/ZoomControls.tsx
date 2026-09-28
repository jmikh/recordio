/**
 * Floating view-zoom control: zoom out, the current percentage (click =
 * back to fit-to-width), zoom in. Presentational — the screenshot editor
 * wires it to its UI store (ScreenshotZoomControls), the public screenshot
 * page to local state. Absolutely positioned: the caller supplies the
 * `relative` container it floats over.
 */
import { LuZoomIn, LuZoomOut } from 'react-icons/lu';
import { Button } from '@shared/components';

interface ZoomControlsProps {
    /** Display px per source px */
    scale: number;
    isFit: boolean;
    canZoomOut: boolean;
    canZoomIn: boolean;
    onZoomOut: () => void;
    onZoomIn: () => void;
    onFit: () => void;
    /** Append the editor's ⌘ shortcuts to the tooltips */
    showShortcuts?: boolean;
}

export function ZoomControls({ scale, isFit, canZoomOut, canZoomIn, onZoomOut, onZoomIn, onFit, showShortcuts = false }: ZoomControlsProps) {
    const percent = Math.round(scale * 100);
    const hint = (label: string, keys: string) => showShortcuts ? `${label} (${keys})` : label;

    return (
        <div
            role="group"
            aria-label="Zoom"
            className="absolute bottom-4 right-6 flex items-center gap-0.5 p-1 bg-surface-raised border border-border rounded-[var(--radius-md)] shadow-float"
        >
            <Button variant="ghost" icon={LuZoomOut} aria-label="Zoom out" title={hint('Zoom out', '⌘−')} onClick={onZoomOut} disabled={!canZoomOut} />
            <Button
                variant="ghost"
                onClick={onFit}
                disabled={isFit}
                aria-label={`Zoom ${percent}%, fit to width`}
                title={hint('Fit to width', '⌘0')}
                className="w-14 justify-center text-xs tabular-nums"
            >
                {percent}%
            </Button>
            <Button variant="ghost" icon={LuZoomIn} aria-label="Zoom in" title={hint('Zoom in', '⌘+')} onClick={onZoomIn} disabled={!canZoomIn} />
        </div>
    );
}

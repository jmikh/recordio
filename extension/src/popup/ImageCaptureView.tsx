/**
 * @fileoverview Image capture view (plans/screenshots).
 *
 * Shown when the popup's mode toggle is on Image and no recording is
 * active. Three capture actions on the current tab; the background owns
 * the session (see background/screenshotCapture.ts):
 *   - Visible area: awaited here — the row shows "Capturing…" and the popup
 *     closes when the import tab takes focus.
 *   - Select area: acked immediately; the popup closes itself so the user
 *     can drag on the page.
 *   - Full page: acked immediately; the popup STAYS OPEN and flips to
 *     CapturingView (progress from chrome.storage.session + Cancel) — that is
 *     the only progress UI, nothing is drawn on the page or the icon badge.
 *     The popup is not part of the tab, so it never lands in the capture. If
 *     the user dismisses it, reopening shows the same view.
 */

import { useEffect, useState } from 'react';
import { Button } from '@shared/components';
import { LuAppWindow, LuChevronRight, LuGalleryVertical, LuSquareDashed } from 'react-icons/lu';
import { MSG_TYPES, type ScreenshotMode, type ScreenshotState } from '../shared/messageTypes';
import { isActiveTabCapturable } from './activeTab';

const ACTIONS: Array<{ mode: ScreenshotMode; label: string; icon: typeof LuAppWindow }> = [
    { mode: 'visible', label: 'Visible area', icon: LuAppWindow },
    { mode: 'fullPage', label: 'Full page', icon: LuGalleryVertical },
    { mode: 'region', label: 'Select area', icon: LuSquareDashed },
];

export function ImageCaptureView() {
    const [canCapture, setCanCapture] = useState(true);
    const [busy, setBusy] = useState<ScreenshotMode | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        isActiveTabCapturable().then(setCanCapture);
    }, []);

    const handleCapture = async (mode: ScreenshotMode) => {
        setError(null);
        setBusy(mode);
        try {
            const resp = await chrome.runtime.sendMessage({
                type: MSG_TYPES.POPUP_CAPTURE_SCREENSHOT,
                payload: { mode },
            });
            if (!resp?.success) {
                setError(resp?.error || 'Screenshot failed.');
                setBusy(null);
                return;
            }
            // Visible: the import tab is opening and will steal focus. Region:
            // get out of the way so the user can drag on the page. Full page:
            // stay open — PopupApp swaps in CapturingView once the background
            // writes SCREENSHOT_STATE.
            if (mode === 'region') window.close();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Unexpected error');
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-col gap-2">
                {ACTIONS.map(({ mode, label, icon: Icon }) => (
                    <Button
                        key={mode}
                        variant="base"
                        onClick={() => handleCapture(mode)}
                        disabled={!canCapture || busy !== null}
                        className="w-full justify-start gap-3"
                        aria-label={label}
                    >
                        <Icon className="icon-md text-text-muted" />
                        {busy === mode ? 'Capturing…' : label}
                        <LuChevronRight className="icon-md text-text-muted ml-auto" />
                    </Button>
                ))}
            </div>

            {!canCapture && (
                <p className="text-xs text-text-muted px-1 text-center">
                    Cannot capture this page.
                </p>
            )}
            {error && (
                <p role="alert" className="text-xs text-destructive px-1">{error}</p>
            )}

            <p className="text-label px-1 text-center">
                Annotate in the editor after capture.
            </p>
        </div>
    );
}

const MODE_LABELS: Record<ScreenshotMode, string> = {
    visible: 'Capturing visible area…',
    fullPage: 'Capturing full page…',
    region: 'Select an area on the page…',
};

/** Reopened popup while a capture is in progress. */
export function CapturingView({ state }: { state: ScreenshotState }) {
    const progress = state.progress;
    const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

    const handleCancel = () => {
        chrome.runtime.sendMessage({ type: MSG_TYPES.POPUP_CANCEL_SCREENSHOT }).catch(() => {});
        window.close();
    };

    return (
        <div className="flex flex-col gap-3 p-3">
            <p role="status" className="text-sm text-text-main flex items-center justify-between gap-2">
                <span>{MODE_LABELS[state.mode]}</span>
                {progress && progress.total > 0 && (
                    <span className="text-text-muted tabular-nums">{pct}%</span>
                )}
            </p>
            {progress && (
                <div className="h-1.5 rounded-full overflow-hidden bg-border" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
            )}
            <Button variant="ghost" onClick={handleCancel} className="w-full justify-center">
                Cancel
            </Button>
        </div>
    );
}

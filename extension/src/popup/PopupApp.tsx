/**
 * @fileoverview Popup App
 *
 * Root component for the extension popup.
 *
 * When a recording is active:
 *   - Not paused → immediately pause and show RecordingView (user resumes/finishes/cancels)
 *   - Paused     → show RecordingView as-is (user was already paused)
 *
 * When no recording is active, the header's Video | Image toggle picks the
 * product: PreRecordingView (video) or ImageCaptureView (screenshots,
 * plans/screenshots). The choice is persisted in recordio_prefs. A screenshot
 * capture in progress (full page) shows CapturingView instead.
 */

import { useEffect, useState } from 'react';
import { LuCircleAlert, LuImage, LuVideo } from 'react-icons/lu';
import { Button, LogoLink, MultiToggle } from '@shared/components';
import { MSG_TYPES, STORAGE_KEYS, type RecordingState, type ScreenshotState } from '../shared/messageTypes';
import { getEditorOrigin } from '@shared/types/bridge';
import { PreRecordingView } from './PreRecordingView';
import { RecordingView } from './RecordingView';
import { ImageCaptureView, CapturingView } from './ImageCaptureView';
import { closeBlurMode } from './blurMode';
import { loadPrefs, updatePrefs, type PopupMode } from './prefs';

interface StoredError {
    title: string;
    message: string;
}

export function PopupApp() {
    const [recordingState, setRecordingState] = useState<RecordingState | null>(null);
    const [screenshotState, setScreenshotState] = useState<ScreenshotState | null>(null);
    const [storedError, setStoredError] = useState<StoredError | null>(null);
    const [mode, setMode] = useState<PopupMode>('video');
    const [ready, setReady] = useState(false);

    useEffect(() => {
        // Opening the popup ends any blur-picking session left on a page
        closeBlurMode();

        (async () => {
            const prefs = await loadPrefs();
            setMode(prefs.mode ?? 'video');

            const result = await chrome.storage.session.get([
                STORAGE_KEYS.RECORDING_STATE,
                STORAGE_KEYS.RECORDING_ERROR,
                STORAGE_KEYS.SCREENSHOT_STATE,
                STORAGE_KEYS.SCREENSHOT_ERROR,
            ]);

            // A failed save/capture takes precedence — show it, clear it and the badge
            const recordingError = result[STORAGE_KEYS.RECORDING_ERROR] as { message: string } | undefined;
            const screenshotError = result[STORAGE_KEYS.SCREENSHOT_ERROR] as { message: string } | undefined;
            if (recordingError?.message || screenshotError?.message) {
                setStoredError(recordingError?.message
                    ? { title: 'Recording failed to save', message: recordingError.message }
                    : { title: 'Screenshot failed', message: screenshotError!.message });
                chrome.storage.session.remove([STORAGE_KEYS.RECORDING_ERROR, STORAGE_KEYS.SCREENSHOT_ERROR]);
                chrome.action.setBadgeText({ text: '' });
                setReady(true);
                return;
            }

            const shot = result[STORAGE_KEYS.SCREENSHOT_STATE] as ScreenshotState | undefined;
            if (shot?.active) setScreenshotState(shot);

            const state = result[STORAGE_KEYS.RECORDING_STATE] as RecordingState | undefined;
            if (state?.isRecording) {
                // Auto-pause if currently playing so the popup doesn't appear in the recording.
                // If already paused, just open — the user will resume manually.
                if (!state.isPaused) {
                    await chrome.runtime.sendMessage({ type: MSG_TYPES.POPUP_PAUSE_RECORDING }).catch(() => { });
                    // Re-read state from storage after the pause is applied so the timer
                    // displays the correct frozen elapsed time from the start.
                    const refreshed = await chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE);
                    setRecordingState(refreshed[STORAGE_KEYS.RECORDING_STATE] as RecordingState ?? state);
                } else {
                    setRecordingState(state);
                }
            }

            setReady(true);
        })();
    }, []);

    // Keep RecordingView / CapturingView / the error card in sync with state changes from background
    useEffect(() => {
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
            if (area !== 'session') return;
            if (changes[STORAGE_KEYS.RECORDING_STATE]) {
                const newState = changes[STORAGE_KEYS.RECORDING_STATE].newValue as RecordingState | undefined;
                setRecordingState(newState?.isRecording ? newState : null);
            }
            if (changes[STORAGE_KEYS.SCREENSHOT_STATE]) {
                const newState = changes[STORAGE_KEYS.SCREENSHOT_STATE].newValue as ScreenshotState | undefined;
                setScreenshotState(newState?.active ? newState : null);
            }
            // The popup stays open during a full-page capture, so a failure can
            // land while it is showing — same handling as the mount-time read.
            const shotError = changes[STORAGE_KEYS.SCREENSHOT_ERROR]?.newValue as { message: string } | undefined;
            if (shotError?.message) {
                setStoredError({ title: 'Screenshot failed', message: shotError.message });
                chrome.storage.session.remove(STORAGE_KEYS.SCREENSHOT_ERROR);
                chrome.action.setBadgeText({ text: '' });
            }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
    }, []);

    const handleModeChange = (next: PopupMode) => {
        setMode(next);
        void updatePrefs({ mode: next });
    };

    if (!ready) {
        return null;
    }

    const showToggle = !storedError && !recordingState && !screenshotState;

    return (
        <div className="bg-surface-body p-1 flex flex-col gap-1">
            <div className="flex items-center justify-between">
                {/* Logo doubles as the dashboard link */}
                <Button
                    variant="ghost"
                    onClick={() => chrome.tabs.create({ url: getEditorOrigin() })}
                    aria-label="Open dashboard"
                    title="Open dashboard"
                    className="self-start hover:opacity-80 transition-opacity"
                >
                    <LogoLink imgClassName="h-6 w-auto" />
                </Button>
                {showToggle && (
                    <div aria-label="Capture mode" className="mr-1">
                        <MultiToggle<PopupMode>
                            options={[
                                { value: 'video', icon: <LuVideo className="icon-sm" />, tooltip: 'Record video' },
                                { value: 'image', icon: <LuImage className="icon-sm" />, tooltip: 'Capture screenshot' },
                            ]}
                            value={mode}
                            onChange={handleModeChange}
                        />
                    </div>
                )}
            </div>
            <div className="bg-surface border border-border rounded-[var(--radius-lg)] shadow-sm overflow-hidden">
                {storedError ? (
                    <div className="flex flex-col gap-3 p-3">
                        <div className="flex items-start gap-2.5">
                            <LuCircleAlert className="icon-md text-destructive shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-1">
                                <p role="alert" className="text-sm text-text-main">{storedError.title}</p>
                                <p className="text-xs text-text-muted">{storedError.message}</p>
                            </div>
                        </div>
                        <p className="text-xs text-text-muted">
                            If this keeps happening, contact{' '}
                            <a
                                href="mailto:john@recordio.io"
                                className="text-primary underline"
                                onClick={() => chrome.tabs.create({ url: 'mailto:john@recordio.io' })}
                            >
                                john@recordio.io
                            </a>
                        </p>
                    </div>
                ) : recordingState ? (
                    <RecordingView recordingState={recordingState} />
                ) : screenshotState ? (
                    <CapturingView state={screenshotState} />
                ) : mode === 'image' ? (
                    <ImageCaptureView />
                ) : (
                    <PreRecordingView />
                )}
            </div>
        </div>
    );
}

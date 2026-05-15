/**
 * @fileoverview Popup App
 *
 * Root component for the extension popup.
 *
 * When a recording is active:
 *   - Not paused → immediately pause and show RecordingView (user resumes/finishes/cancels)
 *   - Paused     → show RecordingView as-is (user was already paused)
 *
 * When no recording is active, renders PreRecordingView as normal.
 */

import { useEffect, useState } from 'react';
import { GrProjects } from 'react-icons/gr';
import { MdErrorOutline } from 'react-icons/md';
import { MSG_TYPES, STORAGE_KEYS, type RecordingState } from '../shared/messageTypes';
import { getEditorOrigin } from '@shared/types/bridge';
import { PreRecordingView } from './PreRecordingView';
import { RecordingView } from './RecordingView';
import logoLight from '@shared/assets/fulllogo-light.png';

export function PopupApp() {
    const [recordingState, setRecordingState] = useState<RecordingState | null>(null);
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        (async () => {
        const result = await chrome.storage.session.get([STORAGE_KEYS.RECORDING_STATE, STORAGE_KEYS.RECORDING_ERROR]);
            // Check for a recording save failure first
            const errorData = result[STORAGE_KEYS.RECORDING_ERROR] as { message: string } | undefined;
            if (errorData?.message) {
                setRecordingError(errorData.message);
                // Clear it and the error badge now that the user is seeing it
                chrome.storage.session.remove(STORAGE_KEYS.RECORDING_ERROR);
                chrome.action.setBadgeText({ text: '' });
                setReady(true);
                return;
            }

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

    // Keep RecordingView in sync with state changes from background
    useEffect(() => {
        if (!recordingState) return;
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
            if (area === 'session' && changes[STORAGE_KEYS.RECORDING_STATE]) {
                const newState = changes[STORAGE_KEYS.RECORDING_STATE].newValue as RecordingState | undefined;
                setRecordingState(newState?.isRecording ? newState : null);
            }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
    }, [!!recordingState]);

    if (!ready) {
        return null;
    }

    return (
        <div className="bg-surface-body">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <img src={logoLight} alt="Recordio" className="h-5 w-auto" />
                <GrProjects
                    className="icon-md text-text-muted hover:text-text-main cursor-pointer transition-colors"
                    onClick={() => chrome.tabs.create({ url: getEditorOrigin() })}
                />
            </div>
            {recordingError ? (
                <div className="flex flex-col gap-3 p-4">
                    <div className="flex items-start gap-2.5">
                        <MdErrorOutline className="icon-md text-destructive shrink-0 mt-0.5" />
                        <div className="flex flex-col gap-1">
                            <p className="text-sm font-medium text-text-main">Recording failed to save</p>
                            <p className="text-xs text-text-muted">{recordingError}</p>
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
            ) : (
                <PreRecordingView />
            )}
        </div>
    );
}

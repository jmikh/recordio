import { useState, useEffect } from 'react';
import { MSG_TYPES, STORAGE_KEYS } from '../shared/messageTypes';
import { RecordingStatus } from './components/RecordingStatus';

import logoDark from '@shared/assets/fulllogo-dark.png';
import logoLight from '@shared/assets/fulllogo-light.png';

/**
 * Popup App — Recording Status Only
 * 
 * The popup is only shown when recording is active
 * (background dynamically sets the popup via chrome.action.setPopup).
 * It displays the recording timer and a stop button.
 */
function App() {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingStartTime, setRecordingStartTime] = useState<number>(0);
    const [recordingMode, setRecordingMode] = useState<'window' | 'screen'>('window');
    const [recordingDuration, setRecordingDuration] = useState<number>(0);
    const [recordingHasAudio, setRecordingHasAudio] = useState(false);
    const [recordingHasCamera, setRecordingHasCamera] = useState(false);

    // Update recording duration every second
    useEffect(() => {
        if (!isRecording || !recordingStartTime) {
            setRecordingDuration(0);
            return;
        }

        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        setRecordingDuration(elapsed);

        const interval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            setRecordingDuration(elapsed);
        }, 1000);

        return () => clearInterval(interval);
    }, [isRecording, recordingStartTime]);

    useEffect(() => {
        // Initial State from Storage
        chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE).then((result) => {
            const state = result[STORAGE_KEYS.RECORDING_STATE];
            if (state && (state as any).isRecording) {
                setIsRecording(true);
                setRecordingStartTime((state as any).startTime || 0);
                setRecordingHasAudio((state as any).hasAudio || false);
                setRecordingHasCamera((state as any).hasCamera || false);
                if ((state as any).mode) setRecordingMode((state as any).mode);
            }
        });

        // Listen for external changes
        const storageListener = (changes: any, areaName: string) => {
            if (areaName === 'session' && changes[STORAGE_KEYS.RECORDING_STATE]) {
                const newState = changes[STORAGE_KEYS.RECORDING_STATE].newValue;
                setIsRecording(newState?.isRecording || false);
                setRecordingStartTime(newState?.startTime || 0);
                setRecordingHasAudio(newState?.hasAudio || false);
                setRecordingHasCamera(newState?.hasCamera || false);
                if (newState?.mode) setRecordingMode(newState.mode);
            }
        };
        chrome.storage.onChanged.addListener(storageListener);

        // Fallback: Query Background
        chrome.runtime.sendMessage({
            type: MSG_TYPES.GET_RECORDING_STATE,
            payload: {}
        }, (response: any) => {
            if (response && response.isRecording) {
                setIsRecording(true);
                setRecordingStartTime(response.startTime || 0);
                setRecordingHasAudio(response.hasAudio || false);
                setRecordingHasCamera(response.hasCamera || false);
                if (response.mode) setRecordingMode(response.mode);
            }
        });

        return () => {
            chrome.storage.onChanged.removeListener(storageListener);
        };
    }, []);

    const stopRecording = () => {
        chrome.runtime.sendMessage({
            type: MSG_TYPES.STOP_SESSION,
            payload: {}
        }, (response: any) => {
            if (response?.success) {
                setIsRecording(false);
                window.close();
            }
        });
    };

    return (
        <div className="relative w-[320px] bg-surface-raised text-text-highlighted font-sans overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-1 border-b border-border bg-surface">
                <span className="opacity-90">
                    <img src={logoLight} alt="Recordio" className="logo-for-light h-5" />
                    <img src={logoDark} alt="Recordio" className="logo-for-dark h-5" />
                </span>
            </div>

            {/* Main Content */}
            <div className="p-2 flex flex-col">
                {isRecording ? (
                    <RecordingStatus
                        recordingDuration={recordingDuration}
                        stopRecording={stopRecording}
                        hasAudio={recordingHasAudio}
                        hasCamera={recordingHasCamera}
                        recordingMode={recordingMode}
                    />
                ) : (
                    <div className="flex flex-col items-center gap-3 py-4 text-text-muted text-sm">
                        <p>Not recording</p>
                        <p className="text-xs">Click the extension icon to start</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;

/**
 * @fileoverview Controller Tab — Recording Surface
 *
 * Opens the OS source picker immediately on load. As soon as the user picks
 * a source, background sends BACKGROUND_CONTROLLER_START_RECORDING and
 * recording begins right away — no countdown, no extra steps.
 *
 * If recording the current window, Chrome switches focus automatically;
 * otherwise the controller tab stays in the background as the recording host.
 * All controls (pause/resume/finish/cancel) come from the popup via background.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoRecorder } from '../shared/videoRecorder';
import { MSG_TYPES, type RecordingConfig, type RecordingState, STORAGE_KEYS } from '../shared/messageTypes';
import { Button } from '@shared/components';
import { captureException } from '../utils/sentry';
import { RecordingPhase } from './RecordingPhase';
import startSoundUrl from '../assets/countdown-sound.mp3?url';

function CalibrationMarkers() {
    const markerStyle = "fixed w-[50px] h-[50px] z-[9999] flex items-center justify-center";
    const primaryBg = "bg-[oklch(0.58_0.19_290)]";
    const secondaryBg = "bg-[oklch(0.80_0.15_78)]";
    return (
        <>
            <div className={`${markerStyle} ${primaryBg} top-0 left-0`}><div className={`w-5 h-5 ${secondaryBg}`} /></div>
            <div className={`${markerStyle} ${primaryBg} top-0 right-0`}><div className={`w-5 h-5 ${secondaryBg}`} /></div>
            <div className={`${markerStyle} ${primaryBg} bottom-0 left-0`}><div className={`w-5 h-5 ${secondaryBg}`} /></div>
            <div className={`${markerStyle} ${primaryBg} bottom-0 right-0`}><div className={`w-5 h-5 ${secondaryBg}`} /></div>
        </>
    );
}

type ControllerPhase = 'picking' | 'recording';

export function ControllerApp() {
    const [phase, setPhase] = useState<ControllerPhase>('picking');
    const [error, setError] = useState<string | null>(null);

    const displayStreamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<VideoRecorder | null>(null);
    const sessionIdRef = useRef<string>('');
    const isRecordingRef = useRef(false);
    const originalTabIdRef = useRef<number | null>(null);

    const [liveRecordingState, setLiveRecordingState] = useState<RecordingState | null>(null);

    // Load original tab ID from storage
    useEffect(() => {
        chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE).then((result) => {
            const state = result[STORAGE_KEYS.RECORDING_STATE] as any;
            if (state?.originalTabId) {
                originalTabIdRef.current = state.originalTabId;
            }
        });
    }, []);

    // Ask background for the pending mic/camera config and prewarm streams inside the recorder.
    // Runs in parallel with the OS source picker so streams are settled by recording start.
    useEffect(() => {
        let cancelled = false;
        chrome.runtime.sendMessage({ type: MSG_TYPES.CONTROLLER_READY }).then((config: {
            hasAudio: boolean; audioDeviceId?: string;
            hasCamera: boolean; videoDeviceId?: string;
        } | null) => {
            if (cancelled || !config || (!config.hasAudio && !config.hasCamera)) return;
            const recorder = new VideoRecorder('', { hasAudio: config.hasAudio, hasCamera: config.hasCamera });
            recorderRef.current = recorder;
            recorder.prewarm(config);
        }).catch(() => { /* background may not respond if no config pending */ });

        return () => { cancelled = true; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Source Selection ---
    const chooseSource = useCallback(async () => {
        setError(null);

        try {
            const currentTab = await chrome.tabs.getCurrent();
            if (!currentTab) throw new Error("Cannot get current tab");

            const sources = ['window', 'screen', 'audio'] as chrome.desktopCapture.DesktopCaptureSourceType[];

            const capturedSourceId = await new Promise<string>((resolve, reject) => {
                chrome.desktopCapture.chooseDesktopMedia(sources, currentTab, (streamId) => {
                    if (streamId) resolve(streamId);
                    else reject(new Error("Cancelled"));
                });
            });

            let displayStream: MediaStream;
            try {
                displayStream = await navigator.mediaDevices.getUserMedia({
                    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: capturedSourceId } },
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: capturedSourceId, maxWidth: 3840, maxHeight: 2160 } }
                } as any);
            } catch (e) {
                console.warn("[chooseSource] audio+video getUserMedia failed:", e instanceof OverconstrainedError ? `constraint=${e.constraint}` : e);
                displayStream = await navigator.mediaDevices.getUserMedia({
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: capturedSourceId, maxWidth: 3840, maxHeight: 2160 } }
                } as any);
            }

            displayStream.getVideoTracks()[0].onended = () => {
                if (!isRecordingRef.current) window.close();
            };

            displayStreamRef.current = displayStream;

            // Notify background — it will send BACKGROUND_CONTROLLER_START_RECORDING immediately
            await chrome.runtime.sendMessage({
                type: MSG_TYPES.CONTROLLER_SOURCE_SELECTED,
                payload: {},
            });
        } catch (err: any) {
            if (err.message === 'Cancelled') {
                window.close();
            } else {
                console.error("Error choosing source:", err);
                setError(err.message || 'Failed to choose source');
            }
        }
    }, []);

    // Kick off source selection immediately on mount
    useEffect(() => {
        chooseSource();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Start Recording ---
    const startRecording = useCallback(async (config: {
        hasAudio: boolean;
        audioDeviceId?: string;
        hasCamera: boolean;
        videoDeviceId?: string;
        sessionId: string;
    }) => {
        const displayStream = displayStreamRef.current;
        if (!displayStream) {
            console.error('[Controller] startRecording called but no displayStream');
            return;
        }

        setError(null);
        sessionIdRef.current = config.sessionId;

        try {
            let tabTitle = 'Recording';
            if (originalTabIdRef.current) {
                try {
                    const tab = await chrome.tabs.get(originalTabIdRef.current);
                    tabTitle = tab.title || 'Recording';
                } catch { /* tab may be gone */ }
            }

            const recordingConfig: RecordingConfig = {
                hasAudio: config.hasAudio,
                hasCamera: config.hasCamera,
                audioDeviceId: config.audioDeviceId,
                videoDeviceId: config.videoDeviceId,
                displayStream,
                tabViewportSize: { width: window.innerWidth, height: window.innerHeight },
            };

            // Reuse pre-created recorder (which may already hold prewarmed streams) or create fresh.
            let recorder = recorderRef.current;
            if (recorder) {
                recorder.setSessionId(config.sessionId);
            } else {
                recorder = new VideoRecorder(config.sessionId, recordingConfig);
                recorderRef.current = recorder;
            }

            const detectionResult = await recorder.prepare(recordingConfig);

            if (detectionResult?.isControllerWindow) {
                recorder.setRecordingPreferences({
                    applyAutoZoom: true,
                    applySpotlight: true,
                    simplifyToolbar: false,
                });
            }

            await recorder.start(tabTitle);
            isRecordingRef.current = true;

            // Play start chime
            new Audio(startSoundUrl).play().catch(() => {});

            // Switch to original tab if recording this window (Chrome may do it automatically,
            // but we do it explicitly to be sure)
            if (detectionResult?.isControllerWindow && originalTabIdRef.current) {
                await chrome.tabs.update(originalTabIdRef.current, { active: true }).catch(() => {});
            }

            setPhase('recording');

            const shouldTrackEvents = detectionResult?.isControllerWindow ?? false;
            const displaySurface = displayStream.getVideoTracks()[0]?.getSettings()?.displaySurface;
            const captureType = shouldTrackEvents
                ? 'current_window'
                : displaySurface === 'monitor'
                    ? 'desktop'
                    : displaySurface === 'browser'
                        ? 'tab'
                        : 'another_window';

            const syncTimestamp = Date.now();
            chrome.runtime.sendMessage({
                type: MSG_TYPES.CONTROLLER_STARTED_RECORDING,
                payload: {
                    sessionId: config.sessionId,
                    isCurrentWindow: shouldTrackEvents,
                    hasAudio: config.hasAudio,
                    hasCamera: config.hasCamera,
                    originalTabId: originalTabIdRef.current,
                    captureType,
                }
            });

            if (shouldTrackEvents) {
                const tabs = await chrome.tabs.query({});
                for (const tab of tabs) {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, {
                            type: MSG_TYPES.START_RECORDING_EVENTS,
                            payload: { startTime: syncTimestamp, sessionId: config.sessionId }
                        }).catch(() => {});
                    }
                }
            }
        } catch (err: any) {
            console.error("Error starting recording:", err);
            setError(err.message || 'Failed to start recording');
        }
    }, []);

    // --- Stop Recording ---
    const stopRecording = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) {
            console.warn('[Controller] stopRecording called but no recorder ref');
            return;
        }

        try {
            await recorder.finish(sessionIdRef.current);
        } catch (e) {
            console.error('[Controller] Error finishing recording:', e);
            captureException(e instanceof Error ? e : new Error(String(e)));
            chrome.runtime.sendMessage({
                type: MSG_TYPES.RECORDING_FAILED,
                payload: { error: e instanceof Error ? e.message : String(e), mode: 'controller' },
            }).catch(() => {});
            const msg = e instanceof Error && e.name === 'QuotaExceededError'
                ? 'Not enough storage space to save the recording. Free up disk space and try again.'
                : 'Failed to save recording. Please try again.';
            setError(msg);
            setPhase('picking');
            isRecordingRef.current = false;
            return;
        }

        chrome.runtime.sendMessage({
            type: MSG_TYPES.CONTROLLER_STOPPED_RECORDING,
            payload: { sessionId: sessionIdRef.current }
        });
    }, []);

    // Sync recording state for RecordingPhase UI
    useEffect(() => {
        if (phase !== 'recording') return;

        chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE).then((result) => {
            const state = result[STORAGE_KEYS.RECORDING_STATE] as RecordingState;
            if (state) setLiveRecordingState(state);
        });

        const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes[STORAGE_KEYS.RECORDING_STATE]) {
                setLiveRecordingState(changes[STORAGE_KEYS.RECORDING_STATE].newValue as RecordingState);
            }
        };
        chrome.storage.session.onChanged.addListener(listener);
        return () => chrome.storage.session.onChanged.removeListener(listener);
    }, [phase]);

    const handlePauseResume = useCallback(() => {
        const type = liveRecordingState?.isPaused
            ? MSG_TYPES.POPUP_RESUME_RECORDING
            : MSG_TYPES.POPUP_PAUSE_RECORDING;
        chrome.runtime.sendMessage({ type }).catch(() => {});
    }, [liveRecordingState?.isPaused]);

    const handleCancel = useCallback(() => {
        const recorder = recorderRef.current;
        if (recorder) {
            recorder.cancel(sessionIdRef.current).catch(() => {});
            recorderRef.current = null;
        }
        chrome.runtime.sendMessage({ type: MSG_TYPES.POPUP_CANCEL_RECORDING }).catch(() => {});
        window.close();
    }, []);

    // Listen for messages from background
    useEffect(() => {
        const listener = (message: any) => {
            switch (message.type) {
                case MSG_TYPES.BACKGROUND_CONTROLLER_START_RECORDING:
                    startRecording(message.payload);
                    break;
                case MSG_TYPES.STOP_SESSION:
                    stopRecording();
                    break;
                case MSG_TYPES.BACKGROUND_CONTROLLER_PAUSE:
                    recorderRef.current?.pause();
                    break;
                case MSG_TYPES.BACKGROUND_CONTROLLER_RESUME:
                    recorderRef.current?.resume();
                    break;
                case MSG_TYPES.BACKGROUND_CONTROLLER_CANCEL: {
                    const recorder = recorderRef.current;
                    if (recorder) {
                        recorder.cancel(sessionIdRef.current).catch(() => {});
                        recorderRef.current = null;
                    }
                    displayStreamRef.current?.getTracks().forEach(t => t.stop());
                    displayStreamRef.current = null;
                    window.close();
                    break;
                }
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, [startRecording, stopRecording]);

    // Stop Sharing button during recording
    useEffect(() => {
        if (phase !== 'recording') return;
        const stream = recorderRef.current?.getPreviewStream();
        const videoTrack = stream?.getVideoTracks()[0];
        if (!videoTrack) return;

        const onTrackEnded = () => stopRecording();
        videoTrack.addEventListener('ended', onTrackEnded);
        return () => videoTrack.removeEventListener('ended', onTrackEnded);
    }, [phase, stopRecording]);

    // Forward user events from content scripts to recorder
    useEffect(() => {
        const listener = (message: any) => {
            if (message.type === MSG_TYPES.CONTENT_CAPTURE_USER_EVENT && message.payload) {
                recorderRef.current?.addEvent(message.payload);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    // Cleanup on unmount: stop display stream and cancel recorder (stops any prewarmed streams)
    useEffect(() => {
        return () => {
            if (!isRecordingRef.current) {
                displayStreamRef.current?.getTracks().forEach(t => t.stop());
                recorderRef.current?.cancel('').catch(() => {});
            }
        };
    }, []);

    // --- Render ---
    if (phase === 'recording') {
        return (
            <div className="min-h-screen bg-surface text-text-highlighted font-sans flex flex-col">
                <main className="max-w-xl mx-auto px-5 py-6">
                    <RecordingPhase
                        hasAudio={liveRecordingState?.hasAudio ?? false}
                        hasCamera={liveRecordingState?.hasCamera ?? false}
                        recordingState={liveRecordingState}
                        onPauseResume={handlePauseResume}
                        onFinish={stopRecording}
                        onCancel={handleCancel}
                    />
                </main>
            </div>
        );
    }

    // picking phase — CalibrationMarkers must be rendered for window detection
    return (
        <div className="min-h-screen bg-surface text-text-highlighted font-sans flex flex-col items-center p-8">
            <CalibrationMarkers />
            <div className="mt-140 text-center">
                {error ? (
                    <div className="flex flex-col items-center gap-3">
                        <p className="text-destructive text-sm">{error}</p>
                        <Button variant="primary" onClick={chooseSource}>Try again</Button>
                    </div>
                ) : (
                    <p className="text-2xl font-semibold text-text-main">
                        Recording will start as soon as you share a screen
                    </p>
                )}
            </div>
        </div>
    );
}

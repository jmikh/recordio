/**
 * @fileoverview Controller Tab — Recording Setup Hub
 *
 * This is the main page for initiating recordings. The user:
 * 1. Selects a source type (Window or Screen)
 * 2. Picks the source via Chrome's desktop capture picker
 * 3. Gets a live preview + window detection feedback
 * 4. Configures mic/camera with live feedback
 * 5. Clicks "Start Recording" → recording begins, switches to original tab
 *
 * All recording logic runs in this tab via VideoRecorder.
 * Communication with background is minimal (state updates only).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoRecorder } from '../shared/videoRecorder';
import { MSG_TYPES, type RecordingConfig, type RecordingState, STORAGE_KEYS } from '../shared/messageTypes';
import type { WindowDetectionResult } from '../shared/windowDetector';
import { Button, Tooltip, Modal } from '@shared/components';
import viewPermissionsImage from '../assets/view-permissions.png';
import permissionsImage from '../assets/permissions-small.png';
import { MdFiberManualRecord } from 'react-icons/md';
import { GrProjects } from 'react-icons/gr';
import { getEditorOrigin } from '@shared/types/bridge';
import { captureException } from '../utils/sentry';
import logoLight from '@shared/assets/fulllogo-light.png';
import logoDark from '@shared/assets/fulllogo-dark.png';
import '@shared/components/LogoLink.css';

import { MicrophoneCard } from './MicrophoneCard';
import { CameraCard } from './CameraCard';
import { ScreenShareCard, CalibrationMarkers } from './ScreenShareCard';
import { RecordingPhase } from './RecordingPhase';

export type ControllerTab = 'mic' | 'camera' | 'screen';

type ControllerPhase = 'setup' | 'recording';

export function ControllerApp() {
    // --- Phase ---
    const [phase, setPhase] = useState<ControllerPhase>('setup');

    // --- Source Selection ---

    // --- Preview ---
    const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
    const [detectionResult, setDetectionResult] = useState<WindowDetectionResult | null>(null);
    const previewVideoRef = useRef<HTMLVideoElement>(null);

    // --- Media (parent tracks enabled + deviceId for prefs & recording config) ---
    const [isAudioEnabled, setIsAudioEnabled] = useState(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(false);
    const [selectedAudioId, setSelectedAudioId] = useState('');
    const [selectedVideoId, setSelectedVideoId] = useState('');
    const [prefsLoaded, setPrefsLoaded] = useState(false);
    const [showPermissionModal, setShowPermissionModal] = useState(false);

    const [activeTab, setActiveTab] = useState<ControllerTab>('screen');

    // --- Recording ---
    const recorderRef = useRef<VideoRecorder | null>(null);
    const sessionIdRef = useRef<string>('');
    const [isRecording, setIsRecording] = useState(false);
    const isRecordingRef = useRef(false);
    const [liveRecordingState, setLiveRecordingState] = useState<RecordingState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isChoosing, setIsChoosing] = useState(false);
    const [cameraDeviceError, setCameraDeviceError] = useState(false);
    const [micDeviceError, setMicDeviceError] = useState(false);


    // --- Original Tab ---
    const originalTabIdRef = useRef<number | null>(null);
    const [originalTab, setOriginalTab] = useState<{ title?: string; favIconUrl?: string } | null>(null);

    // Load original tab ID from storage
    useEffect(() => {
        chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE).then((result) => {
            const state = result[STORAGE_KEYS.RECORDING_STATE] as any;
            if (state?.originalTabId) {
                originalTabIdRef.current = state.originalTabId;
                chrome.tabs.get(state.originalTabId).then(tab => {
                    if (tab) {
                        setOriginalTab({ title: tab.title, favIconUrl: tab.favIconUrl });
                    }
                }).catch(() => { });
            }
        });
    }, []);

// Load saved preferences from chrome.storage.local
    useEffect(() => {
        chrome.storage.local.get('recordio_prefs').then((result) => {
            const prefs = result.recordio_prefs as any;
            if (prefs) {
                // Field names match the popup's storage format (micEnabled/camEnabled/selectedMicId/selectedCamId)
                if (typeof prefs.micEnabled === 'boolean') setIsAudioEnabled(prefs.micEnabled);
                if (typeof prefs.camEnabled === 'boolean') setIsVideoEnabled(prefs.camEnabled);
                if (prefs.selectedMicId) setSelectedAudioId(prefs.selectedMicId);
                if (prefs.selectedCamId) setSelectedVideoId(prefs.selectedCamId);
            }
            setPrefsLoaded(true);
            if (prefs?.camEnabled) setActiveTab('camera');
        });
    }, []);

    // Save preferences when they change (field names match popup's storage format)
    useEffect(() => {
        if (!prefsLoaded) return;
        chrome.storage.local.set({
            recordio_prefs: {
                micEnabled: isAudioEnabled,
                camEnabled: isVideoEnabled,
                selectedMicId: selectedAudioId,
                selectedCamId: selectedVideoId,
            }
        });
    }, [isAudioEnabled, isVideoEnabled, selectedAudioId, selectedVideoId, prefsLoaded]);

    // Connect preview stream to video element
    useEffect(() => {
        if (previewVideoRef.current && previewStream) {
            previewVideoRef.current.srcObject = previewStream;
        }
    }, [previewStream]);

    // Cleanup preview stream on unmount
    useEffect(() => {
        return () => {
            previewStream?.getTracks().forEach(t => t.stop());
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Source Selection ---
    const chooseSource = useCallback(async () => {
        setError(null);
        setIsChoosing(true);

        try {
            const currentTab = await chrome.tabs.getCurrent();
            if (!currentTab) throw new Error("Cannot get current tab");

            const sources = ['window', 'screen', 'audio'] as chrome.desktopCapture.DesktopCaptureSourceType[];

            const capturedSourceId = await new Promise<string>((resolve, reject) => {
                chrome.desktopCapture.chooseDesktopMedia(sources, currentTab, (streamId) => {
                    if (streamId) {
                        resolve(streamId);
                    } else {
                        reject(new Error("Cancelled"));
                    }
                });
            });

            console.log("[chooseSource] capturedSourceId:", capturedSourceId, "length:", capturedSourceId.length);

            let displayStream: MediaStream;
            try {
                displayStream = await navigator.mediaDevices.getUserMedia({
                    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: capturedSourceId } },
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: capturedSourceId, maxWidth: 3840, maxHeight: 2160 } }
                } as any);
            } catch (e) {
                console.warn("[chooseSource] audio+video getUserMedia failed:", e instanceof OverconstrainedError ? `constraint=${e.constraint}` : e);
                try {
                    displayStream = await navigator.mediaDevices.getUserMedia({
                        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: capturedSourceId, maxWidth: 3840, maxHeight: 2160 } }
                    } as any);
                } catch (e2) {
                    console.error("[chooseSource] video-only getUserMedia also failed:", e2 instanceof OverconstrainedError ? `constraint=${(e2 as any).constraint}` : e2);
                    throw e2;
                }
            }

            displayStream.getVideoTracks()[0].onended = () => {
                if (!isRecordingRef.current) {
                    clearSource();
                }
            };

            const displaySurface = displayStream.getVideoTracks()[0].getSettings().displaySurface || 'window';

            const sessionId = crypto.randomUUID();
            sessionIdRef.current = sessionId;

            const config: RecordingConfig = {
                hasAudio: isAudioEnabled,
                hasCamera: isVideoEnabled,
                audioDeviceId: selectedAudioId || undefined,
                videoDeviceId: selectedVideoId || undefined,
                displayStream: displayStream,
                tabViewportSize: { width: window.innerWidth, height: window.innerHeight },
                sourceName: displaySurface === 'browser' ? 'Tab' : (displaySurface === 'monitor' ? 'Desktop' : 'Window'),
            };

            const recorder = new VideoRecorder(sessionId, config);
            recorderRef.current = recorder;

            const detection = await recorder.prepare(config);
            setDetectionResult(detection);

            const screenStream = recorder.getPreviewStream();
            setPreviewStream(screenStream);
        } catch (err: any) {
            if (err.message !== 'Cancelled') {
                if (err instanceof OverconstrainedError) {
                    console.error("Error choosing source: OverconstrainedError constraint=", err.constraint, "message=", err.message, err);
                } else {
                    console.error("Error choosing source:", err);
                }
                setError(err.message || 'Failed to choose source');
            }
        } finally {
            setIsChoosing(false);
        }
    }, [isAudioEnabled, isVideoEnabled, selectedAudioId, selectedVideoId]);

    const clearSource = useCallback(() => {
        setDetectionResult(null);
        if (previewStream) {
            previewStream.getTracks().forEach(t => t.stop());
            setPreviewStream(null);
        }
        if (recorderRef.current && !isRecording) {
            recorderRef.current = null;
        }
    }, [previewStream, isRecording]);

    // --- Start Recording ---
    const startRecording = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) return;

        setError(null);

        try {
            let tabTitle = 'Recording';
            if (originalTabIdRef.current) {
                try {
                    const tab = await chrome.tabs.get(originalTabIdRef.current);
                    tabTitle = tab.title || 'Recording';
                } catch { /* tab may be gone */ }
            }

            if (detectionResult?.isControllerWindow) {
                recorder.setRecordingPreferences({
                    applyAutoZoom: true,
                    applySpotlight: true,
                    simplifyToolbar: false,
                });
            }

            if (detectionResult?.isControllerWindow && originalTabIdRef.current) {
                await chrome.tabs.update(originalTabIdRef.current, { active: true }).catch(() => { });
                await new Promise(r => setTimeout(r, 150));
            }

            await recorder.start(tabTitle);
            isRecordingRef.current = true;
            setIsRecording(true);
            setPhase('recording');

            const shouldTrackEvents = detectionResult?.isControllerWindow ?? false;
            const displaySurface = previewStream?.getVideoTracks()[0]?.getSettings()?.displaySurface;
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
                    sessionId: sessionIdRef.current,
                    isCurrentWindow: shouldTrackEvents,
                    hasAudio: isAudioEnabled,
                    hasCamera: isVideoEnabled,
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
                            payload: { startTime: syncTimestamp, sessionId: sessionIdRef.current }
                        }).catch(() => { });
                    }
                }
            }
        } catch (err: any) {
            console.error("Error starting recording:", err);
            setError(err.message || 'Failed to start recording');
        }
    }, [isAudioEnabled, isVideoEnabled, detectionResult]);

    // --- Stop Recording ---
    const stopRecording = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) {
            console.warn('[Controller] stopRecording called but no recorder ref');
            return;
        }

        console.log('[Controller] stopRecording called. recorder state:', recorder.getStatus().state);

        try {
            const result = await recorder.finish(sessionIdRef.current);
            console.log('[Controller] recorder.finish() completed. durationMs:', result.durationMs);
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
            setPhase('setup');
            isRecordingRef.current = false;
            setIsRecording(false);
            return;
        }

        console.log('[Controller] Sending CONTROLLER_STOPPED_RECORDING to background');
        chrome.runtime.sendMessage({
            type: MSG_TYPES.CONTROLLER_STOPPED_RECORDING,
            payload: { sessionId: sessionIdRef.current }
        });
    }, []);

    // Subscribe to storage changes during recording to keep liveRecordingState in sync
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
        chrome.runtime.sendMessage({ type }).catch(() => { });
    }, [liveRecordingState?.isPaused]);

    const handleCancel = useCallback(() => {
        const recorder = recorderRef.current;
        if (recorder) {
            recorder.cancel(sessionIdRef.current).catch(() => { });
            recorderRef.current = null;
        }
        chrome.runtime.sendMessage({ type: MSG_TYPES.POPUP_CANCEL_RECORDING }).catch(() => { });
        window.close();
    }, []);

    // Listen for session control messages from background
    // (STOP_SESSION = finish, plus new pause/resume/cancel from popup)
    useEffect(() => {
        const listener = (message: any) => {
            switch (message.type) {
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
                    // Discard recording and close this tab — background cleans up state via tabs.onRemoved
                    const recorder = recorderRef.current;
                    if (recorder) {
                        recorder.cancel(sessionIdRef.current).catch(() => { });
                        recorderRef.current = null;
                    }
                    window.close();
                    break;
                }
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, [stopRecording]);

    // Listen for Chrome's "Stop Sharing" button
    useEffect(() => {
        const recorder = recorderRef.current;
        if (!recorder || !isRecording) return;

        const stream = recorder.getPreviewStream();
        const videoTrack = stream?.getVideoTracks()[0];
        if (!videoTrack) return;

        const onTrackEnded = () => {
            console.log('[Controller] Display track ended (Stop Sharing). Triggering stopRecording.');
            stopRecording();
        };

        videoTrack.addEventListener('ended', onTrackEnded);
        return () => videoTrack.removeEventListener('ended', onTrackEnded);
    }, [isRecording, stopRecording]);

    // Listen for CONTENT_CAPTURE_USER_EVENT from content scripts
    useEffect(() => {
        const listener = (message: any) => {
            if (message.type === MSG_TYPES.CONTENT_CAPTURE_USER_EVENT && message.payload) {
                recorderRef.current?.addEvent(message.payload);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    // --- Render ---
    const hasSource = !!previewStream;
    const showPostProcessing = detectionResult?.isControllerWindow === true;

    const sharingLabel = (() => {
        if (!previewStream) return '';
        const surface = previewStream.getVideoTracks()[0]?.getSettings()?.displaySurface;
        if (showPostProcessing) return 'Sharing this window';
        if (surface === 'monitor') return 'Sharing desktop';
        return 'Sharing external window';
    })();

    return (
        <div className="min-h-screen bg-surface text-text-highlighted font-sans flex flex-col">
            {isChoosing && phase !== 'recording' && <CalibrationMarkers />}

            {phase === 'recording' ? (
                <main className="max-w-xl mx-auto px-5 py-6">
                    <RecordingPhase
                        hasAudio={isAudioEnabled}
                        hasCamera={isVideoEnabled}
                        recordingState={liveRecordingState}
                        onPauseResume={handlePauseResume}
                        onFinish={stopRecording}
                        onCancel={handleCancel}
                    />
                </main>
            ) : (
                <div className="flex-1 w-full flex flex-col overflow-y-auto">
                    <div className="w-full flex-1 bg-[rgb(234,231,255)] border-b border-border">
                        <main className="w-full max-w-3xl mx-auto p-4 sm:p-6 lg:p-8 pb-20 flex flex-col items-center justify-start">
                            <div className="animate-in fade-in duration-300 w-full">

                                <div className="flex items-center justify-between w-full mb-6">
                                    <div className="flex justify-center">
                                        <img src={logoLight} alt="Recordio" className="logo-for-light h-7" />
                                        <img src={logoDark} alt="Recordio" className="logo-for-dark h-7" />
                                    </div>
                                    <Button variant="ghost" onClick={() => window.open(getEditorOrigin(), '_blank')}>
                                        <GrProjects className="icon-sm" />
                                        Dashboard
                                    </Button>
                                </div>

                                <div className="grid grid-cols-2 gap-4 items-start">
                                    {/* Left column: mic + camera */}
                                    <div className="flex flex-col gap-2">
                                        <MicrophoneCard
                                            activeTab={activeTab}
                                            setActiveTab={setActiveTab}
                                            isEnabled={isAudioEnabled}
                                            selectedDeviceId={selectedAudioId}
                                            onEnabledChange={setIsAudioEnabled}
                                            onDeviceChange={setSelectedAudioId}
                                            onPermissionError={() => setShowPermissionModal(true)}
                                            onDeviceError={setMicDeviceError}
                                        />

                                        <CameraCard
                                            activeTab={activeTab}
                                            setActiveTab={setActiveTab}
                                            isEnabled={isVideoEnabled}
                                            selectedDeviceId={selectedVideoId}
                                            onEnabledChange={setIsVideoEnabled}
                                            onDeviceChange={setSelectedVideoId}
                                            onPermissionError={() => setShowPermissionModal(true)}
                                            onDeviceError={setCameraDeviceError}
                                        />

                                    </div>

                                    {/* Right column: screen + record button */}
                                    <div className="flex flex-col gap-2">
                                        <ScreenShareCard
                                            activeTab={activeTab}
                                            setActiveTab={setActiveTab}
                                            hasSource={hasSource}
                                            sharingLabel={sharingLabel}
                                            isChoosing={isChoosing}
                                            chooseSource={chooseSource}
                                            previewVideoRef={previewVideoRef}
                                        />

                                        {error && (
                                            <p className="text-destructive text-sm animate-in fade-in text-center">{error}</p>
                                        )}

                                        <Tooltip
                                            text={!hasSource ? "Share screen to start recording" : ""}
                                            position="top"
                                            className="w-full flex"
                                        >
                                            <div className="w-full">
                                                <Button
                                                    variant="primary"
                                                    onClick={startRecording}
                                                    disabled={!hasSource || cameraDeviceError || micDeviceError}
                                                    className="w-full text-base py-3"
                                                    style={!hasSource ? { pointerEvents: 'none' } : undefined}
                                                >
                                                    <MdFiberManualRecord size={20} />
                                                    Start Recording
                                                </Button>
                                            </div>
                                        </Tooltip>

                                        {hasSource && showPostProcessing && originalTab && (
                                            <div className="flex items-center justify-center flex-wrap gap-x-1.5 gap-y-1 px-2 text-xs text-text-disabled text-center">
                                                <span>Will switch to </span>
                                                <span
                                                    className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded font-medium max-w-[180px] shadow-sm"
                                                    style={{ backgroundColor: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc' }}
                                                >
                                                    {originalTab.favIconUrl && (
                                                        <img src={originalTab.favIconUrl} className="w-3.5 h-3.5 rounded-sm shrink-0" alt="" />
                                                    )}
                                                    <span className="truncate">{originalTab.title}</span>
                                                </span>
                                                <span>tab on start.</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                            </div>
                        </main>
                    </div>

                </div>
            )}

            <Modal isOpen={showPermissionModal} onClose={() => setShowPermissionModal(false)} maxWidth="max-w-[720px]">
                <div className="flex flex-col gap-4">
                    <h2 className="text-xl font-semibold text-text-main">Permission Denied</h2>
                    <p className="text-sm text-text-muted leading-relaxed">
                        Please make sure Recordio has microphone and camera permissions to use them in your recording.
                    </p>
                    <div className="flex flex-row items-start gap-4 mt-2">
                        <div className="flex flex-col gap-2 w-[55%]">
                            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Step 1</span>
                            <img
                                src={viewPermissionsImage}
                                alt="View Permissions step 1"
                                className="w-full h-auto rounded-lg border border-border shadow-sm object-contain"
                            />
                        </div>
                        <div className="flex flex-col gap-2 w-[45%]">
                            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Step 2</span>
                            <img
                                src={permissionsImage}
                                alt="Permissions step 2"
                                className="w-full h-auto rounded-lg border border-border shadow-sm object-contain"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                        <Button variant="ghost" onClick={() => setShowPermissionModal(false)}>Close</Button>
                        <Button variant="primary" onClick={() => {
                            chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=chrome-extension://${chrome.runtime.id}` });
                            setShowPermissionModal(false);
                        }}>
                            View Permissions
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

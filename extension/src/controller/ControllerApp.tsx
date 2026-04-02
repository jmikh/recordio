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
import { MSG_TYPES, type RecordingConfig, type RecorderMode, STORAGE_KEYS } from '../shared/messageTypes';
import type { WindowDetectionResult } from '../shared/windowDetector';
import { MultiToggle, Toggle, Dropdown, Button } from '@shared/components';
import { BiMicrophone } from 'react-icons/bi';
import { PiWebcamBold } from 'react-icons/pi';
import { MdScreenShare, MdFiberManualRecord, MdPictureInPicture } from 'react-icons/md';
import logoDark from '@shared/assets/fulllogo-dark.png';
import logoLight from '@shared/assets/fulllogo-light.png';
import '@shared/components/LogoLink.css';

type ControllerPhase = 'setup' | 'recording';

export function ControllerApp() {
    // --- Phase ---
    const [phase, setPhase] = useState<ControllerPhase>('setup');

    // --- Source Selection ---
    const [mode, setMode] = useState<RecorderMode>('window');
    const [sourceId, setSourceId] = useState<string | null>(null);

    // --- Preview ---
    const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
    const [detectionResult, setDetectionResult] = useState<WindowDetectionResult | null>(null);
    const previewVideoRef = useRef<HTMLVideoElement>(null);

    // --- Media Devices ---
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
    const [isAudioEnabled, setIsAudioEnabled] = useState(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(false);
    const [selectedAudioId, setSelectedAudioId] = useState('');
    const [selectedVideoId, setSelectedVideoId] = useState('');
    const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
    const [prefsLoaded, setPrefsLoaded] = useState(false);

    // --- Post-Processing Preferences (only for Chrome window recordings) ---
    const [applyAutoZoom, setApplyAutoZoom] = useState(true);
    const [applySpotlight, setApplySpotlight] = useState(true);
    const [simplifyToolbar, setSimplifyToolbar] = useState(false);

    // --- Recording ---
    const recorderRef = useRef<VideoRecorder | null>(null);
    const sessionIdRef = useRef<string>('');
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isChoosing, setIsChoosing] = useState(false);

    // --- PiP ---
    const [pipWindow, setPipWindow] = useState<Window | null>(null);

    // --- Original Tab ---
    const originalTabIdRef = useRef<number | null>(null);

    // Load original tab ID from storage
    useEffect(() => {
        chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE).then((result) => {
            const state = result[STORAGE_KEYS.RECORDING_STATE] as any;
            if (state?.originalTabId) {
                originalTabIdRef.current = state.originalTabId;
            }
        });
    }, []);

    // Load saved preferences from chrome.storage.local
    useEffect(() => {
        chrome.storage.local.get('recordio_prefs').then((result) => {
            const prefs = result.recordio_prefs as any;
            if (prefs) {
                if (prefs.mode) setMode(prefs.mode);
                if (typeof prefs.isAudioEnabled === 'boolean') setIsAudioEnabled(prefs.isAudioEnabled);
                if (typeof prefs.isVideoEnabled === 'boolean') setIsVideoEnabled(prefs.isVideoEnabled);
                if (prefs.selectedAudioId) setSelectedAudioId(prefs.selectedAudioId);
                if (prefs.selectedVideoId) setSelectedVideoId(prefs.selectedVideoId);
                if (typeof prefs.applyAutoZoom === 'boolean') setApplyAutoZoom(prefs.applyAutoZoom);
                if (typeof prefs.applySpotlight === 'boolean') setApplySpotlight(prefs.applySpotlight);
                if (typeof prefs.simplifyToolbar === 'boolean') setSimplifyToolbar(prefs.simplifyToolbar);
            }
            setPrefsLoaded(true);
        });
    }, []);

    // Save preferences when they change
    useEffect(() => {
        if (!prefsLoaded) return; // Don't save defaults before loading
        chrome.storage.local.set({
            recordio_prefs: {
                mode,
                isAudioEnabled,
                isVideoEnabled,
                selectedAudioId,
                selectedVideoId,
                applyAutoZoom,
                applySpotlight,
                simplifyToolbar,
            }
        });
    }, [mode, isAudioEnabled, isVideoEnabled, selectedAudioId, selectedVideoId, applyAutoZoom, applySpotlight, simplifyToolbar, prefsLoaded]);

    // Populate devices on load
    useEffect(() => {
        navigator.mediaDevices.enumerateDevices().then(devices => {
            setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
            setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
        });
    }, []);

    // Auto-start streams after prefs load (toggles restored but streams not yet created)
    useEffect(() => {
        if (!prefsLoaded) return;

        if (isAudioEnabled && !audioStream) {
            navigator.mediaDevices.getUserMedia({
                audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true
            }).then(stream => {
                setAudioStream(stream);
                // Refresh device list now that we have permission
                navigator.mediaDevices.enumerateDevices().then(devices => {
                    setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
                });
            }).catch(() => {
                setIsAudioEnabled(false);
            });
        }

        if (isVideoEnabled && !videoStream) {
            navigator.mediaDevices.getUserMedia({
                video: selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true
            }).then(stream => {
                setVideoStream(stream);
                navigator.mediaDevices.enumerateDevices().then(devices => {
                    setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
                });
            }).catch(() => {
                setIsVideoEnabled(false);
            });
        }
    }, [prefsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // Connect preview stream to video element
    useEffect(() => {
        if (previewVideoRef.current && previewStream) {
            previewVideoRef.current.srcObject = previewStream;
        }
    }, [previewStream]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            previewStream?.getTracks().forEach(t => t.stop());
            audioStream?.getTracks().forEach(t => t.stop());
            videoStream?.getTracks().forEach(t => t.stop());
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Calibration Marker (for window detection) ---
    // Rendered as fixed-position divs in the DOM

    // --- Source Selection ---
    const chooseSource = useCallback(async () => {
        setError(null);
        setIsChoosing(true);

        try {
            // Get this tab for chooseDesktopMedia target
            const currentTab = await chrome.tabs.getCurrent();
            if (!currentTab) throw new Error("Cannot get current tab");

            const sources = mode === 'window'
                ? ['window' as chrome.desktopCapture.DesktopCaptureSourceType]
                : ['screen' as chrome.desktopCapture.DesktopCaptureSourceType];

            const capturedSourceId = await new Promise<string>((resolve, reject) => {
                chrome.desktopCapture.chooseDesktopMedia(sources, currentTab, (streamId) => {
                    if (streamId) {
                        resolve(streamId);
                    } else {
                        reject(new Error("Cancelled"));
                    }
                });
            });

            setSourceId(capturedSourceId);

            // Create session and prepare recorder
            const sessionId = crypto.randomUUID();
            sessionIdRef.current = sessionId;

            const viewportSize = {
                width: window.innerWidth,
                height: window.innerHeight
            };

            const config: RecordingConfig = {
                hasAudio: isAudioEnabled,
                hasCamera: isVideoEnabled,
                audioDeviceId: selectedAudioId || undefined,
                videoDeviceId: selectedVideoId || undefined,
                sourceId: capturedSourceId,
                tabViewportSize: viewportSize,
                sourceName: mode === 'window' ? 'Window' : 'Desktop',
            };

            const recorder = new VideoRecorder(sessionId, config, mode);
            recorderRef.current = recorder;

            // Prepare — this initializes streams and runs window detection
            const detection = await recorder.prepare(config);
            setDetectionResult(detection);

            // Get the screen stream for preview
            const screenStream = recorder.getPreviewStream();
            setPreviewStream(screenStream);
        } catch (err: any) {
            if (err.message !== 'Cancelled') {
                console.error("Error choosing source:", err);
                setError(err.message || 'Failed to choose source');
            }
        } finally {
            setIsChoosing(false);
        }
    }, [mode, isAudioEnabled, isVideoEnabled, selectedAudioId, selectedVideoId]);

    // --- Audio/Video Toggles ---
    const refreshDevices = async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audios = devices.filter(d => d.kind === 'audioinput');
        const videos = devices.filter(d => d.kind === 'videoinput');
        setAudioDevices(audios);
        setVideoDevices(videos);
        if (!selectedAudioId && audios.length > 0) setSelectedAudioId(audios[0].deviceId);
        if (!selectedVideoId && videos.length > 0) setSelectedVideoId(videos[0].deviceId);
    };

    const handleAudioToggle = async (enabled: boolean) => {
        setIsAudioEnabled(enabled);
        if (enabled) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true
                });
                setAudioStream(stream);
                await refreshDevices();
            } catch (err) {
                console.error("Audio permission failed:", err);
                setAudioStream(null);
            }
        } else {
            audioStream?.getTracks().forEach(t => t.stop());
            setAudioStream(null);
        }
    };

    const handleVideoToggle = async (enabled: boolean) => {
        setIsVideoEnabled(enabled);
        if (enabled) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true
                });
                setVideoStream(stream);
                await refreshDevices();
            } catch (err) {
                console.error("Camera permission failed:", err);
                setVideoStream(null);
            }
        } else {
            videoStream?.getTracks().forEach(t => t.stop());
            setVideoStream(null);
        }
    };

    // Switch audio device
    useEffect(() => {
        if (isAudioEnabled && selectedAudioId && audioStream) {
            const switchAudio = async () => {
                audioStream.getTracks().forEach(t => t.stop());
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedAudioId } } });
                    setAudioStream(stream);
                } catch (e) {
                    console.error("Failed to switch audio", e);
                }
            };
            switchAudio();
        }
    }, [selectedAudioId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Switch video device
    useEffect(() => {
        if (isVideoEnabled && selectedVideoId && videoStream) {
            const switchVideo = async () => {
                videoStream.getTracks().forEach(t => t.stop());
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: selectedVideoId } } });
                    setVideoStream(stream);
                } catch (e) {
                    console.error("Failed to switch video", e);
                }
            };
            switchVideo();
        }
    }, [selectedVideoId]); // eslint-disable-line react-hooks/exhaustive-deps


    // --- Start Recording ---
    const startRecording = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) return;

        setError(null);

        try {
            // Get original tab title for source naming
            let tabTitle = 'Recording';
            if (originalTabIdRef.current) {
                try {
                    const tab = await chrome.tabs.get(originalTabIdRef.current);
                    tabTitle = tab.title || 'Recording';
                } catch { /* tab may be gone */ }
            }
            // Set post-processing preferences (will be saved in RawRecording for webapp import)
            if (detectionResult?.isControllerWindow) {
                recorder.setRecordingPreferences({
                    applyAutoZoom,
                    applySpotlight,
                    simplifyToolbar,
                });
            }

            // Start the recorder
            await recorder.start(tabTitle);
            setIsRecording(true);
            setPhase('recording');

            const shouldTrackEvents = detectionResult?.isControllerWindow ?? false;

            // Notify background that recording started
            const syncTimestamp = Date.now();
            chrome.runtime.sendMessage({
                type: MSG_TYPES.CONTROLLER_STARTED_RECORDING,
                payload: {
                    sessionId: sessionIdRef.current,
                    mode,
                    hasAudio: isAudioEnabled,
                    hasCamera: isVideoEnabled,
                    originalTabId: originalTabIdRef.current,
                }
            });

            // Broadcast START_RECORDING_EVENTS to all tabs (if window detection passed)
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

            // Switch to original tab
            if (originalTabIdRef.current) {
                chrome.tabs.update(originalTabIdRef.current, { active: true }).catch(() => { });
            }
        } catch (err: any) {
            console.error("Error starting recording:", err);
            setError(err.message || 'Failed to start recording');
        }
    }, [mode, isAudioEnabled, isVideoEnabled, detectionResult, applyAutoZoom, applySpotlight, simplifyToolbar]);

    // --- Stop Recording ---
    const stopRecording = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) return;

        try {
            // Finish recording (stops MediaRecorder, saves data to IndexedDB)
            await recorder.finish(sessionIdRef.current);
        } catch (e) {
            console.error('[Controller] Error finishing recording:', e);
        }

        // Tell background recording is done — it will open import page, clean up state, close this tab
        chrome.runtime.sendMessage({
            type: MSG_TYPES.CONTROLLER_STOPPED_RECORDING,
            payload: { sessionId: sessionIdRef.current }
        });
    }, []);

    // --- Listen for STOP_SESSION from popup ---
    // The popup sends STOP_SESSION to background, which broadcasts it.
    // We listen for it here so we can stop the recorder without background needing
    // to send chrome.tabs.sendMessage (which causes Chrome to briefly activate this tab).
    useEffect(() => {
        const listener = (message: any) => {
            if (message.type === MSG_TYPES.STOP_SESSION) {
                stopRecording();
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, [stopRecording]);

    // --- Listen for CAPTURE_USER_EVENT from content scripts ---
    useEffect(() => {
        const listener = (message: any) => {
            if (message.type === MSG_TYPES.CAPTURE_USER_EVENT && message.payload) {
                recorderRef.current?.addEvent(message.payload);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    // --- Document PiP ---
    const openPiP = useCallback(async () => {
        if (!videoStream) return;

        try {
            // @ts-ignore — Document PiP API
            const pip = await documentPictureInPicture.requestWindow({
                width: 320,
                height: 240,
            });

            // Copy styles
            const style = pip.document.createElement('style');
            style.textContent = `
                body { margin: 0; background: #000; display: flex; flex-direction: column; height: 100vh; overflow: hidden; font-family: system-ui, sans-serif; }
                video { width: 100%; flex: 1; object-fit: cover; transform: scaleX(-1); }
                .pip-controls { padding: 8px; display: flex; justify-content: center; background: oklch(0.15 0.01 270); }
                .pip-stop-btn { 
                    background: oklch(0.55 0.2 25); color: white; border: none; padding: 6px 16px; 
                    border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; 
                    display: flex; align-items: center; gap: 6px;
                }
                .pip-stop-btn:hover { filter: brightness(1.1); }
                .pip-dot { width: 8px; height: 8px; border-radius: 50%; background: white; animation: pulse 1.5s infinite; }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
            `;
            pip.document.head.appendChild(style);

            const video = pip.document.createElement('video');
            video.srcObject = videoStream;
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            pip.document.body.appendChild(video);

            // Add stop button (shown during recording)
            const controls = pip.document.createElement('div');
            controls.className = 'pip-controls';
            const stopBtn = pip.document.createElement('button');
            stopBtn.className = 'pip-stop-btn';
            stopBtn.innerHTML = '<span class="pip-dot"></span> Stop Recording';
            stopBtn.addEventListener('click', () => {
                stopRecording();
            });
            controls.appendChild(stopBtn);
            pip.document.body.appendChild(controls);

            setPipWindow(pip);

            pip.addEventListener('pagehide', () => {
                setPipWindow(null);
            });
        } catch (err) {
            console.error('Failed to open PiP:', err);
        }
    }, [videoStream, stopRecording]);

    // --- Render ---
    const hasSource = !!previewStream;
    const showPostProcessing = detectionResult?.isControllerWindow === true;

    return (
        <div className="min-h-screen bg-surface text-text-highlighted font-sans">
            {/* Calibration Markers (always present for window detection) */}
            <CalibrationMarkers />

            {phase === 'recording' ? (
                <main className="max-w-xl mx-auto px-5 py-6">
                    <RecordingPhase />
                </main>
            ) : (
                <main className="max-w-xl mx-auto px-5 py-6">
                    <div className="flex flex-col gap-4 animate-in fade-in duration-300">

                        {/* Logo */}
                        <div className="flex justify-center py-1">
                            <img src={logoLight} alt="Recordio" className="logo-for-light h-7" />
                            <img src={logoDark} alt="Recordio" className="logo-for-dark h-7" />
                        </div>

                        {/* Source Selection + Preview */}
                        <div className="relative w-full aspect-video bg-surface-raised rounded-xl overflow-hidden border border-border shadow-card max-h-[340px] flex items-center justify-center">
                            {hasSource ? (
                                <video
                                    ref={previewVideoRef}
                                    autoPlay
                                    muted
                                    playsInline
                                    className="w-full h-full object-contain bg-black"
                                />
                            ) : (
                                <div className="flex flex-col items-center gap-3 text-text-muted">
                                    <MdScreenShare size={32} className="opacity-50" />
                                    <span className="text-sm">No source selected</span>
                                </div>
                            )}
                        </div>

                        {/* Source Controls */}
                        <div className="flex items-center gap-3">
                            <MultiToggle
                                options={[
                                    { value: 'window', label: 'Window' },
                                    { value: 'screen', label: 'Screen' },
                                ]}
                                value={mode}
                                onChange={(m) => setMode(m as RecorderMode)}
                                className="flex-1"
                            />
                            <Button
                                variant={hasSource ? 'ghost' : 'primary'}
                                onClick={chooseSource}
                                disabled={isChoosing}
                                className="text-sm shrink-0"
                            >
                                <MdScreenShare size={16} />
                                {isChoosing ? 'Choosing...' : hasSource ? 'Change Source' : 'Choose Source'}
                            </Button>
                        </div>

                        {/* Media Controls */}
                        <div className="flex flex-col gap-3">
                            {/* Microphone */}
                            <div className="bg-surface-raised rounded-xl p-3 border border-border self-start">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm text-text-main flex items-center gap-2">
                                        <BiMicrophone size={15} />
                                        Microphone
                                    </span>
                                    <Toggle value={isAudioEnabled} onChange={handleAudioToggle} />
                                </div>
                                {isAudioEnabled && (
                                    <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                        <Dropdown
                                            options={audioDevices.map(d => ({
                                                value: d.deviceId,
                                                label: d.label || `Microphone ${d.deviceId.slice(0, 4)}...`,
                                            }))}
                                            value={selectedAudioId}
                                            onChange={setSelectedAudioId}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Camera */}
                            <div className="bg-surface-raised rounded-xl p-3 border border-border self-start">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm text-text-main flex items-center gap-2">
                                        <PiWebcamBold size={15} />
                                        Camera
                                    </span>
                                    <Toggle value={isVideoEnabled} onChange={handleVideoToggle} />
                                </div>
                                {isVideoEnabled && (
                                    <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                        <Dropdown
                                            options={videoDevices.map(d => ({
                                                value: d.deviceId,
                                                label: d.label || `Camera ${d.deviceId.slice(0, 4)}...`,
                                            }))}
                                            value={selectedVideoId}
                                            onChange={setSelectedVideoId}
                                        />
                                        {/* Camera preview */}
                                        <div className="mt-2 relative w-full aspect-[4/3] max-h-[120px] bg-black rounded-lg overflow-hidden border border-border">
                                            <video
                                                ref={(el) => { if (el && videoStream) el.srcObject = videoStream; }}
                                                autoPlay
                                                muted
                                                playsInline
                                                className="w-full h-full object-cover transform -scale-x-100"
                                            />
                                        </div>
                                        {videoStream && (
                                            <Button
                                                variant="ghost"
                                                onClick={openPiP}
                                                disabled={!!pipWindow}
                                                className="mt-1.5 w-full text-xs"
                                            >
                                                <MdPictureInPicture size={14} />
                                                {pipWindow ? 'Self View Active' : 'Enable Self View'}
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {error && (
                            <p className="text-destructive text-sm animate-in fade-in">{error}</p>
                        )}

                        {/* Post-Processing Preferences */}
                        <div className="bg-surface-raised rounded-xl p-3 border border-border">
                            {/* Detection Status */}
                            {hasSource && mode === 'window' && detectionResult?.isControllerWindow ? (
                                <div className="flex items-center gap-2 pb-2.5 mb-2.5 border-b border-border">
                                    <span className="text-success text-xs">✓</span>
                                    <span className="text-xs text-success">
                                        Chrome window detected — cursor and clicks will be tracked
                                    </span>
                                </div>
                            ) : hasSource && mode === 'window' ? (
                                <div className="flex items-center gap-2 pb-2.5 mb-2.5 border-b border-border">
                                    <span className="text-text-muted text-xs">ℹ</span>
                                    <span className="text-xs text-text-muted">
                                        External window — event tracking is not available
                                    </span>
                                </div>
                            ) : hasSource ? (
                                <div className="flex items-center gap-2 pb-2.5 mb-2.5 border-b border-border">
                                    <span className="text-text-muted text-xs">ℹ</span>
                                    <span className="text-xs text-text-muted">
                                        Screen mode — event tracking is not available
                                    </span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 pb-2.5 mb-2.5 border-b border-border">
                                    <span className="text-text-muted text-xs">ℹ</span>
                                    <span className="text-xs text-text-muted">
                                        Choose a source to enable event tracking
                                    </span>
                                </div>
                            )}

                            {/* Toggles */}
                            <div className={`flex flex-col gap-2 ${!showPostProcessing ? 'opacity-40' : ''}`}>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-text-main">Apply Auto Zoom</span>
                                    <Toggle value={applyAutoZoom} onChange={setApplyAutoZoom} disabled={!showPostProcessing} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-text-main">Apply Spotlight</span>
                                    <Toggle value={applySpotlight} onChange={setApplySpotlight} disabled={!showPostProcessing} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-text-main">Simplify Toolbar</span>
                                    <Toggle value={simplifyToolbar} onChange={setSimplifyToolbar} disabled={!showPostProcessing} />
                                </div>
                            </div>
                            <p className="text-xs text-text-disabled mt-2">These settings can be changed in the editor later.</p>
                        </div>

                        {/* Start Recording */}
                        <Button
                            variant="primary"
                            onClick={startRecording}
                            disabled={!hasSource}
                            className="py-3 text-base"
                            fullWidth
                        >
                            <MdFiberManualRecord size={20} />
                            Start Recording
                        </Button>

                        {/* Footer note */}
                        <p className="text-center text-xs text-text-disabled">
                            Chrome requires this tab to remain open during recording
                        </p>
                    </div>
                </main>
            )}
        </div>
    );
}

// --- Sub-Components ---

function CalibrationMarkers() {
    const markerStyle = "fixed w-[50px] h-[50px] z-[9999] flex items-center justify-center";
    const primaryBg = "bg-[oklch(0.58_0.19_290)]";
    const secondaryBg = "bg-[oklch(0.80_0.15_78)]";

    return (
        <>
            <div className={`${markerStyle} ${primaryBg} top-0 left-0`}>
                <div className={`w-5 h-5 ${secondaryBg}`} />
            </div>
            <div className={`${markerStyle} ${primaryBg} top-0 right-0`}>
                <div className={`w-5 h-5 ${secondaryBg}`} />
            </div>
            <div className={`${markerStyle} ${primaryBg} bottom-0 left-0`}>
                <div className={`w-5 h-5 ${secondaryBg}`} />
            </div>
            <div className={`${markerStyle} ${primaryBg} bottom-0 right-0`}>
                <div className={`w-5 h-5 ${secondaryBg}`} />
            </div>
        </>
    );
}


function RecordingPhase() {
    return (
        <div className="flex flex-col items-center gap-6 py-12 animate-in fade-in duration-300">
            <div className="w-4 h-4 bg-destructive rounded-full animate-pulse" />
            <h2 className="text-xl font-semibold">Recording in progress...</h2>
            <p className="text-text-muted text-center max-w-md">
                Click the Recordio extension icon or use the PiP controls to stop recording.
                <br />
                <span className="text-text-disabled text-xs mt-2 block">
                    Keep this tab open — it's needed for the recording.
                </span>
            </p>
        </div>
    );
}

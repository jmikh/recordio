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
import { MSG_TYPES, type RecordingConfig, STORAGE_KEYS } from '../shared/messageTypes';
import type { WindowDetectionResult } from '../shared/windowDetector';
import { MultiToggle, Toggle, Dropdown, Button, InfoTooltip, Tooltip, CollapsibleCard, Notice, Modal } from '@shared/components';
import { AudioVisualizer } from './AudioVisualizer';
import viewPermissionsImage from '../assets/view-permissions.png';
import permissionsImage from '../assets/permissions.png';
import { BiMicrophone, BiMicrophoneOff } from 'react-icons/bi';

import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import { MdFiberManualRecord, MdPictureInPicture } from 'react-icons/md';
import { FiSquare, FiFolder } from 'react-icons/fi';
import { TbScreenShare, TbZoomIn } from 'react-icons/tb';
import { RiLightbulbFlashLine } from 'react-icons/ri';
import { CgToolbarTop, CgScreen } from 'react-icons/cg';
import { IoSettingsOutline } from 'react-icons/io5';
import { getEditorOrigin } from '@shared/types/bridge';
import logoDark from '@shared/assets/fulllogo-dark.png';
import logoLight from '@shared/assets/fulllogo-light.png';
import logoSquare from '@shared/assets/logo.svg';
import iconWithTimer from '../assets/icon-with-timer.png';
import '@shared/components/LogoLink.css';

type ControllerPhase = 'setup' | 'recording';

export function ControllerApp() {
    // --- Phase ---
    const [phase, setPhase] = useState<ControllerPhase>('setup');

    // --- Source Selection ---
    const [sourceId, setSourceId] = useState<string | null>(null);

    // --- Preview ---
    const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
    const [detectionResult, setDetectionResult] = useState<WindowDetectionResult | null>(null);
    const previewVideoRef = useRef<HTMLVideoElement>(null);
    const cameraVideoRef = useRef<HTMLVideoElement>(null);

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
    const [showPermissionModal, setShowPermissionModal] = useState(false);

    // --- Post-Processing Preferences (only for Chrome window recordings) ---
    const [applyAutoZoom, setApplyAutoZoom] = useState(true);
    const [applySpotlight, setApplySpotlight] = useState(true);
    const [simplifyToolbar, setSimplifyToolbar] = useState(false);
    const [isEffectsExpanded, setIsEffectsExpanded] = useState(false);

    // --- Recording ---
    const recorderRef = useRef<VideoRecorder | null>(null);
    const sessionIdRef = useRef<string>('');
    const [isRecording, setIsRecording] = useState(false);
    const isRecordingRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [isChoosing, setIsChoosing] = useState(false);

    // --- PiP and Pinning ---
    const [pipWindow, setPipWindow] = useState<Window | null>(null);
    const [isPinned, setIsPinned] = useState(true); // assume pinned until proven otherwise
    const [isHoveringPin, setIsHoveringPin] = useState(false);

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

    // Check if extension is pinned
    useEffect(() => {
        chrome.action?.getUserSettings?.().then(settings => {
            setIsPinned(settings.isOnToolbar ?? true);
        }).catch(() => { });
    }, []);

    // Load saved preferences from chrome.storage.local
    useEffect(() => {
        chrome.storage.local.get('recordio_prefs').then((result) => {
            const prefs = result.recordio_prefs as any;
            if (prefs) {
                if (typeof prefs.isAudioEnabled === 'boolean') setIsAudioEnabled(prefs.isAudioEnabled);
                if (typeof prefs.isVideoEnabled === 'boolean') setIsVideoEnabled(prefs.isVideoEnabled);
                if (prefs.selectedAudioId) setSelectedAudioId(prefs.selectedAudioId);
                if (prefs.selectedVideoId) setSelectedVideoId(prefs.selectedVideoId);
                if (typeof prefs.applyAutoZoom === 'boolean') setApplyAutoZoom(prefs.applyAutoZoom);
                if (typeof prefs.applySpotlight === 'boolean') setApplySpotlight(prefs.applySpotlight);
                if (typeof prefs.simplifyToolbar === 'boolean') setSimplifyToolbar(prefs.simplifyToolbar);
                if (typeof prefs.isEffectsExpanded === 'boolean') setIsEffectsExpanded(prefs.isEffectsExpanded);
            }
            setPrefsLoaded(true);
        });
    }, []);

    // Save preferences when they change
    useEffect(() => {
        if (!prefsLoaded) return; // Don't save defaults before loading
        chrome.storage.local.set({
            recordio_prefs: {
                isAudioEnabled,
                isVideoEnabled,
                selectedAudioId,
                selectedVideoId,
                applyAutoZoom,
                applySpotlight,
                simplifyToolbar,
                isEffectsExpanded,
            }
        });
    }, [isAudioEnabled, isVideoEnabled, selectedAudioId, selectedVideoId, applyAutoZoom, applySpotlight, simplifyToolbar, isEffectsExpanded, prefsLoaded]);

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
            }).catch((err: any) => {
                if (err.name === 'NotAllowedError') {
                    setIsAudioEnabled(false);
                    setShowPermissionModal(true);
                }
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
            }).catch((err: any) => {
                if (err.name === 'NotAllowedError') {
                    setIsVideoEnabled(false);
                    setShowPermissionModal(true);
                }
            });
        }
    }, [prefsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // Connect preview stream to video element
    useEffect(() => {
        if (previewVideoRef.current && previewStream) {
            previewVideoRef.current.srcObject = previewStream;
        }
    }, [previewStream]);

    // Connect camera stream to video element
    useEffect(() => {
        if (cameraVideoRef.current && videoStream) {
            if (cameraVideoRef.current.srcObject !== videoStream) {
                cameraVideoRef.current.srcObject = videoStream;
            }
        } else if (cameraVideoRef.current && !videoStream) {
            cameraVideoRef.current.srcObject = null;
        }
    }, [videoStream]);

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

            // Fetch display media natively using the streamId
            let displayStream: MediaStream;
            try {
                displayStream = await navigator.mediaDevices.getUserMedia({
                    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: capturedSourceId } },
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: capturedSourceId } }
                } as any);
            } catch (e) {
                // If user didn't check the audio box, asking for audio throws NotAllowedError
                displayStream = await navigator.mediaDevices.getUserMedia({
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: capturedSourceId } }
                } as any);
            }

            // If the user clicks "Stop Sharing" on the native browser banner during setup,
            // clear the source. During recording, the track ended useEffect handles it.
            displayStream.getVideoTracks()[0].onended = () => {
                if (!isRecordingRef.current) {
                    clearSource();
                }
            };

            const displaySurface = displayStream.getVideoTracks()[0].getSettings().displaySurface || 'window';


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
                displayStream: displayStream,
                tabViewportSize: viewportSize,
                sourceName: displaySurface === 'browser' ? 'Tab' : (displaySurface === 'monitor' ? 'Desktop' : 'Window'),
            };

            const recorder = new VideoRecorder(sessionId, config);
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
    }, [isAudioEnabled, isVideoEnabled, selectedAudioId, selectedVideoId]);

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
            } catch (err: any) {
                console.error("Audio permission failed:", err);
                setAudioStream(null);
                if (err.name === 'NotAllowedError') {
                    setIsAudioEnabled(false);
                    setShowPermissionModal(true);
                }
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
            } catch (err: any) {
                console.error("Camera permission failed:", err);
                setVideoStream(null);
                if (err.name === 'NotAllowedError') {
                    setIsVideoEnabled(false);
                    setShowPermissionModal(true);
                }
            }
        } else {
            videoStream?.getTracks().forEach(t => t.stop());
            setVideoStream(null);
        }
    };

    const clearSource = useCallback(() => {
        setSourceId(null);
        setDetectionResult(null);
        if (previewStream) {
            previewStream.getTracks().forEach(t => t.stop());
            setPreviewStream(null);
        }
        // Don't clear recorder ref while recording — Stop Sharing ends the preview
        // stream but we still need the recorder to finish() and save data.
        if (recorderRef.current && !isRecording) {
            recorderRef.current = null;
        }
    }, [previewStream, isRecording]);

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

            // Switch to original tab BEFORE starting recorder so the first frames
            // capture the correct content, not the controller tab.
            // Only do this when recording the current Chrome window — for other sources
            // (different window, screen, tab) the controller tab should stay visible.
            if (detectionResult?.isControllerWindow && originalTabIdRef.current) {
                await chrome.tabs.update(originalTabIdRef.current, { active: true }).catch(() => { });
                // Brief delay to let Chrome finish rendering the target tab
                await new Promise(r => setTimeout(r, 150));
            }

            // Start the recorder
            await recorder.start(tabTitle);
            isRecordingRef.current = true;
            setIsRecording(true);
            setPhase('recording');

            const shouldTrackEvents = detectionResult?.isControllerWindow ?? false;

            // Notify background that recording started
            const syncTimestamp = Date.now();
            chrome.runtime.sendMessage({
                type: MSG_TYPES.CONTROLLER_STARTED_RECORDING,
                payload: {
                    sessionId: sessionIdRef.current,
                    isCurrentWindow: shouldTrackEvents,
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
        } catch (err: any) {
            console.error("Error starting recording:", err);
            setError(err.message || 'Failed to start recording');
        }
    }, [isAudioEnabled, isVideoEnabled, detectionResult, applyAutoZoom, applySpotlight, simplifyToolbar]);

    // --- Stop Recording ---
    const stopRecording = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) {
            console.warn('[Controller] stopRecording called but no recorder ref');
            return;
        }

        console.log('[Controller] stopRecording called. recorder state:', recorder.getStatus().state);

        try {
            // Finish recording (stops MediaRecorder, saves data to IndexedDB)
            const result = await recorder.finish(sessionIdRef.current);
            console.log('[Controller] recorder.finish() completed. durationMs:', result.durationMs);
        } catch (e) {
            console.error('[Controller] Error finishing recording:', e);
        }

        // Tell background recording is done — it will open import page, clean up state, close this tab
        console.log('[Controller] Sending CONTROLLER_STOPPED_RECORDING to background');
        chrome.runtime.sendMessage({
            type: MSG_TYPES.CONTROLLER_STOPPED_RECORDING,
            payload: { sessionId: sessionIdRef.current }
        });
    }, []);

    // --- Listen for STOP_SESSION from background ---
    // When the user clicks the extension icon during recording, background sends STOP_SESSION.
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

    // --- Listen for Chrome's "Stop Sharing" button ---
    // When the user clicks "Stop Sharing", Chrome ends the display capture track.
    // We treat this as a valid stop (same as clicking the extension icon).
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

    // Close PiP automatically if camera is disabled
    useEffect(() => {
        if (!isVideoEnabled && pipWindow) {
            pipWindow.close();
        }
    }, [isVideoEnabled, pipWindow]);

    // --- Render ---
    const hasSource = !!previewStream;
    const showPostProcessing = detectionResult?.isControllerWindow === true;

    // Derive a label for what is being shared
    const sharingLabel = (() => {
        if (!previewStream) return '';
        const surface = previewStream.getVideoTracks()[0]?.getSettings()?.displaySurface;
        if (showPostProcessing) return 'Sharing this window';
        if (surface === 'monitor') return 'Sharing desktop';
        return 'Sharing external window';
    })();

    return (
        <div className="min-h-screen bg-surface text-text-highlighted font-sans flex flex-col">
            {/* Calibration Markers (only during setup for window detection) */}
            {isChoosing && phase !== 'recording' && <CalibrationMarkers />}

            {phase === 'recording' ? (
                <main className="max-w-xl mx-auto px-5 py-6">
                    <RecordingPhase
                        hasAudio={isAudioEnabled}
                        hasCamera={isVideoEnabled}
                        onStop={stopRecording}
                    />
                </main>
            ) : (
                <div className="flex-1 w-full flex flex-col overflow-y-auto">
                    <div className="w-full flex-1 bg-[rgb(234,231,255)] border-b border-border">
                        <main className="w-full max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 pb-20 flex flex-col items-center justify-start">
                            <div className="animate-in fade-in duration-300 w-full">

                                <div className="flex items-center justify-between w-full mb-6">
                                    <div className="flex items-center gap-3">
                                        <img src={logoSquare} alt="Record" className="w-6 h-6" />
                                        <h1 className="text-xl font-semibold text-text-main">Start a new recording</h1>
                                    </div>
                                    <Button variant="ghost" onClick={() => window.open(getEditorOrigin(), '_blank')}>
                                        <FiFolder size={16} />
                                        My Projects
                                    </Button>
                                </div>

                                {/* Three equal boxes: Mic | Camera | Share Screen */}
                                <div className="grid grid-cols-3 gap-4">
                                    {/* ─── Microphone Box ─── */}
                                    <div className="bg-surface-raised rounded-xl border border-border flex flex-col overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                                            <span className="text-sm font-medium text-text-main flex items-center gap-2">
                                                <BiMicrophone size={16} />
                                                Microphone
                                            </span>
                                            <Toggle value={isAudioEnabled} onChange={handleAudioToggle} />
                                        </div>
                                        <div className="flex flex-col items-center justify-center p-4 h-[240px]">
                                            {isAudioEnabled ? (
                                                <div className="flex flex-col items-center gap-3 w-full h-full animate-in fade-in duration-200">
                                                    <div className="flex-1 flex items-center justify-center">
                                                        <AudioVisualizer stream={audioStream} />
                                                    </div>
                                                    <div className="w-full relative z-20 mt-auto">
                                                        <Dropdown
                                                            options={audioDevices.map(d => ({
                                                                value: d.deviceId,
                                                                label: d.label || `Microphone ${d.deviceId.slice(0, 4)}...`,
                                                            }))}
                                                            value={selectedAudioId}
                                                            onChange={setSelectedAudioId}
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center gap-3 text-text-disabled">
                                                    <BiMicrophoneOff size={36} />
                                                    <span className="text-sm">Microphone off</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ─── Camera Box ─── */}
                                    <div className="bg-surface-raised rounded-xl border border-border flex flex-col overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                                            <span className="text-sm font-medium text-text-main flex items-center gap-2">
                                                <PiWebcamBold size={16} />
                                                Camera
                                            </span>
                                            <Toggle value={isVideoEnabled} onChange={handleVideoToggle} />
                                        </div>
                                        <div className="flex flex-col items-center justify-center p-4 h-[240px] overflow-y-auto scrollbar-hide">
                                            {isVideoEnabled ? (
                                                <div className="flex flex-col items-center gap-3 w-full h-full animate-in fade-in duration-200">
                                                    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-border flex justify-center">
                                                        <video
                                                            ref={cameraVideoRef}
                                                            autoPlay
                                                            muted
                                                            playsInline
                                                            className="w-full h-auto block transform -scale-x-100"
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between w-full">
                                                        <div className="flex items-center gap-1.5 text-sm text-text-muted">
                                                            <MdPictureInPicture size={16} />
                                                            <span>Float Camera</span>
                                                            <InfoTooltip
                                                                placement="top-right"
                                                                description="Float the camera in a mini window so you can see yourself while recording. If recording your entire screen, keep it outside the recorded area."
                                                            />
                                                        </div>
                                                        <Toggle value={!!pipWindow} onChange={(v) => v ? openPiP() : pipWindow?.close()} />
                                                    </div>
                                                    <div className="w-full relative z-10 mt-auto">
                                                        <Dropdown
                                                            options={videoDevices.map(d => ({
                                                                value: d.deviceId,
                                                                label: d.label || `Camera ${d.deviceId.slice(0, 4)}...`,
                                                            }))}
                                                            value={selectedVideoId}
                                                            onChange={setSelectedVideoId}
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center gap-3 text-text-disabled">
                                                    <PiWebcamSlashBold size={36} />
                                                    <span className="text-sm">Camera off</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ─── Share Screen Box ─── */}
                                    <div className="bg-surface-raised rounded-xl border border-border flex flex-col overflow-hidden">
                                        <div className="flex items-center px-4 py-3 border-b border-border">
                                            <span className="text-sm font-medium text-text-main flex items-center gap-2">
                                                <CgScreen size={16} />
                                                Share Screen
                                            </span>
                                        </div>
                                        <div className="flex flex-col p-4 h-[240px]">
                                            {hasSource ? (
                                                <div className="flex-1 flex flex-col items-center w-full min-h-0 animate-in fade-in duration-200">
                                                    <div className="flex-1 w-full bg-black rounded-lg overflow-hidden border border-border flex items-center justify-center min-h-0">
                                                        <video
                                                            ref={previewVideoRef}
                                                            autoPlay
                                                            muted
                                                            playsInline
                                                            className="w-full h-full object-contain bg-black"
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col flex-1 items-center justify-center pb-2 w-full min-h-0">
                                                    <button
                                                        className="relative flex items-center justify-center shrink-0 cursor-pointer hover:scale-105 transition-transform duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
                                                        style={{ width: 80, height: 80 }}
                                                        onClick={chooseSource}
                                                        disabled={isChoosing}
                                                        aria-label="Share screen"
                                                    >
                                                        {/* Emitting ripple rings */}
                                                        <div className="absolute inset-0 rounded-full border border-primary/40" style={{ opacity: 0, animation: 'ripple-out 2.4s ease-out infinite', animationFillMode: 'backwards' }} />
                                                        <div className="absolute inset-0 rounded-full border border-primary/40" style={{ opacity: 0, animation: 'ripple-out 2.4s ease-out infinite', animationDelay: '0.8s', animationFillMode: 'backwards' }} />
                                                        <div className="absolute inset-0 rounded-full border border-primary/40" style={{ opacity: 0, animation: 'ripple-out 2.4s ease-out infinite', animationDelay: '1.6s', animationFillMode: 'backwards' }} />
                                                        {/* Fixed center icon */}
                                                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/25 z-10">
                                                            <CgScreen size={24} className="text-primary text-opacity-80" />
                                                        </div>
                                                    </button>
                                                </div>
                                            )}

                                            <div className="w-full relative z-20 mt-auto pt-3 shrink-0">
                                                <Button
                                                    onClick={chooseSource}
                                                    disabled={isChoosing}
                                                    className="w-full shadow-sm"
                                                >
                                                    {isChoosing ? 'Waiting...' : hasSource ? 'Change screen' : 'Share screen'}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {error && (
                                    <p className="text-destructive text-sm animate-in fade-in text-center">{error}</p>
                                )}

                                {/* ─── Bottom Bar: Recording + Settings + Info ─── */}
                                <div className="flex flex-col gap-4 mt-2 mx-auto w-1/2">
                                    <CollapsibleCard
                                        title="Effects Settings"
                                        icon={<IoSettingsOutline size={18} />}
                                        isExpanded={isEffectsExpanded}
                                        onExpandChange={setIsEffectsExpanded}
                                        className="w-full shadow-sm bg-surface-raised"
                                        previewItems={
                                            hasSource && !showPostProcessing
                                                ? [{ type: 'custom', content: <span className="text-xs font-medium text-text-disabled">Unavailable</span> }]
                                                : [
                                                    { type: 'custom', content: <div className={`flex items-center gap-1 ${applyAutoZoom ? "text-text-main" : "text-text-disabled"}`}><TbZoomIn size={14} /><span className="text-xs font-medium">{applyAutoZoom ? "On" : "Off"}</span></div> },
                                                    { type: 'custom', content: <div className={`flex items-center gap-1 ${applySpotlight ? "text-text-main" : "text-text-disabled"}`}><RiLightbulbFlashLine size={14} /><span className="text-xs font-medium">{applySpotlight ? "On" : "Off"}</span></div> },
                                                    { type: 'custom', content: <div className={`flex items-center gap-1 ${simplifyToolbar ? "text-text-main" : "text-text-disabled"}`}><CgToolbarTop size={14} /><span className="text-xs font-medium">{simplifyToolbar ? "On" : "Off"}</span></div> },
                                                ] as any
                                        }
                                    >
                                        <div className="flex flex-col gap-2 pt-2">
                                            {hasSource && !showPostProcessing && (
                                                <Notice>
                                                    Detected you're sharing {previewStream?.getVideoTracks()[0]?.getSettings()?.displaySurface === 'monitor' ? 'your desktop' : 'an external window'}. Auto effects only work when recording this window.
                                                </Notice>
                                            )}
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-text-muted">
                                                    <span className="text-sm">Auto Zoom</span>
                                                    <InfoTooltip
                                                        placement="top-right"
                                                        description="Recordio doesn't just follow the cursor. It understands the layout of all elements you are interacting with, producing meaningful zooms."
                                                        videoSrc="https://cdn.recordio.cc/demos/zoom.webm"
                                                    />
                                                </div>
                                                <Toggle value={applyAutoZoom} onChange={setApplyAutoZoom} />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-text-muted">
                                                    <span className="text-sm">Auto Spotlight</span>
                                                    <InfoTooltip
                                                        placement="top-right"
                                                        description={"Shine the spotlight on what matters by enlarging it and dimming the rest.\nLooks best on cards, popovers and clearly defined areas."}
                                                        videoSrc="https://cdn.recordio.cc/demos/spotlight.webm"
                                                    />
                                                </div>
                                                <Toggle value={applySpotlight} onChange={setApplySpotlight} />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-text-muted">
                                                    <span className="text-sm">Simplify Toolbar</span>
                                                    <InfoTooltip
                                                        placement="top-right"
                                                        description="Replace messy browser toolbars with a clean, unified macOS-style window header in your final video."
                                                        videoSrc="https://cdn.recordio.cc/demos/toolbar.webm"
                                                    />
                                                </div>
                                                <Toggle value={simplifyToolbar} onChange={setSimplifyToolbar} />
                                            </div>
                                        </div>
                                        <p className="text-xs text-text-disabled mt-3">These settings can be changed in the editor later.</p>
                                    </CollapsibleCard>

                                    <div className="flex flex-col gap-2">
                                        {/* Start Recording */}
                                        <Tooltip
                                            text={!hasSource ? "Share screen to start recording" : ""}
                                            position="top"
                                            className="w-full flex"
                                        >
                                            <div className="w-full">
                                                <Button
                                                    variant="primary"
                                                    onClick={startRecording}
                                                    disabled={!hasSource}
                                                    className="w-full text-base py-3"
                                                    style={!hasSource ? { pointerEvents: 'none' } : undefined}
                                                >
                                                    <MdFiberManualRecord size={20} />
                                                    Start Recording
                                                </Button>
                                            </div>
                                        </Tooltip>

                                        {/* Selected Target Tab Return Notice */}
                                        {hasSource && showPostProcessing && originalTab && (
                                            <div className="flex items-center justify-center flex-wrap gap-x-1.5 gap-y-1 mt-2 px-2 text-xs text-text-disabled text-center">
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

                                        {/* Extension icon timer hint */}
                                        <div className="flex items-center gap-3 mt-3 px-3 py-3 rounded-lg bg-surface-raised border border-border">
                                            <img src={iconWithTimer} alt="Extension icon with timer" className="w-[72px] h-auto shrink-0" />
                                            <p className="text-xs text-text-muted leading-relaxed relative">
                                                While recording, the extension icon shows elapsed time. Click on it to finish recording.
                                                {!isPinned && (
                                                    <>
                                                        {' '}Make sure to{' '}
                                                        <span
                                                            className="underline decoration-text-muted/50 underline-offset-2 cursor-pointer text-text-highlighted focus:outline-none"
                                                            onMouseEnter={() => setIsHoveringPin(true)}
                                                            onMouseLeave={() => setIsHoveringPin(false)}
                                                        >
                                                            Pin it
                                                        </span>.

                                                        {isHoveringPin && (
                                                            <span className="absolute bottom-full right-0 mb-2 p-1.5 bg-surface border border-border shadow-float rounded-xl z-50 animate-in fade-in zoom-in-95 duration-150 pointer-events-none">
                                                                <img src="/assets/welcome/pin.png" alt="Pin instructions" className="w-[280px] h-auto rounded-lg outline outline-1 outline-black/5 block" />
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </main>
                    </div>

                    {/* --- Footer --- */}
                    <div className="w-full bg-surface shrink-0">
                        <footer className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                            <div className="flex flex-col md:flex-row items-center justify-between pb-8">
                                <div className="flex flex-col items-center md:items-start mb-6 md:mb-0">
                                    <a href="https://recordio.cc" target="_blank" rel="noopener noreferrer" className="inline-block mb-3 transition-opacity hover:opacity-80">
                                        <img src={logoLight} alt="Recordio" className="logo-for-light h-[22px]" />
                                        <img src={logoDark} alt="Recordio" className="logo-for-dark h-[22px]" />
                                    </a>
                                    <p className="text-text-muted text-[13px]">Beautiful screen recordings in seconds</p>
                                </div>
                            </div>

                            <div className="pt-6 border-t border-border flex flex-col md:flex-row items-center justify-between text-xs text-text-disabled">
                                <p>© 2026 Recordio. All rights reserved.</p>
                                <div className="flex items-center gap-4 lg:gap-6 mt-4 md:mt-0 font-medium tracking-wide">
                                    <a href="https://recordio.cc/privacy/" target="_blank" rel="noopener noreferrer" className="hover:text-text-main transition-colors focus:outline-none">Privacy Policy</a>
                                    <a href="https://recordio.cc/terms/" target="_blank" rel="noopener noreferrer" className="hover:text-text-main transition-colors focus:outline-none">Terms of Service</a>
                                    <a href="mailto:support@recordio.cc" target="_blank" rel="noopener noreferrer" className="hover:text-text-main transition-colors focus:outline-none">Contact</a>
                                </div>
                            </div>
                        </footer>
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


function RecordingPhase({ hasAudio, hasCamera, onStop }: {
    hasAudio: boolean;
    hasCamera: boolean;
    onStop: () => void;
}) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const start = Date.now();
        const id = setInterval(() => setElapsed(Date.now() - start), 1000);
        return () => clearInterval(id);
    }, []);

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex flex-col items-center gap-6 py-10 animate-in fade-in duration-300">
            {/* Logo */}
            <div className="flex justify-center">
                <img src={logoLight} alt="Recordio" className="logo-for-light h-8" />
                <img src={logoDark} alt="Recordio" className="logo-for-dark h-8" />
            </div>

            {/* Card */}
            <div className="flex flex-col items-center gap-6 bg-surface-raised border border-border rounded-xl px-10 py-8 shadow-card">
                {/* Timer + Recording Indicator */}
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 bg-destructive rounded-full animate-pulse" />
                    <span className="text-3xl font-semibold tabular-nums tracking-wide">
                        {formatTime(elapsed)}
                    </span>
                </div>

                {/* Status Icons */}
                <div className="flex items-center gap-4">
                    <Tooltip text={hasAudio ? 'Microphone on' : 'Microphone off'} position="bottom-start">
                        <div className={`p-2 rounded-lg ${hasAudio ? 'text-text-main bg-surface' : 'text-text-disabled'}`}>
                            {hasAudio ? <BiMicrophone size={20} /> : <BiMicrophoneOff size={20} />}
                        </div>
                    </Tooltip>
                    <Tooltip text={hasCamera ? 'Camera on' : 'Camera off'} position="bottom-start">
                        <div className={`p-2 rounded-lg ${hasCamera ? 'text-text-main bg-surface' : 'text-text-disabled'}`}>
                            {hasCamera ? <PiWebcamBold size={20} /> : <PiWebcamSlashBold size={20} />}
                        </div>
                    </Tooltip>
                </div>

                {/* Stop Button */}
                <Button variant="destructive" onClick={onStop} className="px-8 py-2.5 text-base">
                    <FiSquare size={16} />
                    Stop Recording
                </Button>
            </div>

            {/* Info */}
            <p className="text-text-disabled text-xs text-center max-w-xs">
                Must keep this tab open while recording.
            </p>
        </div>
    );
}

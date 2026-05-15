/**
 * @fileoverview Pre-Recording View
 *
 * Shown when no recording is active. Lets the user configure mic + camera
 * (with live previews), then start a tab recording or open the controller
 * for window/desktop recording.
 *
 * Preview streams are opened when a device is toggled on and always stopped
 * before handing off to recording. Three cleanup paths guarantee no leaks:
 *   1. Toggle-off handler calls track.stop()
 *   2. useEffect cleanup (component unmount / popup closed)
 *   3. Explicit stopAllPreviews() before any outbound message
 *
 * A fourth guard (unmountedRef) stops any stream that resolves from a
 * getUserMedia call that was in-flight when the popup closed.
 */

import { useState, useEffect, useRef } from 'react';
import { Button, Toggle, Dropdown } from '@shared/components';
import { BiMicrophone, BiMicrophoneOff } from 'react-icons/bi';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import { MdComputer, MdOpenInNew } from 'react-icons/md';
import { MSG_TYPES } from '../shared/messageTypes';
import { useAudioLevel } from '../shared/useAudioLevel';
import permissionsImage from '../assets/permissions-small.png';

const PREFS_KEY = 'recordio_prefs';

// --- Audio level meter ---

function AudioLevelBar({ level }: { level: number }) {
    return (
        <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-border">
            <div
                className="h-full rounded-full"
                style={{
                    width: `${level * 100}%`,
                    background: 'linear-gradient(to right, var(--primary), var(--secondary))',
                    transition: 'width 75ms linear',
                }}
            />
        </div>
    );
}

// --- Main Component ---

export function PreRecordingView() {
    // Mic state
    const [micEnabled, setMicEnabled] = useState(false);
    const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedMicId, setSelectedMicId] = useState('');
    const [micStream, setMicStream] = useState<MediaStream | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);

    // Camera state
    const [camEnabled, setCamEnabled] = useState(false);
    const [camDevices, setCamDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedCamId, setSelectedCamId] = useState('');
    const [camStream, setCamStream] = useState<MediaStream | null>(null);
    const camStreamRef = useRef<MediaStream | null>(null);
    const camVideoRef = useRef<HTMLVideoElement>(null);

    const audioLevel = useAudioLevel(micStream);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [permissionError, setPermissionError] = useState<string | null>(null);
    const [canRecordTab, setCanRecordTab] = useState(true);

    // Guards getUserMedia calls that resolve after unmount/stopAllPreviews
    const unmountedRef = useRef(false);
    // Prevents saving prefs before they've been loaded
    const prefsLoadedRef = useRef(false);

    // --- Prefs: load on mount ---
    useEffect(() => {
        chrome.storage.local.get(PREFS_KEY).then((result) => {
            const prefs = result[PREFS_KEY] as any;
            prefsLoadedRef.current = true;
            if (!prefs) return;
            if (prefs.selectedMicId) setSelectedMicId(prefs.selectedMicId);
            if (prefs.selectedCamId) setSelectedCamId(prefs.selectedCamId);
            if (prefs.micEnabled) {
                setMicEnabled(true);
                openMicStream(prefs.selectedMicId || undefined);
            }
            if (prefs.camEnabled) {
                setCamEnabled(true);
                openCamStream(prefs.selectedCamId || undefined);
            }
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Prefs: save on change (after initial load) ---
    useEffect(() => {
        if (!prefsLoadedRef.current) return;
        chrome.storage.local.set({
            [PREFS_KEY]: { micEnabled, camEnabled, selectedMicId, selectedCamId },
        });
    }, [micEnabled, camEnabled, selectedMicId, selectedCamId]);

    // --- canRecordTab: URL check (cheaper than a scripting round-trip) ---
    useEffect(() => {
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
            const url = tab?.url ?? '';
            const injectable =
                url.startsWith('http://') ||
                url.startsWith('https://') ||
                url.startsWith('file://');
            setCanRecordTab(!!tab?.id && injectable);
        });
    }, []);

    // Attach camera stream to video element
    useEffect(() => {
        if (camVideoRef.current && camStream) {
            camVideoRef.current.srcObject = camStream;
        }
    }, [camStream]);

    // Stop a stream and clear refs/state
    const stopMicStream = () => {
        micStreamRef.current?.getTracks().forEach(t => t.stop());
        micStreamRef.current = null;
        setMicStream(null);
    };
    const stopCamStream = () => {
        camStreamRef.current?.getTracks().forEach(t => t.stop());
        camStreamRef.current = null;
        setCamStream(null);
    };
    const stopAllPreviews = () => {
        stopMicStream();
        stopCamStream();
    };

    // Cleanup on unmount / popup close
    useEffect(() => {
        const onUnload = () => stopAllPreviews();
        window.addEventListener('beforeunload', onUnload);
        return () => {
            unmountedRef.current = true;
            window.removeEventListener('beforeunload', onUnload);
            stopAllPreviews();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Mic ---

    const openMicStream = async (deviceId?: string) => {
        stopMicStream();
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                audio: deviceId ? { deviceId: { exact: deviceId } } : true,
            });
            // Guard: popup may have closed while getUserMedia was in flight
            if (unmountedRef.current) { s.getTracks().forEach(t => t.stop()); return; }
            micStreamRef.current = s;
            setMicStream(s);
            setPermissionError(null);
            // Enumerate to get labels (requires permission)
            const devs = await navigator.mediaDevices.enumerateDevices();
            const audioDevs = devs.filter(d => d.kind === 'audioinput');
            setMicDevices(audioDevs);
            if (!deviceId && audioDevs.length > 0) setSelectedMicId(audioDevs[0].deviceId);
        } catch (e: any) {
            console.warn('[Popup] Mic stream failed:', e.name, e.message);
            // Saved device may no longer be available — retry with the system default
            if (deviceId && e.name === 'OverconstrainedError') {
                setSelectedMicId('');
                return openMicStream(undefined);
            }
            setMicEnabled(false);
            if (e.name === 'NotAllowedError') setPermissionError('Microphone access denied. Make sure it\'s set to "Allow".');
        }
    };

    const handleMicToggle = async (enabled: boolean) => {
        setMicEnabled(enabled);
        if (enabled) {
            await openMicStream(selectedMicId || undefined);
        } else {
            stopMicStream();
        }
    };

    const handleMicDeviceChange = async (deviceId: string) => {
        setSelectedMicId(deviceId);
        if (micEnabled) await openMicStream(deviceId);
    };

    // --- Camera ---

    const openCamStream = async (deviceId?: string) => {
        stopCamStream();
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                video: deviceId ? { deviceId: { exact: deviceId } } : true,
            });
            // Guard: popup may have closed while getUserMedia was in flight
            if (unmountedRef.current) { s.getTracks().forEach(t => t.stop()); return; }
            camStreamRef.current = s;
            setCamStream(s);
            setPermissionError(null);
            const devs = await navigator.mediaDevices.enumerateDevices();
            const videoDevs = devs.filter(d => d.kind === 'videoinput');
            setCamDevices(videoDevs);
            if (!deviceId && videoDevs.length > 0) setSelectedCamId(videoDevs[0].deviceId);
        } catch (e: any) {
            console.warn('[Popup] Camera stream failed:', e.name, e.message);
            // Saved device may no longer be available — retry with the system default
            if (deviceId && e.name === 'OverconstrainedError') {
                setSelectedCamId('');
                return openCamStream(undefined);
            }
            setCamEnabled(false);
            if (e.name === 'NotAllowedError') setPermissionError('Camera access denied. Make sure it\'s set to "Allow".');
        }
    };

    const handleCamToggle = async (enabled: boolean) => {
        setCamEnabled(enabled);
        if (enabled) {
            await openCamStream(selectedCamId || undefined);
        } else {
            stopCamStream();
        }
    };

    const handleCamDeviceChange = async (deviceId: string) => {
        setSelectedCamId(deviceId);
        if (camEnabled) await openCamStream(deviceId);
    };

    // --- Start recording ---

    const handleStartRecording = async () => {
        setError(null);
        setStarting(true);
        stopAllPreviews();
        try {
            const resp = await chrome.runtime.sendMessage({
                type: MSG_TYPES.POPUP_START_TAB_RECORDING,
                payload: {
                    hasAudio: micEnabled,
                    audioDeviceId: selectedMicId || undefined,
                    hasVideo: camEnabled,
                    videoDeviceId: selectedCamId || undefined,
                },
            });
            if (!resp?.success) {
                setError(resp?.error || 'Failed to start recording');
                setStarting(false);
            } else {
                // Countdown is now showing in the tab — close the popup
                window.close();
            }
        } catch (e: any) {
            setError(e?.message || 'Unexpected error');
            setStarting(false);
        }
    };

    const handleOpenPermissionSettings = () => {
        const scheme = navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome';
        chrome.tabs.create({
            url: `${scheme}://settings/content/siteDetails?site=chrome-extension://${chrome.runtime.id}`
        });
    };

    const handleOpenController = async () => {
        stopAllPreviews();
        await chrome.runtime.sendMessage({ type: MSG_TYPES.POPUP_OPEN_CONTROLLER });
        window.close();
    };

    return (
        <div className="flex flex-col gap-3 p-4">
            {/* Mic Row */}
            <div className={`rounded-[var(--radius-md)] border overflow-hidden transition-colors ${micEnabled ? 'border-primary/30 bg-surface' : 'border-border bg-surface'}`}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className={`${micEnabled ? 'text-primary' : 'text-text-muted'}`}>
                        {micEnabled ? <BiMicrophone className="icon-md" /> : <BiMicrophoneOff className="icon-md" />}
                    </span>
                    {!micEnabled && <span className="text-sm font-medium text-text-main w-20 shrink-0">Microphone</span>}
                    {micEnabled ? <AudioLevelBar level={audioLevel} /> : <div className="flex-1" />}
                    <Toggle value={micEnabled} onChange={handleMicToggle} />
                </div>
                {micEnabled && micDevices.length > 0 && (
                    <div className="px-3 pb-3 pt-0">
                        <Dropdown
                            options={micDevices.map(d => ({
                                value: d.deviceId,
                                label: d.label || `Microphone ${d.deviceId.slice(0, 4)}…`,
                            }))}
                            value={selectedMicId}
                            onChange={handleMicDeviceChange}
                        />
                    </div>
                )}
            </div>

            {/* Camera Row */}
            <div className={`rounded-[var(--radius-md)] border overflow-hidden transition-colors ${camEnabled ? 'border-primary/30 bg-surface' : 'border-border bg-surface'}`}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className={`${camEnabled ? 'text-primary' : 'text-text-muted'}`}>
                        {camEnabled ? <PiWebcamBold className="icon-md" /> : <PiWebcamSlashBold className="icon-md" />}
                    </span>
                    <span className="text-sm font-medium text-text-main w-20 shrink-0">Camera</span>
                    <div className="flex-1" />
                    <Toggle value={camEnabled} onChange={handleCamToggle} />
                </div>
                {camEnabled && (
                    <div className="px-3 pb-3 flex flex-col gap-2">
                        {/* Live preview */}
                        <div className="rounded-[var(--radius-sm)] overflow-hidden bg-black aspect-video w-full">
                            <video
                                ref={camVideoRef}
                                autoPlay
                                muted
                                playsInline
                                className="w-full h-full object-cover"
                            />
                        </div>
                        {camDevices.length > 0 && (
                            <Dropdown
                                options={camDevices.map(d => ({
                                    value: d.deviceId,
                                    label: d.label || `Camera ${d.deviceId.slice(0, 4)}…`,
                                }))}
                                value={selectedCamId}
                                onChange={handleCamDeviceChange}
                            />
                        )}
                    </div>
                )}
            </div>

            {/* Screen row — tab-only, no picker needed */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border border-border bg-surface">
                <MdComputer className="icon-md text-text-muted" />
                <span className="text-sm font-medium text-text-main">Screen</span>
                <div className="flex-1" />
                <span className="text-xs text-text-muted">Current tab</span>
            </div>

            {permissionError && (
                <div className="flex flex-col gap-2 px-1">
                    <p className="text-xs text-destructive">
                        {permissionError}{' '}
                        <span
                            className="underline cursor-pointer"
                            onClick={handleOpenPermissionSettings}
                        >
                            Open permission settings
                        </span>
                    </p>
                    <img
                        src={permissionsImage}
                        alt="Allow permissions"
                        className="w-full h-auto rounded-md border border-border shadow-sm"
                    />
                </div>
            )}
            {error && (
                <p className="text-xs text-destructive px-1">{error}</p>
            )}

            {!canRecordTab && (
                <p className="text-xs text-text-muted px-1 text-center">
                    Switch to a regular tab to start recording.
                </p>
            )}

            {/* Actions */}
            <Button
                variant="primary"
                onClick={handleStartRecording}
                disabled={starting || !canRecordTab}
                className="w-full justify-center"
            >
                {starting ? 'Starting…' : 'Start Recording'}
            </Button>

            <Button
                variant="ghost"
                onClick={handleOpenController}
                className="w-full justify-center text-text-muted"
            >
                <MdOpenInNew className="icon-sm" />
                Record Window or Desktop
            </Button>
        </div>
    );
}

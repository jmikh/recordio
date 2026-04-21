import { useState, useEffect, useRef, useCallback } from 'react';
import { Toggle, Dropdown, InfoTooltip } from '@shared/components';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import { MdPictureInPicture } from 'react-icons/md';
import type { ControllerTab } from './ControllerApp';

export function CameraCard({
    activeTab, setActiveTab,
    isEnabled, selectedDeviceId,
    onEnabledChange, onDeviceChange, onPermissionError,
    stopRecording,
}: {
    activeTab: ControllerTab;
    setActiveTab: (tab: ControllerTab) => void;
    isEnabled: boolean;
    selectedDeviceId: string;
    onEnabledChange: (enabled: boolean) => void;
    onDeviceChange: (deviceId: string) => void;
    onPermissionError: () => void;
    stopRecording: () => void;
}) {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [pipWindow, setPipWindow] = useState<Window | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const cameraVideoRef = useRef<HTMLVideoElement>(null);

    // Enumerate devices on mount
    useEffect(() => {
        navigator.mediaDevices.enumerateDevices().then(devs => {
            setDevices(devs.filter(d => d.kind === 'videoinput'));
        });
    }, []);

    const refreshDevices = async () => {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const videoDevs = devs.filter(d => d.kind === 'videoinput');
        setDevices(videoDevs);
        if (!selectedDeviceId && videoDevs.length > 0) onDeviceChange(videoDevs[0].deviceId);
    };

    const handleToggle = async (enabled: boolean) => {
        onEnabledChange(enabled);
        if (enabled) {
            try {
                const s = await navigator.mediaDevices.getUserMedia({
                    video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
                });
                streamRef.current = s;
                setStream(s);
                await refreshDevices();
            } catch (err: any) {
                console.error("Camera permission failed:", err);
                streamRef.current = null;
                setStream(null);
                if (err.name === 'NotAllowedError') {
                    onEnabledChange(false);
                    onPermissionError();
                }
            }
        } else {
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            setStream(null);
        }
    };

    // Auto-start stream when enabled via prefs restore
    const initializedRef = useRef(false);
    useEffect(() => {
        if (isEnabled && !streamRef.current && !initializedRef.current) {
            initializedRef.current = true;
            navigator.mediaDevices.getUserMedia({
                video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
            }).then(s => {
                streamRef.current = s;
                setStream(s);
                navigator.mediaDevices.enumerateDevices().then(devs => {
                    setDevices(devs.filter(d => d.kind === 'videoinput'));
                });
            }).catch((err: any) => {
                if (err.name === 'NotAllowedError') {
                    onEnabledChange(false);
                    onPermissionError();
                }
            });
        }
    }, [isEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

    // Switch device
    useEffect(() => {
        if (isEnabled && selectedDeviceId && streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: selectedDeviceId } } })
                .then(s => { streamRef.current = s; setStream(s); })
                .catch(e => console.error("Failed to switch video", e));
        }
    }, [selectedDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Connect camera stream to video element
    useEffect(() => {
        if (cameraVideoRef.current && stream) {
            if (cameraVideoRef.current.srcObject !== stream) {
                cameraVideoRef.current.srcObject = stream;
            }
        } else if (cameraVideoRef.current && !stream) {
            cameraVideoRef.current.srcObject = null;
        }
    }, [stream]);

    // Close PiP when camera is disabled
    useEffect(() => {
        if (!isEnabled && pipWindow) {
            pipWindow.close();
        }
    }, [isEnabled, pipWindow]);

    // Document PiP
    const openPiP = useCallback(async () => {
        if (!stream) return;

        try {
            // @ts-ignore — Document PiP API
            const pip = await documentPictureInPicture.requestWindow({
                width: 320,
                height: 240,
            });

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
            video.srcObject = stream;
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            pip.document.body.appendChild(video);

            const controls = pip.document.createElement('div');
            controls.className = 'pip-controls';
            const stopBtn = pip.document.createElement('button');
            stopBtn.className = 'pip-stop-btn';
            stopBtn.innerHTML = '<span class="pip-dot"></span> Stop Recording';
            stopBtn.addEventListener('click', () => stopRecording());
            controls.appendChild(stopBtn);
            pip.document.body.appendChild(controls);

            setPipWindow(pip);
            pip.addEventListener('pagehide', () => setPipWindow(null));
        } catch (err) {
            console.error('Failed to open PiP:', err);
        }
    }, [stream, stopRecording]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            streamRef.current?.getTracks().forEach(t => t.stop());
        };
    }, []);

    const isExpanded = activeTab === 'camera' && isEnabled;

    return (
        <div className={`bg-surface-raised rounded-xl border overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'border-primary/30 shadow-sm' : 'border-border'}`}>
            <button
                className="flex items-center justify-between w-full px-4 py-3 cursor-pointer hover:bg-surface/50 transition-colors"
                onClick={() => {
                    if (!isEnabled) {
                        handleToggle(true);
                        setActiveTab('camera');
                    } else {
                        setActiveTab(activeTab === 'camera' ? 'screen' : 'camera');
                    }
                }}
            >
                <span className={`text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'camera' ? 'text-primary' : 'text-text-main'} w-[130px] justify-start`}>
                    {isEnabled ? <PiWebcamBold size={16} /> : <PiWebcamSlashBold size={16} />}
                    Camera
                </span>
                {activeTab !== 'camera' && isEnabled && (() => {
                    const device = devices.find(d => d.deviceId === selectedDeviceId);
                    const name = device?.label?.replace(/\s*\(.*?\)\s*/g, '').trim();
                    return name ? (
                        <span className="text-xs font-normal text-text-muted truncate max-w-[120px]">{name}</span>
                    ) : null;
                })()}
                <div onClick={e => e.stopPropagation()}>
                    <Toggle value={isEnabled} onChange={(enabled) => {
                        handleToggle(enabled);
                        if (enabled) setActiveTab('camera');
                    }} />
                </div>
            </button>
            <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{ maxHeight: isExpanded ? '440px' : '0px', opacity: isExpanded ? 1 : 0 }}
            >
                <div className="px-4 pb-4 border-t border-border">
                    <div className="flex flex-col items-center justify-center h-[320px] pt-3 overflow-y-auto scrollbar-hide">
                        {isEnabled ? (
                            <div className="flex flex-col items-center gap-3 w-full h-full animate-in fade-in duration-200">
                                <div className="relative w-full aspect-video bg-surface rounded-lg overflow-hidden border border-border flex justify-center">
                                    <video
                                        ref={cameraVideoRef}
                                        autoPlay
                                        muted
                                        playsInline
                                        className="w-full h-auto block transform -scale-x-100"
                                    />
                                </div>
                                <div className="w-full relative z-10 mt-auto flex flex-col gap-2">
                                    <Dropdown
                                        options={devices.map(d => ({
                                            value: d.deviceId,
                                            label: d.label || `Camera ${d.deviceId.slice(0, 4)}...`,
                                        }))}
                                        value={selectedDeviceId}
                                        onChange={onDeviceChange}
                                    />
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-text-muted">
                                            <MdPictureInPicture size={16} />
                                            <span className="text-sm">Float Camera</span>
                                            <InfoTooltip
                                                placement="top-right"
                                                description="Open the camera in a floating window so you can see yourself during recording."
                                            />
                                        </div>
                                        <Toggle value={!!pipWindow} onChange={() => pipWindow ? pipWindow.close() : openPiP()} />
                                    </div>
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
            </div>
        </div>
    );
}

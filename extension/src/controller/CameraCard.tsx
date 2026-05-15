import { useState, useEffect, useRef } from 'react';
import { Toggle, Dropdown } from '@shared/components';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import type { ControllerTab } from './ControllerApp';

export function CameraCard({
    activeTab, setActiveTab,
    isEnabled, selectedDeviceId,
    onEnabledChange, onDeviceChange, onPermissionError,
    onDeviceError,
}: {
    activeTab: ControllerTab;
    setActiveTab: (tab: ControllerTab) => void;
    isEnabled: boolean;
    selectedDeviceId: string;
    onEnabledChange: (enabled: boolean) => void;
    onDeviceChange: (deviceId: string) => void;
    onPermissionError: () => void;
    onDeviceError: (hasError: boolean) => void;
}) {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [deviceError, setDeviceError] = useState<string | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const cameraVideoRef = useRef<HTMLVideoElement>(null);

    // Notify parent of device error state
    useEffect(() => {
        onDeviceError(!!deviceError);
    }, [deviceError]); // eslint-disable-line react-hooks/exhaustive-deps

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
                setDeviceError(null);
                await refreshDevices();
            } catch (err: any) {
                console.error("Camera permission failed:", err);
                streamRef.current = null;
                setStream(null);
                if (err.name === 'NotAllowedError') {
                    onEnabledChange(false);
                    onPermissionError();
                } else if (err instanceof OverconstrainedError) {
                    setDeviceError('Device not found');
                }
            }
        } else {
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            setStream(null);
            setDeviceError(null);
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
                } else if (err instanceof OverconstrainedError) {
                    setDeviceError('Device not found');
                }
            });
        }
    }, [isEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

    // Switch device
    useEffect(() => {
        if (isEnabled && selectedDeviceId) {
            streamRef.current?.getTracks().forEach(t => t.stop());
            navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: selectedDeviceId } } })
                .then(s => { streamRef.current = s; setStream(s); setDeviceError(null); })
                .catch(e => {
                    console.error("Failed to switch video", e);
                    streamRef.current = null;
                    setStream(null);
                    if (e instanceof OverconstrainedError) setDeviceError('Device not found');
                });
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


    // Cleanup on unmount
    useEffect(() => {
        return () => {
            streamRef.current?.getTracks().forEach(t => t.stop());
        };
    }, []);

    const isExpanded = isEnabled;

    return (
        <div className={`bg-surface-raised rounded-xl border overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'border-primary/30 shadow-sm' : 'border-border'}`}>
            <button
                className="flex items-center justify-between w-full px-4 py-3 cursor-pointer hover:bg-surface/50 transition-colors"
                onClick={() => {
                    if (!isEnabled) {
                        handleToggle(true);
                        setActiveTab('camera');
                    }
                }}
            >
                <span className={`text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'camera' ? 'text-primary' : 'text-text-main'} w-[130px] justify-start`}>
                    {isEnabled ? <PiWebcamBold size={16} /> : <PiWebcamSlashBold size={16} />}
                    Camera
                </span>
                {isEnabled && deviceError && (
                    <span className="flex-1 text-xs text-destructive truncate mx-4">{deviceError}</span>
                )}
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
                <div className="px-4 pb-3 border-t border-border">
                    <div className="flex flex-col gap-2 pt-3 animate-in fade-in duration-200">
                        <div className="relative w-full aspect-video bg-surface rounded-lg overflow-hidden border border-border flex justify-center items-center">
                            {deviceError ? (
                                <div className="flex flex-col items-center gap-2 text-red-400">
                                    <PiWebcamSlashBold size={32} />
                                    <span className="text-sm font-medium">{deviceError}</span>
                                    <span className="text-xs text-text-muted">Select a different camera below</span>
                                </div>
                            ) : (
                                <video
                                    ref={cameraVideoRef}
                                    autoPlay
                                    muted
                                    playsInline
                                    className="w-full h-auto block transform -scale-x-100"
                                />
                            )}
                        </div>
                        <Dropdown
                            options={devices.map(d => ({
                                value: d.deviceId,
                                label: d.label || `Camera ${d.deviceId.slice(0, 4)}...`,
                            }))}
                            value={selectedDeviceId}
                            onChange={onDeviceChange}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

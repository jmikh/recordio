import { useState, useEffect, useRef } from 'react';
import { Toggle, Dropdown } from '@shared/components';
import { BiMicrophone, BiMicrophoneOff } from 'react-icons/bi';
import type { ControllerTab } from './ControllerApp';

export function MicrophoneCard({
    activeTab, setActiveTab,
    isEnabled, selectedDeviceId,
    onEnabledChange, onDeviceChange, onPermissionError,
}: {
    activeTab: ControllerTab;
    setActiveTab: (tab: ControllerTab) => void;
    isEnabled: boolean;
    selectedDeviceId: string;
    onEnabledChange: (enabled: boolean) => void;
    onDeviceChange: (deviceId: string) => void;
    onPermissionError: () => void;
}) {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);
    const streamRef = useRef<MediaStream | null>(null);

    // Enumerate devices on mount
    useEffect(() => {
        navigator.mediaDevices.enumerateDevices().then(devs => {
            setDevices(devs.filter(d => d.kind === 'audioinput'));
        });
    }, []);

    const refreshDevices = async () => {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const audioDevs = devs.filter(d => d.kind === 'audioinput');
        setDevices(audioDevs);
        if (!selectedDeviceId && audioDevs.length > 0) onDeviceChange(audioDevs[0].deviceId);
    };

    const handleToggle = async (enabled: boolean) => {
        onEnabledChange(enabled);
        if (enabled) {
            try {
                const s = await navigator.mediaDevices.getUserMedia({
                    audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
                });
                streamRef.current = s;
                setStream(s);
                await refreshDevices();
            } catch (err: any) {
                console.error("Audio permission failed:", err);
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
                audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
            }).then(s => {
                streamRef.current = s;
                setStream(s);
                navigator.mediaDevices.enumerateDevices().then(devs => {
                    setDevices(devs.filter(d => d.kind === 'audioinput'));
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
            navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedDeviceId } } })
                .then(s => { streamRef.current = s; setStream(s); })
                .catch(e => console.error("Failed to switch audio", e));
        }
    }, [selectedDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Audio level monitoring
    useEffect(() => {
        if (!isEnabled || !stream) {
            setAudioLevel(0);
            return;
        }

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume();

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        let smoothed = 0;
        let rafId: number;

        const tick = () => {
            rafId = requestAnimationFrame(tick);
            analyser.getByteTimeDomainData(dataArray);

            let sumSquares = 0;
            for (let i = 0; i < bufferLength; i++) {
                const norm = (dataArray[i] / 128.0) - 1.0;
                sumSquares += norm * norm;
            }
            const rms = Math.sqrt(sumSquares / bufferLength);
            let target = rms * 4;
            if (target > 1) target = 1;

            smoothed += (target - smoothed) * 0.25;
            setAudioLevel(smoothed);
        };

        tick();

        return () => {
            cancelAnimationFrame(rafId);
            source.disconnect();
            analyser.disconnect();
            if (ctx.state !== 'closed') ctx.close().catch(() => { });
        };
    }, [isEnabled, stream]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            streamRef.current?.getTracks().forEach(t => t.stop());
        };
    }, []);

    const isExpanded = activeTab === 'mic' && isEnabled;

    return (
        <div className={`bg-surface-raised rounded-xl border overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'border-primary/30 shadow-sm' : 'border-border'}`}>
            <button
                className="flex items-center justify-between w-full px-4 py-3 cursor-pointer hover:bg-surface/50 transition-colors"
                onClick={() => {
                    if (!isEnabled) {
                        handleToggle(true);
                        setActiveTab('mic');
                    } else {
                        setActiveTab(activeTab === 'mic' ? 'screen' : 'mic');
                    }
                }}
            >
                <span className={`text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'mic' ? 'text-primary' : 'text-text-main'} w-[130px] justify-start`}>
                    {isEnabled ? <BiMicrophone size={16} /> : <BiMicrophoneOff size={16} />}
                    Microphone
                </span>
                {isEnabled && (
                    <AudioWaveformLine level={audioLevel} />
                )}
                <div onClick={e => e.stopPropagation()}>
                    <Toggle value={isEnabled} onChange={(enabled) => {
                        handleToggle(enabled);
                        if (enabled) setActiveTab('mic');
                    }} />
                </div>
            </button>
            <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{ maxHeight: isExpanded ? '100px' : '0px', opacity: isExpanded ? 1 : 0 }}
            >
                <div className="px-4 pb-4 border-t border-border">
                    <div className="pt-3">
                        {isEnabled ? (
                            <Dropdown
                                options={devices.map(d => ({
                                    value: d.deviceId,
                                    label: d.label || `Microphone ${d.deviceId.slice(0, 4)}...`,
                                }))}
                                value={selectedDeviceId}
                                onChange={onDeviceChange}
                            />
                        ) : (
                            <div className="flex items-center justify-center gap-2 text-text-disabled py-2">
                                <BiMicrophoneOff size={16} />
                                <span className="text-sm">Microphone off</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AudioWaveformLine({ level }: { level: number }) {
    return (
        <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-border mx-10">
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

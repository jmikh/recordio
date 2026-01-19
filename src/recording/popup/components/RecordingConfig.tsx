import { AudioVisualizerWrapper } from './AudioVisualizerWrapper';
import { CameraPreview } from './CameraPreview';
import { MultiToggle, Toggle, Dropdown, PrimaryButton, Notice } from '../../../components/ui';
import { MSG_TYPES } from '../../../recording/shared/messageTypes';

interface RecordingConfigProps {
    recordingMode: 'tab' | 'window' | 'screen';
    setRecordingMode: (mode: 'tab' | 'window' | 'screen') => void;
    audioDevices: MediaDeviceInfo[];
    videoDevices: MediaDeviceInfo[];
    isAudioEnabled: boolean;
    isVideoEnabled: boolean;
    selectedAudioId: string;
    selectedVideoId: string;
    audioStream: MediaStream | null;
    videoStream: MediaStream | null;
    canInjectContentScript: boolean | null;
    hasPermissionError: boolean;
    handleAudioToggle: (enabled: boolean) => void;
    handleVideoToggle: (enabled: boolean) => void;
    setSelectedAudioId: (id: string) => void;
    setSelectedVideoId: (id: string) => void;
    startRecording: () => void;
}

export function RecordingConfig({
    recordingMode,
    setRecordingMode,
    audioDevices,
    videoDevices,
    isAudioEnabled,
    isVideoEnabled,
    selectedAudioId,
    selectedVideoId,
    audioStream,
    videoStream,
    canInjectContentScript,
    hasPermissionError,
    handleAudioToggle,
    handleVideoToggle,
    setSelectedAudioId,
    setSelectedVideoId,
    startRecording
}: RecordingConfigProps) {
    return (
        <div className="flex flex-col w-full gap-5">
            {/* Mode Selection */}
            <div className="w-full">
                <MultiToggle
                    options={[
                        { value: 'tab', label: 'Tab' },
                        { value: 'window', label: 'Window' },
                        { value: 'screen', label: 'Screen' }
                    ]}
                    value={recordingMode}
                    onChange={(mode) => {
                        setRecordingMode(mode);
                        // If leaving tab mode, disable blur
                        if (mode !== 'tab') {
                            chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                                if (tabs[0]?.id) {
                                    chrome.tabs.sendMessage(tabs[0].id, { type: MSG_TYPES.DISABLE_BLUR_MODE });
                                }
                            });
                        }
                    }}
                    className="w-full text-xs"
                />
            </div>

            {recordingMode === 'tab' && canInjectContentScript === false && (
                <Notice variant="warning" className="animate-in fade-in slide-in-from-top-1">
                    Cannot record tab of Chrome own pages. Start Recordio in another tab or use Window or Screen mode instead.
                </Notice>
            )}

            {/* Audio Controls */}
            <div className="w-full">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-highlighted flex items-center gap-2">
                        Microphone
                    </span>
                    <Toggle value={isAudioEnabled} onChange={handleAudioToggle} />
                </div>
                {isAudioEnabled && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <Dropdown
                            options={audioDevices.map(d => ({
                                value: d.deviceId,
                                label: d.label || `Microphone ${d.deviceId.slice(0, 4)}...`,
                                icon: (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                        <line x1="12" x2="12" y1="19" y2="22" />
                                    </svg>
                                )
                            }))}
                            value={selectedAudioId}
                            onChange={setSelectedAudioId}
                            trigger={
                                <div className="w-full bg-surface-overlay text-xs border border-border rounded p-2 text-text-highlighted cursor-pointer hover:border-border-hover transition-colors flex items-center justify-between">
                                    <span>{audioDevices.find(d => d.deviceId === selectedAudioId)?.label || `Microphone ${selectedAudioId.slice(0, 4)}...`}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </div>
                            }
                        />
                        <AudioVisualizerWrapper stream={audioStream} />
                    </div>
                )}
            </div>

            {/* Video Controls */}
            <div className="w-full">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-highlighted">Camera</span>
                    <Toggle value={isVideoEnabled} onChange={handleVideoToggle} />
                </div>
                {isVideoEnabled && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <Dropdown
                            options={videoDevices.map(d => ({
                                value: d.deviceId,
                                label: d.label || `Camera ${d.deviceId.slice(0, 4)}...`,
                                icon: (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m22 8-6 4 6 4V8Z" />
                                        <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
                                    </svg>
                                )
                            }))}
                            value={selectedVideoId}
                            onChange={setSelectedVideoId}
                            trigger={
                                <div className="w-full bg-surface-overlay text-xs border border-border rounded p-2 text-text-highlighted cursor-pointer hover:border-border-hover transition-colors flex items-center justify-between">
                                    <span>{videoDevices.find(d => d.deviceId === selectedVideoId)?.label || `Camera ${selectedVideoId.slice(0, 4)}...`}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </div>
                            }
                        />
                        <CameraPreview stream={videoStream} />
                    </div>
                )}
            </div>

            <PrimaryButton
                onClick={startRecording}
                disabled={hasPermissionError || (recordingMode === 'tab' && canInjectContentScript === false)}
                className="mt-4 w-full"
            >
                Start Recording
            </PrimaryButton>
        </div>
    );
}

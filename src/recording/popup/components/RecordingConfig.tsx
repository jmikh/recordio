import { AudioVisualizerWrapper } from './AudioVisualizerWrapper';
import { CameraPreview } from './CameraPreview';
import { MultiToggle, Toggle, Dropdown, PrimaryButton, Notice } from '../../../components/ui';
import { MSG_TYPES } from '../../../recording/shared/messageTypes';
import { MdMic, MdVideocam } from 'react-icons/md';

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
                    <span className="text-sm text-text-main flex items-center gap-2">
                        <MdMic size={16} />
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
                            }))}
                            value={selectedAudioId}
                            onChange={setSelectedAudioId}
                            trigger={
                                <div className="w-full bg-surface-overlay text-xs border border-border rounded p-2 text-text-main cursor-pointer hover:border-border-hover transition-colors flex items-center justify-between">
                                    <span>{audioDevices.find(d => d.deviceId === selectedAudioId)?.label || `Microphone ${selectedAudioId.slice(0, 4)}...`}</span>
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
                    <span className="text-sm text-text-main flex items-center gap-2">
                        <MdVideocam size={16} />
                        Camera
                    </span>
                    <Toggle value={isVideoEnabled} onChange={handleVideoToggle} />
                </div>
                {isVideoEnabled && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <Dropdown
                            options={videoDevices.map(d => ({
                                value: d.deviceId,
                                label: d.label || `Camera ${d.deviceId.slice(0, 4)}...`,
                            }))}
                            value={selectedVideoId}
                            onChange={setSelectedVideoId}
                            trigger={
                                <div className="w-full bg-surface-overlay text-xs border border-border rounded p-2 text-text-main cursor-pointer hover:border-border-hover transition-colors flex items-center justify-between">
                                    <span>{videoDevices.find(d => d.deviceId === selectedVideoId)?.label || `Camera ${selectedVideoId.slice(0, 4)}...`}</span>
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

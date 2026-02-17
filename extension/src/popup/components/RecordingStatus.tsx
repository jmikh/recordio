import { PrimaryButton } from '@shared/components';
import { MdMic, MdMicOff, MdVideocam, MdVideocamOff } from 'react-icons/md';

interface RecordingStatusProps {
    recordingDuration: number;
    stopRecording: () => void;
    hasAudio: boolean;
    hasCamera: boolean;
    recordingMode: 'tab' | 'window' | 'screen';
}

export function RecordingStatus({ recordingDuration, stopRecording, hasAudio, hasCamera, recordingMode }: RecordingStatusProps) {
    const modeLabel = recordingMode.charAt(0).toUpperCase() + recordingMode.slice(1);
    return (
        <div className="flex flex-col items-center gap-4">
            {/* Media Status Pills */}
            <div className="flex items-center gap-2 w-full justify-center">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${hasAudio
                    ? 'border-primary text-primary'
                    : 'border-disabled text-disabled'
                    }`}>
                    {hasAudio ? <MdMic size={13} /> : <MdMicOff size={13} />}
                    Mic {hasAudio ? 'On' : 'Off'}
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${hasCamera
                    ? 'border-primary text-primary'
                    : 'border-disabled text-disabled'
                    }`}>
                    {hasCamera ? <MdVideocam size={13} /> : <MdVideocamOff size={13} />}
                    Camera {hasCamera ? 'On' : 'Off'}
                </div>
            </div>

            {/* Recording Status */}
            <div className="flex flex-col items-center gap-2 py-2">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
                    <span className="text-sm text-text-highlighted font-medium">Recording {modeLabel}</span>
                </div>

                {/* Live Timer */}
                <div className="text-3xl font-bold text-text-highlighted tabular-nums">
                    {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:
                    {(recordingDuration % 60).toString().padStart(2, '0')}
                </div>
            </div>

            {/* Finish Recording Button */}
            <PrimaryButton
                onClick={stopRecording}
                className="w-full py-2.5"
            >
                Finish Recording
            </PrimaryButton>
        </div>
    );
}

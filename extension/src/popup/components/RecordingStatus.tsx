
import { BiMicrophone, BiMicrophoneOff } from 'react-icons/bi';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import { Button } from '@shared/components';

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
            {/* Media Status Icons */}
            <div className="flex items-center gap-3 w-full justify-center">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${hasAudio
                    ? 'border-primary text-primary'
                    : 'border-disabled text-disabled'
                    }`}>
                    {hasAudio ? <BiMicrophone size={16} /> : <BiMicrophoneOff size={16} />}
                </div>
                <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${hasCamera
                    ? 'border-primary text-primary'
                    : 'border-disabled text-disabled'
                    }`}>
                    {hasCamera ? <PiWebcamBold size={16} /> : <PiWebcamSlashBold size={16} />}
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
            <Button
                variant="primary"
                onClick={stopRecording}
                fullWidth
                className="py-2.5"
            >
                Finish Recording
            </Button>
        </div>
    );
}

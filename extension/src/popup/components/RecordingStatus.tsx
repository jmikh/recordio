import { PrimaryButton } from '../../../components/ui';

interface RecordingStatusProps {
    recordingDuration: number;
    stopRecording: () => void;
}

export function RecordingStatus({ recordingDuration, stopRecording }: RecordingStatusProps) {
    return (
        <div className="flex flex-col items-center justify-center gap-4 py-6">
            {/* Recording Status */}
            <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
                    <span className="text-sm text-text-highlighted font-medium">Recording</span>
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

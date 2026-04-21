import { useState, useEffect } from 'react';
import { Button, Tooltip } from '@shared/components';
import { BiMicrophone, BiMicrophoneOff } from 'react-icons/bi';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import { FiSquare } from 'react-icons/fi';
import logoDark from '@shared/assets/fulllogo-dark.png';
import logoLight from '@shared/assets/fulllogo-light.png';
import '@shared/components/LogoLink.css';

export function RecordingPhase({ hasAudio, hasCamera, onStop }: {
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
            <div className="flex flex-col items-center gap-6 bg-surface-raised border border-border rounded-xl px-10 py-8 shadow-sm">
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

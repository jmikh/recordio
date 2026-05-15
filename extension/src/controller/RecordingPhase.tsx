import { useState } from 'react';
import { Button } from '@shared/components';
import { BiMicrophone, BiMicrophoneOff } from 'react-icons/bi';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import { FiSquare } from 'react-icons/fi';
import { IoPause, IoPlay } from 'react-icons/io5';
import { MdCancel } from 'react-icons/md';
import logoDark from '@shared/assets/fulllogo-dark.png';
import logoLight from '@shared/assets/fulllogo-light.png';
import type { RecordingState } from '../shared/messageTypes';
import { formatTime, useElapsed } from '../shared/recordingTime';
import '@shared/components/LogoLink.css';

export function RecordingPhase({ hasAudio, hasCamera, recordingState, onPauseResume, onFinish, onCancel }: {
    hasAudio: boolean;
    hasCamera: boolean;
    recordingState: RecordingState | null;
    onPauseResume: () => void;
    onFinish: () => void;
    onCancel: () => void;
}) {
    const elapsed = useElapsed(recordingState);
    const [busy, setBusy] = useState(false);
    const isPaused = recordingState?.isPaused ?? false;

    const handle = async (fn: () => void | Promise<void>) => {
        setBusy(true);
        try { await fn(); } finally { setBusy(false); }
    };

    return (
        <div className="flex flex-col items-center gap-6 py-10 animate-in fade-in duration-300">
            {/* Logo */}
            <div className="flex justify-center">
                <img src={logoLight} alt="Recordio" className="logo-for-light h-8" />
                <img src={logoDark} alt="Recordio" className="logo-for-dark h-8" />
            </div>

            {/* Card */}
            <div className="flex flex-col items-center gap-6 bg-surface-raised border border-border rounded-xl px-10 py-8 shadow-sm w-full max-w-sm">
                {/* Timer row */}
                <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 bg-destructive rounded-full shrink-0 ${isPaused ? '' : 'animate-pulse'}`} />
                    <span className="text-3xl font-semibold tabular-nums tracking-wide text-text-highlighted">
                        {formatTime(elapsed)}
                    </span>
                    <div className="flex items-center gap-2 ml-2">
                        <span className={hasAudio ? 'text-text-main' : 'text-text-disabled'}>
                            {hasAudio ? <BiMicrophone className="icon-lg" /> : <BiMicrophoneOff className="icon-lg" />}
                        </span>
                        <span className={hasCamera ? 'text-text-main' : 'text-text-disabled'}>
                            {hasCamera ? <PiWebcamBold className="icon-lg" /> : <PiWebcamSlashBold className="icon-lg" />}
                        </span>
                    </div>
                </div>

                {/* Pause / Finish */}
                <div className="flex gap-2 w-full">
                    <Button
                        variant="base"
                        onClick={() => handle(onPauseResume)}
                        disabled={busy}
                        className="w-28 justify-center gap-1.5"
                    >
                        {isPaused
                            ? <><IoPlay className="icon-sm" /> Resume</>
                            : <><IoPause className="icon-sm" /> Pause</>}
                    </Button>
                    <Button
                        variant="primary"
                        onClick={() => handle(onFinish)}
                        disabled={busy}
                        className="w-28 justify-center gap-1.5"
                    >
                        <FiSquare className="icon-sm" />
                        Finish
                    </Button>
                </div>

                {/* Cancel */}
                <Button
                    variant="ghost"
                    onClick={() => handle(onCancel)}
                    disabled={busy}
                    className="w-full justify-center text-text-muted hover:text-destructive"
                >
                    <MdCancel className="icon-sm" />
                    Cancel Recording
                </Button>
            </div>

            <p className="text-text-disabled text-xs text-center max-w-xs">
                Must keep this tab open while recording.
            </p>
        </div>
    );
}

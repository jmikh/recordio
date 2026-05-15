/**
 * @fileoverview Recording View
 *
 * Shown while a recording is active (tab mode or controller/window mode).
 * Displays elapsed time and pause/resume/cancel/finish controls.
 * Routes commands to background which forwards them to the correct destination.
 *
 * Elapsed time is computed from storage state to stay in sync with the badge:
 *   elapsed = now - startTime - totalPausedMs - (isPaused ? now - pauseStartTime : 0)
 */

import { useState } from 'react';
import { Button } from '@shared/components';
import { BiMicrophone, BiMicrophoneOff } from 'react-icons/bi';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import { FiSquare } from 'react-icons/fi';
import { IoPause, IoPlay } from 'react-icons/io5';
import { MdCancel } from 'react-icons/md';
import { MSG_TYPES, type RecordingState } from '../shared/messageTypes';
import { formatTime, useElapsed } from '../shared/recordingTime';

export function RecordingView({ recordingState }: { recordingState: RecordingState }) {
    const elapsed = useElapsed(recordingState);
    const [busy, setBusy] = useState(false);

    const send = async (type: string) => {
        setBusy(true);
        try {
            await chrome.runtime.sendMessage({ type });
        } finally {
            setBusy(false);
        }
    };

    const handlePauseResume = async () => {
        if (recordingState.isPaused) {
            // Resume: close the popup so it doesn't appear in the recording
            await send(MSG_TYPES.POPUP_RESUME_RECORDING);
            window.close();
        } else {
            await send(MSG_TYPES.POPUP_PAUSE_RECORDING);
        }
    };

    const handleFinish = () => send(MSG_TYPES.POPUP_FINISH_RECORDING);

    const handleCancel = async () => {
        await send(MSG_TYPES.POPUP_CANCEL_RECORDING);
        window.close();
    };

    const sourceLabel = recordingState.recordingMode === 'tab'
        ? 'Recording current tab'
        : 'Recording window / desktop';

    return (
        <div className="flex flex-col gap-4 p-4">
            {/* Timer row */}
            <div className="flex items-center gap-3 px-3 py-3 rounded-[var(--radius-md)] bg-surface border border-border">
                <div className={`w-2.5 h-2.5 rounded-full bg-destructive shrink-0 ${recordingState.isPaused ? '' : 'animate-pulse'}`} />
                <span className="text-2xl font-semibold tabular-nums tracking-wide text-text-highlighted flex-1">
                    {formatTime(elapsed)}
                </span>
                {/* Mic / camera indicators */}
                <div className="flex items-center gap-2">
                    <span className={recordingState.hasAudio ? 'text-text-main' : 'text-text-disabled'}>
                        {recordingState.hasAudio
                            ? <BiMicrophone className="icon-md" />
                            : <BiMicrophoneOff className="icon-md" />}
                    </span>
                    <span className={recordingState.hasCamera ? 'text-text-main' : 'text-text-disabled'}>
                        {recordingState.hasCamera
                            ? <PiWebcamBold className="icon-md" />
                            : <PiWebcamSlashBold className="icon-md" />}
                    </span>
                </div>
            </div>

            {/* Paused banner */}
            {recordingState.isPaused ? (
                <div className="animate-fade-slide-in flex items-center justify-center gap-2 px-3 py-2 -mt-1 rounded-[var(--radius-md)] bg-destructive/10 border border-destructive/30">
                    <IoPause className="icon-sm text-destructive shrink-0 animate-pulse" />
                    <span className="text-sm font-medium text-destructive">Recording paused</span>
                </div>
            ) : (
                <p className="text-xs text-text-muted text-center -mt-1">{sourceLabel}</p>
            )}

            {/* Controls */}
            <div className="flex gap-2">
                {/* Pause / Resume */}
                <Button
                    variant="base"
                    onClick={handlePauseResume}
                    disabled={busy}
                    className="flex-1 justify-center gap-1.5"
                >
                    {recordingState.isPaused
                        ? <><IoPlay className="icon-sm" /> Resume</>
                        : <><IoPause className="icon-sm" /> Pause</>}
                </Button>

                {/* Finish */}
                <Button
                    variant="primary"
                    onClick={handleFinish}
                    disabled={busy}
                    className="flex-1 justify-center gap-1.5"
                >
                    <FiSquare className="icon-sm" />
                    Finish
                </Button>
            </div>

            {/* Cancel */}
            <Button
                variant="ghost"
                onClick={handleCancel}
                disabled={busy}
                className="w-full justify-center text-text-muted hover:text-destructive"
            >
                <MdCancel className="icon-sm" />
                Cancel Recording
            </Button>
        </div>
    );
}

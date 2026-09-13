/**
 * @fileoverview Recording View
 *
 * Shown while a recording is active (tab mode or controller/window mode).
 * The preview frame carries the elapsed time and mic/camera indicators as
 * overlays; below it: a "Blur content" row, Pause/Resume + Discard, then Finish.
 * Routes commands to background which forwards them to the correct destination.
 *
 * Elapsed time is computed from storage state to stay in sync with the badge:
 *   elapsed = now - startTime - totalPausedMs - (isPaused ? now - pauseStartTime : 0)
 */

import { useState, useEffect } from 'react';
import { Button } from '@shared/components';
import { BiMicrophone, BiMicrophoneOff } from 'react-icons/bi';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import { FiTrash2 } from 'react-icons/fi';
import { IoPause, IoPlay } from 'react-icons/io5';
import { MdBlurOn, MdChevronRight, MdDone } from 'react-icons/md';
import { MSG_TYPES, type RecordingState } from '../shared/messageTypes';
import { formatTime, useElapsed } from '../shared/recordingTime';
import { enterBlurMode } from './blurMode';

export function RecordingView({ recordingState }: { recordingState: RecordingState }) {
    const elapsed = useElapsed(recordingState);
    const [busy, setBusy] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                let resp: any;
                if (recordingState.recordingMode === 'controller' && recordingState.controllerTabId) {
                    resp = await chrome.tabs.sendMessage(recordingState.controllerTabId, {
                        type: MSG_TYPES.POPUP_REQUEST_PREVIEW_FRAME,
                    });
                } else if (recordingState.recordingMode === 'tab') {
                    resp = await chrome.runtime.sendMessage({
                        type: MSG_TYPES.POPUP_REQUEST_PREVIEW_FRAME,
                    });
                }
                if (resp?.dataUrl) setPreviewUrl(resp.dataUrl);
            } catch {
                // Preview not available — fail silently
            }
        })();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    const handleDiscard = async () => {
        await send(MSG_TYPES.POPUP_CANCEL_RECORDING);
        window.close();
    };

    return (
        <div className="flex flex-col gap-3 p-3">
            {/* Preview frame with timer + input indicators overlaid (black stand-in when no frame yet) */}
            <div className="relative aspect-video rounded-md overflow-hidden bg-black">
                {previewUrl && (
                    <img src={previewUrl} alt="Recording preview" className="w-full h-full object-contain" />
                )}
                <div className="absolute top-2 right-2 flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-black/70">
                    <span className={recordingState.hasAudio ? 'text-white' : 'text-white/60'}>
                        {recordingState.hasAudio
                            ? <BiMicrophone className="icon-md" />
                            : <BiMicrophoneOff className="icon-md" />}
                    </span>
                    <span className={recordingState.hasCamera ? 'text-white' : 'text-white/60'}>
                        {recordingState.hasCamera
                            ? <PiWebcamBold className="icon-md" />
                            : <PiWebcamSlashBold className="icon-md" />}
                    </span>
                </div>
                <div className="absolute bottom-2 left-2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 text-white">
                    {recordingState.isPaused
                        ? <IoPause className="icon-sm text-destructive animate-pulse" />
                        : <div className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />}
                    <span className="text-base font-bold tabular-nums tracking-wide">
                        {formatTime(elapsed)}
                    </span>
                    {recordingState.isPaused && <span className="text-xs text-white/60">Paused</span>}
                </div>
            </div>

            {/* Blur content — opens the element picker on the page */}
            <Button
                variant="base"
                onClick={enterBlurMode}
                className="w-full justify-start gap-3"
            >
                <MdBlurOn className="icon-md text-text-muted" />
                Blur content
                <MdChevronRight className="icon-md text-text-muted ml-auto" />
            </Button>

            {/* Pause / Resume + Discard */}
            <div className="flex gap-2">
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
                <Button
                    variant="base"
                    onClick={handleDiscard}
                    disabled={busy}
                    className="flex-1 justify-center gap-1.5"
                >
                    <FiTrash2 className="icon-sm" />
                    Discard
                </Button>
            </div>

            {/* Finish */}
            <Button
                variant="primary"
                onClick={handleFinish}
                disabled={busy}
                className="w-full justify-center gap-1.5"
            >
                <MdDone className="icon-sm" />
                Finish
            </Button>
        </div>
    );
}

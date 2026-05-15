/**
 * @fileoverview Offscreen Document — Tab Recording Host
 *
 * Runs in a Chrome offscreen document (MV3 Offscreen API).
 * Receives a tab capture stream ID from the background, opens the stream via
 * getUserMedia, and drives VideoRecorder to encode + save the recording.
 *
 * VideoRecorder handles mic/camera capture internally from the provided device IDs.
 * This document only needs to convert the tabCapture stream ID into a MediaStream
 * and pass it as the `displayStream` in the RecordingConfig.
 *
 * Message flow (all via chrome.runtime.sendMessage):
 *   Background → this doc:
 *     BACKGROUND_OFFSCREEN_INIT    Start recording
 *     BACKGROUND_OFFSCREEN_PAUSE   Pause
 *     BACKGROUND_OFFSCREEN_RESUME  Resume
 *     BACKGROUND_OFFSCREEN_CANCEL  Cancel and discard
 *     BACKGROUND_OFFSCREEN_FINISH  Finalize and save
 *
 *   This doc → Background:
 *     OFFSCREEN_DONE  { cancelled: boolean, sessionId?: string }
 */

import { VideoRecorder } from '../shared/videoRecorder';
import { MSG_TYPES } from '../shared/messageTypes';
import countdownSoundUrl from '../assets/countdown-sound.mp3?url';
import { initSentry, captureException } from '../utils/sentry';

initSentry('offscreen');

let recorder: VideoRecorder | null = null;
let currentSessionId: string | null = null;

// Pre-warmed streams opened during countdown so the camera is adjusted by recording start.
let warmCameraStream: MediaStream | null = null;
let warmMicStream: MediaStream | null = null;

// Single onMessage listener. CAPTURE_USER_EVENT is handled synchronously (no
// response needed), so we return early without returning `true`. All other
// messages are async and return `true` to keep the response channel open.
// Two separate listeners was unnecessary and caused Chrome to hold an open
// response channel for every user event.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Forward user events from content scripts into the active VideoRecorder synchronously.
    if (message.type === MSG_TYPES.CONTENT_CAPTURE_USER_EVENT && recorder && message.payload) {
        recorder.addEvent(message.payload);
        return; // synchronous — do NOT return true
    }


    (async () => {
        switch (message.type) {

            case MSG_TYPES.CONTENT_PLAY_COUNTDOWN_SOUND: {
                new Audio(countdownSoundUrl).play().catch(() => {});
                sendResponse({ done: true });
                break;
            }

            case MSG_TYPES.BACKGROUND_OFFSCREEN_PREPARE: {
                // Open camera/mic early so they're warmed up (auto-exposure etc.) by recording start.
                const { hasAudio: prepAudio, audioDeviceId: prepAudioId, hasVideo: prepVideo, videoDeviceId: prepVideoId } = message.payload || {};
                try {
                    if (prepVideo) {
                        warmCameraStream = await navigator.mediaDevices.getUserMedia({
                            video: {
                                ...(prepVideoId && { deviceId: { exact: prepVideoId } }),
                                width: { ideal: 1920 },
                                height: { ideal: 1080 },
                            }
                        });
                    }
                    if (prepAudio) {
                        warmMicStream = await navigator.mediaDevices.getUserMedia({
                            audio: {
                                ...(prepAudioId && { deviceId: { exact: prepAudioId } }),
                                noiseSuppression: true,
                                echoCancellation: true,
                                autoGainControl: true,
                                // @ts-ignore — Chrome-specific
                                voiceIsolation: true,
                            }
                        });
                    }
                    sendResponse({ success: true });
                } catch (err) {
                    // Non-fatal: INIT will fall back to opening fresh streams
                    console.warn('[Offscreen] Warmup failed:', err);
                    sendResponse({ success: false });
                }
                break;
            }

            case MSG_TYPES.BACKGROUND_OFFSCREEN_INIT: {
                const { tabStreamId, hasAudio, audioDeviceId, hasVideo, videoDeviceId, sessionId, tabViewportSize, captureMaxWidth, captureMaxHeight } = message.payload || {};

                try {
                    // Convert the tabCapture stream ID into a live MediaStream.
                    // Chrome-specific getUserMedia constraints for tab capture.
                    const tabStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            // @ts-ignore — Chrome-specific tab capture constraint
                            mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: tabStreamId }
                        },
                        video: {
                            // @ts-ignore — Chrome-specific tab capture constraint
                            // captureMaxWidth/Height are the tab's actual device-pixel resolution
                            // already capped at 4K by the background. Using the real size (not a
                            // larger constant) prevents Chrome from upscaling/stretching the content.
                            mandatory: {
                                chromeMediaSource: 'tab',
                                chromeMediaSourceId: tabStreamId,
                                maxFrameRate: 30,
                                ...(captureMaxWidth && { maxWidth: captureMaxWidth }),
                                ...(captureMaxHeight && { maxHeight: captureMaxHeight }),
                            }
                        },
                    });

                    // Consume pre-warmed streams (opened during countdown) so the camera is
                    // already adjusted when recording starts. Falls back to null if warmup
                    // was skipped or failed — VideoRecorder will open fresh streams in that case.
                    const preWarmedCamera = warmCameraStream;
                    const preWarmedMic = warmMicStream;
                    warmCameraStream = null;
                    warmMicStream = null;

                    // VideoRecorder.initializeStreams() picks up displayStream as the screen source
                    // and independently opens mic/camera streams from the provided device IDs.
                    // tabViewportSize (CSS pixels) lets the recorder set trackableContentRect
                    // correctly and scale event coordinates from CSS→device pixels.
                    const config = {
                        hasAudio: hasAudio || false,
                        hasCamera: hasVideo || false,
                        audioDeviceId: audioDeviceId || undefined,
                        videoDeviceId: videoDeviceId || undefined,
                        displayStream: tabStream,
                        sourceName: 'Tab Recording',
                        tabViewportSize: tabViewportSize || undefined,
                        isTabCapture: true,
                        warmCameraStream: preWarmedCamera || undefined,
                        warmMicStream: preWarmedMic || undefined,
                    };

                    currentSessionId = sessionId;
                    recorder = new VideoRecorder(sessionId, config);

                    await recorder.prepare(config);

                    await recorder.start('Tab Recording');

                    sendResponse({ success: true });
                } catch (err: any) {
                    console.error('[Offscreen] Init failed:', err);
                    captureException(err instanceof Error ? err : new Error(String(err)));
                    recorder = null;
                    currentSessionId = null;
                    // Notify background that we couldn't start — it should clean up
                    chrome.runtime.sendMessage({
                        type: MSG_TYPES.OFFSCREEN_DONE,
                        payload: { cancelled: true },
                    }).catch(() => { });
                    sendResponse({ success: false, error: err?.message });
                }
                break;
            }

            case MSG_TYPES.BACKGROUND_OFFSCREEN_PAUSE: {
                if (recorder) recorder.pause();
                sendResponse({ success: true });
                break;
            }

            case MSG_TYPES.BACKGROUND_OFFSCREEN_RESUME: {
                if (recorder) recorder.resume();
                sendResponse({ success: true });
                break;
            }

            case MSG_TYPES.BACKGROUND_OFFSCREEN_CANCEL: {
                // Stop any pre-warmed streams that haven't been handed to the recorder yet
                warmCameraStream?.getTracks().forEach(t => t.stop());
                warmCameraStream = null;
                warmMicStream?.getTracks().forEach(t => t.stop());
                warmMicStream = null;

                const rec = recorder;
                const sid = currentSessionId;
                recorder = null;
                currentSessionId = null;

                if (rec && sid) {
                    try {
                        await rec.cancel(sid);
                    } catch (e) {
                        console.warn('[Offscreen] Cancel error (ignored):', e);
                    }
                }

                chrome.runtime.sendMessage({
                    type: MSG_TYPES.OFFSCREEN_DONE,
                    payload: { cancelled: true },
                }).catch(() => { });
                sendResponse({ success: true });
                break;
            }

            case MSG_TYPES.BACKGROUND_OFFSCREEN_FINISH: {
                if (!recorder || !currentSessionId) {
                    sendResponse({ success: false, error: 'No active recording' });
                    return;
                }

                const rec = recorder;
                const sessionId = currentSessionId;
                recorder = null;
                currentSessionId = null;

                try {
                    await rec.finish(sessionId);
                    chrome.runtime.sendMessage({
                        type: MSG_TYPES.OFFSCREEN_DONE,
                        payload: { cancelled: false, sessionId },
                    }).catch((e) => {
                        captureException(e instanceof Error ? e : new Error(String(e)));
                    });
                    sendResponse({ success: true });
                } catch (err: any) {
                    console.error('[Offscreen] Finish failed:', err);
                    captureException(err instanceof Error ? err : new Error(String(err)));
                    chrome.runtime.sendMessage({
                        type: MSG_TYPES.RECORDING_FAILED,
                        payload: { error: err?.message || 'Unknown error', mode: 'tab' },
                    }).catch(() => {});
                    sendResponse({ success: false, error: err?.message });
                }
                break;
            }
        }
    })();
    return true; // Async response
});

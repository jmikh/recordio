/**
 * @fileoverview Video Recorder (WebCodecs + MediaRecorder)
 *
 * Screen capture uses WebCodecs VideoEncoder with smart keyframe placement:
 * - Detects static frames via lightweight pixel comparison
 * - Inserts keyframes only on scene changes (or every 10s max)
 * - VP9 with variable bitrate → tiny P-frames for static content
 *
 * Camera and mic still use MediaRecorder (unchanged).
 *
 * Used by controller.ts (the controller tab handles all recording).
 */

import type { RecordingConfig } from './messageTypes';
import { ProjectStorage } from '../storage/projectStorage';
import { captureException } from '../utils/sentry';
import { EventType, type UserEvents, type Size, type ScreenMetadata, type CameraMetadata, type MicrophoneMetadata, type Rect } from '@shared/types';
import { detectControllerWindow, type WindowDetectionResult } from './windowDetector';
import type { RawRecording, RecordingPreferences } from '@shared/types';
import * as WebMMuxer from 'webm-muxer';

// MediaStreamTrackProcessor is not in TypeScript's default lib types
declare class MediaStreamTrackProcessor {
    readable: ReadableStream<VideoFrame>;
    constructor(init: { track: MediaStreamTrack });
}

export type RecorderState = 'idle' | 'preparing' | 'recording' | 'stopping';

const KEYFRAME_INTERVAL_SEC = 5; // insert a keyframe every ~5 seconds

export class VideoRecorder {
    private state: RecorderState = 'idle';
    private currentSessionId: string;
    private config: RecordingConfig;

    // Screen WebCodecs pipeline
    private screenStream: MediaStream | null = null;
    private screenVideoEncoder: VideoEncoder | null = null;
    private screenMuxer: WebMMuxer.Muxer<WebMMuxer.FileSystemWritableFileStreamTarget> | null = null;
    private screenOPFSFileHandle: FileSystemFileHandle | null = null;
    private screenOPFSWritable: FileSystemWritableFileStream | null = null;
    private screenFrameReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
    private frameProcessingDone: Promise<void> | null = null;

    // Keyframe tracking
    private lastKeyframeTimestamp = -Infinity;

    // Diagnostics
    private totalFrameCount = 0;
    private keyframeCount = 0;

    // Camera & Mic (still MediaRecorder)
    private cameraRecorder: MediaRecorder | null = null;
    private micRecorder: MediaRecorder | null = null;

    private cameraData: BlobPart[] = [];
    private micData: BlobPart[] = [];

    // Streams
    private activeStreams: MediaStream[] = [];
    private audioContext: AudioContext | null = null;

    // Pre-warmed mic/camera streams opened before recording starts (controller mode).
    // Consumed by initializeStreams() and stopped by cancel() if unused.
    private prewarmedMicStream: MediaStream | null = null;
    private prewarmedCameraStream: MediaStream | null = null;

    private startTime: number = 0;

    // Pause tracking
    private isPaused: boolean = false;
    /** Accumulated microseconds paused (for WebCodecs timestamp adjustment) */
    private totalPausedUs: number = 0;
    /** Wall-clock ms at which the current pause began (Date.now()); 0 if not paused */
    private pauseWallClockStartMs: number = 0;

    // Metadata
    private screenDimensions: Size | undefined;
    private cameraDimensions: Size | undefined;

    // Event Buffer
    private events: UserEvents = {
        mouseClicks: [],
        mousePositions: [],
        keyboardEvents: [],
        drags: [],
        scrolls: [],
        typingEvents: [],
        urlChanges: [],
        hoveredCards: [],
    };

    // Detection Result (Window Mode)
    private detectionResult: WindowDetectionResult | null = null;
    private viewportRect: Rect | undefined;

    // Recording Preferences (post-processing hints)
    private recordingPreferences: RecordingPreferences | undefined;



    constructor(sessionId: string, config: RecordingConfig) {
        this.currentSessionId = sessionId;
        this.config = config;
    }

    /** Updates the session ID. Call this before start() if the recorder was created early for warmup. */
    public setSessionId(id: string) {
        this.currentSessionId = id;
    }

    /**
     * Opens mic/camera streams early so they're settled (auto-exposure, auto-gain) by recording start.
     * Call this as soon as the config is known, before prepare(). Non-blocking — fires and forgets.
     * Streams are consumed automatically in initializeStreams() and stopped in cancel() if unused.
     */
    public async prewarm(config: { hasAudio: boolean; audioDeviceId?: string; hasCamera: boolean; videoDeviceId?: string }): Promise<void> {
        if (config.hasCamera) {
            try {
                this.prewarmedCameraStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        ...(config.videoDeviceId && { deviceId: { exact: config.videoDeviceId } }),
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                });
                console.log('[VideoRecorder] Camera prewarmed');
            } catch (e) {
                console.warn('[VideoRecorder] Camera prewarm failed:', e);
            }
        }
        if (config.hasAudio) {
            try {
                this.prewarmedMicStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        ...(config.audioDeviceId && { deviceId: { exact: config.audioDeviceId } }),
                        noiseSuppression: true,
                        echoCancellation: true,
                        autoGainControl: true,
                    },
                });
                console.log('[VideoRecorder] Mic prewarmed');
            } catch (e) {
                console.warn('[VideoRecorder] Mic prewarm failed:', e);
            }
        }
    }


    public getStatus() {
        return {
            state: this.state,
            sessionId: this.currentSessionId,
        };
    }

    /**
     * Returns the screen stream after prepare() has been called.
     * Used by the controller to display a live preview.
     */
    public getPreviewStream(): MediaStream | null {
        return this.activeStreams[0] || null;
    }

    /**
     * Sets post-processing preferences to include in the saved RawRecording.
     */
    public setRecordingPreferences(prefs: RecordingPreferences) {
        this.recordingPreferences = prefs;
    }

    /**
     * Returns the detection result after prepare() has been called.
     */
    public getDetectionResult(): WindowDetectionResult | null {
        return this.detectionResult;
    }

    /**
     * Prepares the recording session by initializing streams.
     * Returns the window detection result for the controller to display.
     */
    public async prepare(config: RecordingConfig): Promise<WindowDetectionResult | null> {
        if (this.state !== 'idle') {
            throw new Error(`Cannot prepare recording: Recorder is in ${this.state} state.`);
        }


        this.state = 'preparing';
        this.config = config; // Update config with potentially newer one
        this.cameraData = [];
        this.micData = [];
        this.activeStreams = [];

        await this.initializeStreams(this.config);

        const screenStream = this.activeStreams[0];
        const displaySurface = screenStream?.getVideoTracks()[0]?.getSettings()?.displaySurface;

        // Detect Window if Window Mode
        if (displaySurface === 'window' && screenStream) {
                // Clone stream for detection to avoid interfering with the main recorder stream
                const detectionStream = screenStream.clone();
                this.detectionResult = await detectControllerWindow(detectionStream);
                // Ensure we stop the cloned tracks after detection
                detectionStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());

                // Store trackable content rect for later use (events + screenSource metadata)
                // Detection offsets are in frame pixels (which may be 4K-capped, not native DPR).
                // We store width/height in CSS pixels but defer y conversion to save time,
                // when we know the actual frame dimensions and can compute the correct ratio.
                if (this.detectionResult?.isControllerWindow && this.config.tabViewportSize) {
                    this.viewportRect = {
                        x: 0,
                        y: this.detectionResult.yOffset, // raw frame pixels — converted at save time
                        width: this.config.tabViewportSize.width,
                        height: this.config.tabViewportSize.height
                    };
                }
            }

        // Tab capture (via tabCapture API): the entire frame is the content area.
        // tabCapture streams don't populate displaySurface, so we use the isTabCapture flag.
        // CSS viewport size enables DPR-correct event scaling and a full-frame trackableContentRect.
        if (this.config.isTabCapture && this.config.tabViewportSize) {
            this.viewportRect = {
                x: 0,
                y: 0,
                width: this.config.tabViewportSize.width,
                height: this.config.tabViewportSize.height,
            };
        }


        return this.detectionResult;
    }

    /**
     * Starts the recording session.
     */
    public async start(tabTitle?: string): Promise<void> {
        if (this.state !== 'preparing') {
            throw new Error(`Cannot start recording: Recorder is in ${this.state} state. It must be in 'preparing' state.`);
        }

        const displaySurface = this.activeStreams[0]?.getVideoTracks()[0]?.getSettings()?.displaySurface;
        // Update source name if we detected a Chrome window and have a tab title
        if (displaySurface === 'window' && this.detectionResult?.isControllerWindow && tabTitle) {
            this.config.sourceName = tabTitle;
        }

        // Start the frame processing loop (encoder/muxer init on first frame)
        this.frameProcessingDone = this.processFrames();

        if (this.cameraRecorder) {
            this.cameraRecorder.start(100);
        }
        if (this.micRecorder) {
            this.micRecorder.start(100);
        }

        this.startTime = Date.now();
        this.state = 'recording';
    }

    /**
     * Pauses the recording. Screen frames are skipped (not encoded) until resume().
     * Camera and mic MediaRecorders are also paused.
     */
    public pause(): void {
        if (this.state !== 'recording' || this.isPaused) return;
        this.isPaused = true;
        this.pauseWallClockStartMs = Date.now();
        console.log('[VideoRecorder] pause() called — wallClock:', this.pauseWallClockStartMs);
        if (this.cameraRecorder?.state === 'recording') this.cameraRecorder.pause();
        if (this.micRecorder?.state === 'recording') this.micRecorder.pause();
    }

    /**
     * Resumes a paused recording. The pause gap is computed from wall-clock time
     * (not frame timestamps) so it works even if no frames arrive during the pause
     * (e.g. static tab with VFR-like capture). The gap is subtracted from all
     * subsequent frame timestamps so the final video has no freeze or jump.
     */
    public resume(): void {
        if (this.state !== 'recording' || !this.isPaused) return;
        const gapMs = Date.now() - this.pauseWallClockStartMs;
        this.totalPausedUs += gapMs * 1000;
        this.isPaused = false;
        this.pauseWallClockStartMs = 0;
        // Force a keyframe at the resume point so the video is seekable from here
        this.lastKeyframeTimestamp = -Infinity;
        console.log('[VideoRecorder] resume() — gap:', (gapMs / 1000).toFixed(3), 's | totalPausedUs:', (this.totalPausedUs / 1_000_000).toFixed(3), 's');
        if (this.cameraRecorder?.state === 'paused') this.cameraRecorder.resume();
        if (this.micRecorder?.state === 'paused') this.micRecorder.resume();
    }


    /**
     * Finishes the recording session, saves the files, and creates the RawRecording.
     */
    public async finish(sessionId?: string): Promise<{ durationMs: number }> {
        this.validateSession(sessionId);

        if (this.state !== 'recording' && this.state !== 'stopping') {
            console.warn(`[VideoRecorder] finish called but state is ${this.state}. Ignoring.`);
            return { durationMs: 0 };
        }

        // Guard against double-finish (e.g., track ended + extension icon click race)
        if (this.state === 'stopping') {
            console.warn('[VideoRecorder] finish called while already stopping. Ignoring.');
            return { durationMs: 0 };
        }

        this.state = 'stopping';

        // --- 1. Capture track metadata ---
        let screenFrameRate: number | undefined;
        if (this.screenStream) {
            const vt = this.screenStream.getVideoTracks()[0];
            if (vt) {
                const set = vt.getSettings();
                screenFrameRate = set?.frameRate;
                if (!this.screenDimensions && set?.width && set?.height) {
                    this.screenDimensions = { width: set.width, height: set.height };
                }
            }
        }

        let cameraFrameRate: number | undefined;
        if (this.cameraRecorder) {
            const vt = this.cameraRecorder.stream.getVideoTracks()[0];
            if (vt) {
                const settings = vt.getSettings();
                cameraFrameRate = settings?.frameRate;
                if (settings?.width && settings?.height) {
                    this.cameraDimensions = { width: settings.width, height: settings.height };
                }
            }
        }

        // --- 2. Stop the screen stream tracks ---
        // Stopping the screen track signals the MediaStreamTrackProcessor's readable stream to end,
        // which terminates the frame processing loop. Camera/mic tracks are left live intentionally
        // so their MediaRecorders can finish cleanly without an abrupt track-ended flicker.
        if (this.screenStream) {
            for (const track of this.screenStream.getTracks()) {
                if (track.readyState === 'live') {
                    track.stop();
                }
            }
        }

        // --- 3. Wait for frame processing to finish, then finalize encoder + muxer ---
        if (this.frameProcessingDone) {
            await this.frameProcessingDone;
        }

        if (this.screenVideoEncoder && this.screenVideoEncoder.state !== 'closed') {
            await this.screenVideoEncoder.flush();
            this.screenVideoEncoder.close();
        }

        if (this.screenMuxer) {
            this.screenMuxer.finalize();
        }


        // --- 4. Stop Camera/Mic MediaRecorders, then stop their underlying tracks ---
        // Stop the MediaRecorders first (while tracks are still live) to avoid cutting the
        // camera/mic stream abruptly, which would cause a flicker at the end of the recording.
        const stopPromises: Promise<void>[] = [];

        if (this.cameraRecorder && this.cameraRecorder.state !== 'inactive') {
            stopPromises.push(new Promise(resolve => {
                if (this.cameraRecorder) {
                    this.cameraRecorder.onstop = () => resolve();
                    this.cameraRecorder.stop();
                } else resolve();
            }));
        }

        if (this.micRecorder && this.micRecorder.state !== 'inactive') {
            stopPromises.push(new Promise(resolve => {
                if (this.micRecorder) {
                    this.micRecorder.onstop = () => resolve();
                    this.micRecorder.stop();
                } else resolve();
            }));
        }

        await Promise.all(stopPromises);

        // Now stop camera/mic tracks after their MediaRecorders have finalized cleanly.
        for (const stream of this.activeStreams) {
            if (stream === this.screenStream) continue; // already stopped above
            for (const track of stream.getTracks()) {
                if (track.readyState === 'live') {
                    track.stop();
                }
            }
        }

        // --- 5. Save Data ---
        const effectiveId = sessionId || this.currentSessionId;
        if (!effectiveId) throw new Error("No session ID available to save");

        // Finalize pause accounting before computing duration or saving metadata.
        // If finish() is called while paused, add the remaining pause duration now.
        if (this.isPaused && this.pauseWallClockStartMs > 0) {
            this.totalPausedUs += (Date.now() - this.pauseWallClockStartMs) * 1000;
        }

        await this.saveRecordingData(effectiveId, this.events, screenFrameRate, cameraFrameRate);

        const totalPausedMs = Math.round(this.totalPausedUs / 1000);
        const wallClockMs = Date.now() - this.startTime;
        const durationMs = wallClockMs - totalPausedMs;
        console.log('[VideoRecorder] finish() — wallClock:', (wallClockMs / 1000).toFixed(1), 's | totalPaused:', (totalPausedMs / 1000).toFixed(1), 's | effectiveDuration:', (durationMs / 1000).toFixed(1), 's | totalFrames:', this.totalFrameCount, '| keyframes:', this.keyframeCount);

        this.releaseStreams();
        return { durationMs };
    }

    /**
     * Adds a user event to the buffer.
     */
    public addEvent(event: any) {
        if (this.state !== 'recording') return;
        if (this.isPaused) return;

        // Adjust event timestamps to match the compressed video timeline.
        // Video frames subtract totalPausedUs from their raw timestamps; we apply
        // the same correction here (converting µs → ms) so events stay aligned.
        const pausedMs = this.totalPausedUs / 1000;
        const e = pausedMs > 0
            ? {
                ...event,
                timestamp: event.timestamp - pausedMs,
                ...(event.endTime !== undefined && { endTime: event.endTime - pausedMs }),
            }
            : event;

        switch (e.type) {
            case EventType.CLICK: this.events.mouseClicks.push(e); break;
            case EventType.MOUSEPOS: this.events.mousePositions.push(e); break;
            case EventType.KEYDOWN: this.events.keyboardEvents.push(e); break;
            case EventType.MOUSEDRAG: this.events.drags.push(e); break;
            case EventType.SCROLL: this.events.scrolls.push(e); break;
            case EventType.TYPING: this.events.typingEvents.push(e); break;
            case EventType.URLCHANGE: this.events.urlChanges.push(e); break;
            case EventType.HOVERED_CARD: this.events.hoveredCards.push(e); break;
            default:
                console.warn('[VideoRecorder] Unrecognized event type:', e.type);
                break;
        }
    }

    /**
     * Cancels the recording session, discards data, and resets.
     */
    public async cancel(sessionId: string): Promise<void> {
        this.validateSession(sessionId);
        await this.cleanupOPFS();
        // Stop all media tracks so camera/mic indicators go dark
        for (const stream of this.activeStreams) {
            for (const track of stream.getTracks()) {
                track.stop();
            }
        }
        this.activeStreams = [];
        // Stop any prewarmed streams that were never consumed (e.g. user cancelled before recording started)
        this.prewarmedMicStream?.getTracks().forEach(t => t.stop());
        this.prewarmedMicStream = null;
        this.prewarmedCameraStream?.getTracks().forEach(t => t.stop());
        this.prewarmedCameraStream = null;
        this.releaseStreams();
    }

    private async cleanupOPFS(): Promise<void> {
        if (this.screenOPFSWritable) {
            await this.screenOPFSWritable.abort().catch(() => {});
            this.screenOPFSWritable = null;
        }
        if (this.screenOPFSFileHandle) {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(`rec-${this.currentSessionId}-screen.webm`).catch(() => {});
            this.screenOPFSFileHandle = null;
        }
    }


    // --- WebCodecs Frame Processing ---

    /**
     * Reads frames from MediaStreamTrackProcessor and encodes them with fixed-interval keyframes.
     * Chrome's capture API already provides VFR (no frames during static periods),
     * so we don't need scene detection — just a regular keyframe interval for seekability.
     */
    private async processFrames() {
        const reader = this.screenFrameReader!;
        const keyframeIntervalUs = KEYFRAME_INTERVAL_SEC * 1_000_000; // microseconds

        try {
            while (true) {
                const { value: frame, done } = await reader.read();
                if (done) break;

                // --- Pause: skip frames (gap already accounted for in resume()) ---
                if (this.isPaused) {
                    frame.close();
                    continue;
                }

                // Adjust timestamp to remove paused periods
                const adjustedTimestampUs = frame.timestamp - this.totalPausedUs;

                this.totalFrameCount++;

                // Initialize encoder/muxer on first encoded frame using actual dimensions
                if (this.totalFrameCount === 1) {
                    const width = frame.displayWidth;
                    const height = frame.displayHeight;
                    this.screenDimensions = { width, height };

                    const root = await navigator.storage.getDirectory();
                    this.screenOPFSFileHandle = await root.getFileHandle(`rec-${this.currentSessionId}-screen.webm`, { create: true });
                    this.screenOPFSWritable = await this.screenOPFSFileHandle.createWritable();

                    this.screenMuxer = new WebMMuxer.Muxer({
                        target: new WebMMuxer.FileSystemWritableFileStreamTarget(this.screenOPFSWritable),
                        video: { codec: 'V_VP9', width, height },
                        firstTimestampBehavior: 'offset',
                    });

                    this.screenVideoEncoder = new VideoEncoder({
                        output: (chunk, meta) => { this.screenMuxer!.addVideoChunk(chunk, meta); },
                        error: (e) => { console.error('[VideoRecorder] VideoEncoder error:', e.name, e.message); },
                    });

                    this.screenVideoEncoder.configure({
                        codec: 'vp09.00.31.08',
                        width,
                        height,
                        bitrate: 16_000_000,
                        bitrateMode: 'variable',
                        framerate: 30,
                        latencyMode: 'realtime',
                    });

                }

                const needsKeyframe = (adjustedTimestampUs - this.lastKeyframeTimestamp) >= keyframeIntervalUs;
                if (needsKeyframe) {
                    this.keyframeCount++;
                    this.lastKeyframeTimestamp = adjustedTimestampUs;
                }

                // Create a new VideoFrame with the adjusted timestamp before encoding
                const adjustedFrame = new VideoFrame(frame, { timestamp: adjustedTimestampUs });
                frame.close();
                this.screenVideoEncoder!.encode(adjustedFrame, { keyFrame: needsKeyframe });
                adjustedFrame.close();
            }
        } catch (e) {
            if (this.state === 'stopping') {
                console.log('[VideoRecorder] Frame reader ended during stop (expected)');
            } else {
                console.error('[VideoRecorder] Frame processing error:', e);
            }
        }
    }


    // --- Media Setup ---

    private async initializeStreams(config: RecordingConfig) {
        // 1. Get Screen Stream (System Audio + Video)
        const screenStream = await this.getScreenStream(config);
        this.screenStream = screenStream;
        this.activeStreams.push(screenStream);

        // 2. Playback System Audio (Anti-Swallow)
        if (screenStream.getAudioTracks().length > 0) {
            this.audioContext = new AudioContext();
            const sysSource = this.audioContext.createMediaStreamSource(screenStream);
            sysSource.connect(this.audioContext.destination);
        }

        // 3. Get Mic Stream (reuse pre-warmed stream if available)
        let micStream: MediaStream | null = config.warmMicStream || this.prewarmedMicStream || null;
        this.prewarmedMicStream = null;
        if (micStream) {
            console.log('[VideoRecorder] Reusing pre-warmed mic stream');
            this.activeStreams.push(micStream);
        } else if (config.hasAudio) {
            const audioConstraints: MediaTrackConstraints = {
                ...(config.audioDeviceId && { deviceId: { exact: config.audioDeviceId } }),
                noiseSuppression: true,
                echoCancellation: true,
                autoGainControl: true,
                // @ts-ignore — Chrome-specific, not yet in TS types
                voiceIsolation: true,
            };
            try {
                micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            } catch (e) {
                // If the exact deviceId is unavailable (e.g. external mic disconnected), fall back to default mic
                if (config.audioDeviceId && e instanceof OverconstrainedError) {
                    console.warn('[VideoRecorder] Mic getUserMedia failed with exact deviceId, falling back to default:', e);
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true }
                    });
                } else {
                    throw e;
                }
            }
            if (micStream) this.activeStreams.push(micStream);
        }

        // 4. Get Camera Stream (reuse pre-warmed stream if available)
        let cameraStream: MediaStream | null = config.warmCameraStream || this.prewarmedCameraStream || null;
        this.prewarmedCameraStream = null;
        if (cameraStream) {
            console.log('[VideoRecorder] Reusing pre-warmed camera stream');
            this.activeStreams.push(cameraStream);
        } else if (config.hasCamera) {
            try {
                const videoConstraints: MediaTrackConstraints = {
                    ...(config.videoDeviceId && { deviceId: { exact: config.videoDeviceId } }),
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                };
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
                this.activeStreams.push(cameraStream);
            } catch (e) {
                // If the exact deviceId is unavailable (e.g. external camera disconnected), fall back to default camera
                if (config.videoDeviceId && e instanceof OverconstrainedError) {
                    console.warn('[VideoRecorder] Camera getUserMedia failed with exact deviceId, falling back to default:', e);
                    try {
                        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
                        this.activeStreams.push(cameraStream);
                    } catch (e2) {
                        console.warn('[VideoRecorder] Default camera also failed:', e2);
                        captureException(e2 instanceof Error ? e2 : new Error(String(e2)));
                    }
                } else {
                    console.warn('[VideoRecorder] Camera getUserMedia failed:', e);
                    captureException(e instanceof Error ? e : new Error(String(e)));
                }
            }
        }

        // 5. Setup frame reader — encoder/muxer are initialized lazily on first frame
        //    (videoTrack.getSettings() reports max constraints, not actual window size)
        const videoTrack = screenStream.getVideoTracks()[0];
        const processor = new MediaStreamTrackProcessor({ track: videoTrack });
        this.screenFrameReader = processor.readable.getReader();

        // 6. Setup Camera & Mic Recorders (unchanged — still MediaRecorder)
        const mimeType = VideoRecorder.getSupportedMimeType();

        if (cameraStream) {
            const cameraVideoOnly = new MediaStream(cameraStream.getVideoTracks());
            this.cameraRecorder = new MediaRecorder(cameraVideoOnly, { mimeType });
        }

        if (micStream) {
            const micAudioOnly = new MediaStream(micStream.getAudioTracks());
            this.micRecorder = new MediaRecorder(micAudioOnly, { mimeType: 'audio/webm;codecs=opus' });
        }

        // Data Handlers for camera & mic
        if (this.cameraRecorder) {
            this.cameraRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) this.cameraData.push(e.data);
            };
            this.cameraRecorder.onerror = (e) => {
                console.error('[VideoRecorder] cameraRecorder.onerror fired:', e, 'state:', this.state);
            };
        }
        if (this.micRecorder) {
            this.micRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) this.micData.push(e.data);
            };
            this.micRecorder.onerror = (e) => {
                console.error('[VideoRecorder] micRecorder.onerror fired:', e, 'state:', this.state);
            };
        }

        // Track 'ended' listeners — fires when Chrome's "Stop Sharing" is clicked
        for (const stream of this.activeStreams) {
            for (const track of stream.getTracks()) {
                track.addEventListener('ended', () => {
                    console.warn(`[VideoRecorder] Track ended: kind=${track.kind}, label="${track.label}", readyState=${track.readyState}, recorder state=${this.state}`);
                });
            }
        }
    }

    private async getScreenStream(config: RecordingConfig): Promise<MediaStream> {
        const stream = config.displayStream;
        if (!stream) throw new Error("Display stream is required for recording.");
        return stream;
    }

    // --- Storage ---

    private async saveRecordingData(projectId: string, events: UserEvents | null, screenFrameRate?: number, cameraFrameRate?: number) {
        const duration = Date.now() - this.startTime - Math.round(this.totalPausedUs / 1000);
        const now = Date.now();

        // 1. Save Screen Recording Blob (from OPFS file written during encoding)
        const screenBlobId = `rec-${projectId}-screen`;
        if (this.screenOPFSWritable) {
            await this.screenOPFSWritable.close();
            this.screenOPFSWritable = null;
        }
        const screenBlob = this.screenOPFSFileHandle
            ? await this.screenOPFSFileHandle.getFile()
            : new Blob([], { type: 'video/webm' });
        await ProjectStorage.saveRecordingBlob(screenBlobId, screenBlob);
        // Clean up OPFS file now that it's in IndexedDB
        if (this.screenOPFSFileHandle) {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(`rec-${projectId}-screen.webm`).catch(() => {});
            this.screenOPFSFileHandle = null;
        }



        // Screen audio: not included in WebCodecs output (video-only for now)
        const screenHasAudio = (this.screenStream?.getAudioTracks().length ?? 0) > 0;

        // 2. Create Screen Source Metadata
        let trackableContentRect: Rect | undefined;

        const screenSize = this.screenDimensions || { width: 1920, height: 1080 };

        // Scale events from CSS pixels to match actual video dimensions.
        // viewportRect.y is already in frame pixels (from detection); width/height are CSS pixels.
        if (this.viewportRect && events) {
            const cssWidth = this.viewportRect.width;
            if (cssWidth > 0) {
                const scale = screenSize.width / cssWidth;
                if (Math.abs(scale - 1) > 0.01) {
                    this.scaleAllEvents(events, scale, scale);
                }
                trackableContentRect = {
                    x: 0,
                    y: this.viewportRect.y, // already in frame pixels
                    width: screenSize.width,
                    height: screenSize.height - this.viewportRect.y,
                };
            }
        } else if (this.viewportRect) {
            trackableContentRect = {
                x: 0,
                y: this.viewportRect.y,
                width: screenSize.width,
                height: screenSize.height - this.viewportRect.y,
            };
        }

        const screenSource: ScreenMetadata = {
            storagePath: `recordio-blob://${screenBlobId}`,
            durationMs: duration,
            size: screenSize,
            frameRate: screenFrameRate,
            trackableContentRect,
            hasAudio: screenHasAudio,
            createdAt: now,
        };

        // 3. Save Camera Recording Blob (If any)
        let cameraSource: CameraMetadata | undefined;
        if (this.cameraData.length > 0) {
            const camMimeType = this.cameraRecorder?.mimeType || 'video/webm';
            const camBlob = new Blob(this.cameraData, { type: camMimeType });
            const camBlobId = `rec-${projectId}-camera`;
            await ProjectStorage.saveRecordingBlob(camBlobId, camBlob);

            cameraSource = {
                storagePath: `recordio-blob://${camBlobId}`,
                durationMs: duration,
                size: this.cameraDimensions || { width: 1280, height: 720 },
                frameRate: cameraFrameRate,
                createdAt: now,
            };
        }

        // 4. Save Microphone Recording Blob (If any)
        let microphoneSource: MicrophoneMetadata | undefined;
        if (this.micData.length > 0) {
            const micMimeType = this.micRecorder?.mimeType || 'audio/webm';
            const micBlob = new Blob(this.micData, { type: micMimeType });
            const micBlobId = `rec-${projectId}-mic`;
            await ProjectStorage.saveRecordingBlob(micBlobId, micBlob);

            microphoneSource = {
                storagePath: `recordio-blob://${micBlobId}`,
                durationMs: duration,
                createdAt: now,
            };
        }

        // 5. Create & Save RawRecording
        const rawRecording: RawRecording = {
            id: projectId,
            name: this.config.sourceName || "Recording",
            timestamp: now,
            screenSource,
            cameraSource,
            microphoneSource,
            userEvents: events ?? {
                mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [],
                scrolls: [], typingEvents: [], urlChanges: [], hoveredCards: [],
            },
            recordingPreferences: this.recordingPreferences,
        };
        await ProjectStorage.saveRawRecording(rawRecording);
    }


    // --- Cleanup ---

    private releaseStreams() {
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.state = 'idle';
    }

    private validateSession(sessionId?: string) {
        if (sessionId && sessionId !== this.currentSessionId) {
            throw new Error(`Session mismatch: Action for ${sessionId} but current is ${this.currentSessionId}`);
        }
    }

    private scaleAllEvents(events: UserEvents, scaleX: number, scaleY: number) {
        const scaleEvent = (e: any) => {
            if (e.mousePos) {
                e.mousePos.x *= scaleX;
                e.mousePos.y *= scaleY;
            }
            if (e.targetRect) {
                e.targetRect.x *= scaleX;
                e.targetRect.y *= scaleY;
                e.targetRect.width *= scaleX;
                e.targetRect.height *= scaleY;
            }
            if (e.cornerRadius && Array.isArray(e.cornerRadius)) {
                e.cornerRadius = e.cornerRadius.map((r: number) => r * scaleX);
            }
        };

        for (const arr of Object.values(events)) {
            if (Array.isArray(arr)) {
                for (const e of arr) {
                    scaleEvent(e);
                }
            }
        }
    }

    static getSupportedMimeType(): string {
        const types = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4;codecs=avc1,mp4a.40.2',
            'video/webm;codecs=h264'
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return 'video/webm';
    }
}

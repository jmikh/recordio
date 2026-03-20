/**
 * @fileoverview Video Recorder (MediaRecorder Wrapper)
 * 
 * Handles screen and camera capture using MediaRecorder API.
 * - Manages screen stream (tab capture or desktop capture)
 * - Optional camera stream (dual recording mode)
 * - Audio mixing (system audio + microphone)
 * - Saves RawRecording (lightweight handoff format) to storage
 * 
 * Used by both offscreen.ts (tab mode) and controller.ts (window/desktop mode).
 */

import type { RecorderMode, RecordingConfig } from './messageTypes';
import { ProjectStorage } from '../storage/projectStorage';
import { captureException } from '../utils/sentry';
import { EventType, type UserEvents, type Size, type ScreenMetadata, type CameraMetadata, type MicrophoneMetadata, type Rect } from '@shared/types';
import { detectControllerWindow, type WindowDetectionResult } from './windowDetector';
import type { RawRecording } from '@shared/types';

export type RecorderState = 'idle' | 'preparing' | 'recording' | 'stopping';

export class VideoRecorder {
    private mode: RecorderMode;
    private state: RecorderState = 'idle';
    private currentSessionId: string;
    private config: RecordingConfig;

    // Media State
    private screenRecorder: MediaRecorder | null = null;
    private cameraRecorder: MediaRecorder | null = null;
    private micRecorder: MediaRecorder | null = null;

    private screenData: BlobPart[] = [];
    private cameraData: BlobPart[] = [];
    private micData: BlobPart[] = [];

    // Streams
    private activeStreams: MediaStream[] = [];
    private audioContext: AudioContext | null = null;

    private startTime: number = 0;

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

    // Audio Detection (AnalyserNode-based)
    private audioAnalyser: AnalyserNode | null = null;
    private audioDetectionInterval: ReturnType<typeof setInterval> | null = null;
    private detectedScreenAudio = false;

    constructor(sessionId: string, config: RecordingConfig, mode: RecorderMode) {
        this.currentSessionId = sessionId;
        this.mode = mode;
        this.config = config;
    }


    public getStatus() {
        return {
            state: this.state,
            sessionId: this.currentSessionId,
        };
    }

    /**
     * Prepares the recording session by initializing streams.
     * Use this to warm up the camera during countdown.
     */
    public async prepare(config: RecordingConfig): Promise<WindowDetectionResult | null> {
        if (this.state !== 'idle') {
            throw new Error(`Cannot prepare recording: Recorder is in ${this.state} state.`);
        }


        this.state = 'preparing';
        this.config = config; // Update config with potentially newer one
        this.screenData = [];
        this.cameraData = [];
        this.micData = [];
        this.activeStreams = [];

        await this.initializeStreams(this.config);

        // Detect Window if Window Mode (moved from start)
        if (this.mode === 'window') {
            const screenStream = this.activeStreams[0];
            if (screenStream) {
                // Detect if the recorded window is the controller window (current window)
                // This is used to determine if we need to apply offsets to the recorded events
                // Clone stream for detection to avoid interfering with the main recorder stream
                const detectionStream = screenStream.clone();
                this.detectionResult = await detectControllerWindow(detectionStream);
                // Ensure we stop the cloned tracks after detection
                detectionStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());



                // Store trackable content rect for later use (events + screenSource metadata)
                // Detection offsets are in video pixels; convert to CSS pixels to match tabViewportSize.
                // The ratio scaling in saveRecordingData() will then uniformly scale everything to video dimensions.
                if (this.detectionResult?.isControllerWindow && this.config.tabViewportSize) {
                    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
                    this.viewportRect = {
                        x: Math.round(this.detectionResult.xOffset / dpr),
                        y: Math.round(this.detectionResult.yOffset / dpr),
                        width: this.config.tabViewportSize.width,
                        height: this.config.tabViewportSize.height
                    };
                }
            }
        }



        // Set up audio analyser to detect actual audio content
        this.setupAudioAnalyser();

        return this.detectionResult;
    }

    /**
     * Starts the recording session.
     */
    public async start(tabTitle?: string): Promise<void> {
        if (this.state !== 'preparing') {
            throw new Error(`Cannot start recording: Recorder is in ${this.state} state. It must be in 'preparing' state.`);
        }

        // Update source name if we detected a Chrome window and have a tab title
        if (this.mode === 'window' && this.detectionResult?.isControllerWindow && tabTitle) {
            this.config.sourceName = tabTitle;
        }




        if (!this.screenRecorder) {
            throw new Error("Screen Recorder failed to initialize.");
        }

        this.screenRecorder.start(100);
        if (this.cameraRecorder) {
            this.cameraRecorder.start(100);
        }
        if (this.micRecorder) {
            this.micRecorder.start(100);
        }

        this.startTime = Date.now();
        this.state = 'recording';
        this.startAudioDetection();



        // Window detection is now done in prepare()

        // Window detection is now done in prepare()
    }

    /**
     * Finishes the recording session, saves the files, and creates the Project.
     */
    public async finish(sessionId?: string): Promise<{ durationMs: number }> {
        this.validateSession(sessionId);

        if (this.state !== 'recording') {
            console.warn(`[VideoRecorder] finish called but state is ${this.state}. Ignoring.`);
            return { durationMs: 0 };
        }

        this.state = 'stopping';

        // Stop Recorders
        const stopPromises: Promise<void>[] = [];

        let displaySurface: string | undefined;
        let screenFrameRate: number | undefined;
        if (this.screenRecorder && this.screenRecorder.state !== 'inactive') {
            stopPromises.push(new Promise(resolve => {
                if (this.screenRecorder) {
                    this.screenRecorder.onstop = () => resolve();
                    this.screenRecorder.stop();
                } else resolve();
            }));
            // Capture dims + frame rate
            const vt = this.screenRecorder.stream.getVideoTracks()[0];
            const set = vt?.getSettings();
            displaySurface = set?.displaySurface;
            screenFrameRate = set?.frameRate;
            if (set && set.width && set.height) {
                this.screenDimensions = { width: set.width, height: set.height };
            }
        }

        let cameraFrameRate: number | undefined;
        if (this.cameraRecorder && this.cameraRecorder.state !== 'inactive') {
            stopPromises.push(new Promise(resolve => {
                if (this.cameraRecorder) {
                    this.cameraRecorder.onstop = () => resolve();
                    this.cameraRecorder.stop();
                } else resolve();
            }));
            // Capture dims + frame rate
            const vt = this.cameraRecorder.stream.getVideoTracks()[0];
            const settings = vt?.getSettings();
            cameraFrameRate = settings?.frameRate;
            if (settings && settings.width && settings.height) {
                this.cameraDimensions = { width: settings.width, height: settings.height };
            }
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
        this.stopAudioDetection();



        // Save Data
        // Use currentSessionId if not provided (should match due to validateSession)
        const effectiveId = sessionId || this.currentSessionId;
        if (!effectiveId) throw new Error("No session ID available to save");

        await this.saveRecordingData(effectiveId, this.events, screenFrameRate, cameraFrameRate);

        const durationMs = Date.now() - this.startTime;

        this.releaseStreams();
        return { durationMs };
    }

    /**
     * Adds a user event to the buffer.
     */
    public addEvent(event: any) {
        if (this.state !== 'recording') return;

        // Viewport offset is stored as viewportRect on UserEvents (not per-event)

        // Categorize on the fly
        const e = event; // Incoming event payload
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
                // Unrecognized event type
                console.warn('[VideoRecorder] Unrecognized event type:', e.type);
                break;
        }
    }

    /**
     * Cancels the recording session, discards data, and resets.
     */
    public async cancel(sessionId: string): Promise<void> {
        this.validateSession(sessionId);

        this.releaseStreams();
    }


    // --- Media Setup ---

    private async initializeStreams(config: RecordingConfig) {
        // 1. Get Screen Stream (System Audio + Video)
        const screenStream = await this.getScreenStream(config);
        this.activeStreams.push(screenStream);

        // 2. Playback System Audio (Anti-Swallow)
        // If system audio exists, route it to speakers
        if (screenStream.getAudioTracks().length > 0) {
            this.audioContext = new AudioContext();
            const sysSource = this.audioContext.createMediaStreamSource(screenStream);
            sysSource.connect(this.audioContext.destination);
        }

        // 3. Get Mic Stream
        let micStream: MediaStream | null = null;
        if (config.hasAudio) {
            const audioConstraints: MediaTrackConstraints = {
                ...(config.audioDeviceId && { deviceId: { exact: config.audioDeviceId } }),
                noiseSuppression: true,
                echoCancellation: true,
                autoGainControl: true,
                // @ts-ignore — Chrome-specific, not yet in TS types
                voiceIsolation: true,
            };
            micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            this.activeStreams.push(micStream);
        }

        // 4. Get Camera Stream
        let cameraStream: MediaStream | null = null;
        if (config.hasCamera) {
            try {
                const videoConstraints: MediaTrackConstraints = {
                    ...(config.videoDeviceId && { deviceId: { exact: config.videoDeviceId } }),
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                };
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
                this.activeStreams.push(cameraStream);
            } catch (e) {
                console.warn('[VideoRecorder] Camera getUserMedia failed:', e);
                captureException(e instanceof Error ? e : new Error(String(e)));
            }
        }

        // 5. Setup Recorders
        // Screen records video + system audio only (no mic mixing)
        // Camera records video only (no mic muxing)
        // Mic records as standalone audio-only track
        const mimeType = VideoRecorder.getSupportedMimeType();

        this.screenRecorder = new MediaRecorder(screenStream, { mimeType });

        if (cameraStream) {
            const cameraVideoOnly = new MediaStream(cameraStream.getVideoTracks());
            this.cameraRecorder = new MediaRecorder(cameraVideoOnly, { mimeType });
        }

        if (micStream) {
            const micAudioOnly = new MediaStream(micStream.getAudioTracks());
            this.micRecorder = new MediaRecorder(micAudioOnly, { mimeType: 'audio/webm;codecs=opus' });
        }

        // Data Handlers
        if (this.screenRecorder) {
            this.screenRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) this.screenData.push(e.data);
            };
        }
        if (this.cameraRecorder) {
            this.cameraRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) this.cameraData.push(e.data);
            };
        }
        if (this.micRecorder) {
            this.micRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) this.micData.push(e.data);
            };
        }
    }

    private async getScreenStream(config: RecordingConfig): Promise<MediaStream> {
        if (this.mode === 'tab') {
            const streamId = config.streamId;
            if (!streamId) throw new Error("Stream ID is required for tab recording mode.");

            // Request device-pixel resolution for highest quality.
            // Events are in CSS pixels; saveRecordingData() scales them to match actual video dimensions.
            const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

            // @ts-ignore
            return await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: streamId
                    }
                },
                video: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: streamId,
                        maxWidth: Math.round((config.tabViewportSize?.width ?? 1920) * dpr),
                        maxHeight: Math.round((config.tabViewportSize?.height ?? 1080) * dpr),
                        maxFrameRate: 60
                    }
                }
            } as any);
        } else {
            // Window/Screen (desktop) mode: use sourceId from chooseDesktopMedia
            const sourceId = config.sourceId;
            if (!sourceId) throw new Error("Source ID is required for window/screen recording mode.");

            // @ts-ignore
            return await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId
                    }
                },
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId,
                        maxFrameRate: 60
                    }
                }
            } as any);
        }
    }

    // --- Storage ---    

    private async saveRecordingData(projectId: string, events: UserEvents | null, screenFrameRate?: number, cameraFrameRate?: number) {
        const duration = Date.now() - this.startTime;
        const now = Date.now();

        // 1. Save Screen Recording Blob
        const screenMimeType = this.screenRecorder?.mimeType || 'video/webm';
        const screenBlob = new Blob(this.screenData, { type: screenMimeType });
        const screenBlobId = `rec-${projectId}-screen`;
        await ProjectStorage.saveRecordingBlob(screenBlobId, screenBlob);

        // Screen hasAudio: audio track exists AND actual audio content was detected
        const hasAudioTrack = (this.screenRecorder?.stream.getAudioTracks().length ?? 0) > 0;
        const screenHasAudio = hasAudioTrack && this.detectedScreenAudio;

        // 2. Create Screen Source Metadata (embedded in project, not saved separately)
        // For tab recordings, trackableContentRect is the full frame (x=0, y=0)
        let trackableContentRect = this.viewportRect
            ?? (this.mode === 'tab' && this.config.tabViewportSize
                ? { x: 0, y: 0, ...this.config.tabViewportSize }
                : undefined);

        const screenSize = this.screenDimensions || { width: 1920, height: 1080 };

        // Scale events from CSS pixels to match actual video dimensions.
        // Events are captured in CSS pixels. Chrome may capture the video at CSS or
        // device pixel resolution. We use the ratio of actual video size to CSS viewport
        // to align event coordinates with the video coordinate space.
        // We use width-based uniform scale since height can differ due to title bar offsets
        // in window mode (screenSize includes title bar, but trackableContentRect doesn't).
        if (trackableContentRect && events) {
            const cssWidth = trackableContentRect.width;
            if (cssWidth > 0) {
                const scale = screenSize.width / cssWidth;
                // Only scale if there's a meaningful difference
                if (Math.abs(scale - 1) > 0.01) {
                    this.scaleAllEvents(events, scale, scale);
                    trackableContentRect = {
                        x: Math.round(trackableContentRect.x * scale),
                        y: Math.round(trackableContentRect.y * scale),
                        width: Math.round(trackableContentRect.width * scale),
                        height: Math.round(trackableContentRect.height * scale),
                    };
                }
            }
        }

        const screenSource: ScreenMetadata = {
            id: `src-${projectId}-screen`,
            storageUrl: `recordio-blob://${screenBlobId}`,
            durationMs: duration,
            size: screenSize,
            frameRate: screenFrameRate,
            recordingType: this.mode,
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
                id: `src-${projectId}-camera`,
                storageUrl: `recordio-blob://${camBlobId}`,
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
                id: `src-${projectId}-mic`,
                storageUrl: `recordio-blob://${micBlobId}`,
                durationMs: duration,
                createdAt: now,
            };
        }

        // 5. Create & Save RawRecording (lightweight handoff format)
        const rawRecording: RawRecording = {
            id: projectId,
            name: this.config.sourceName || this.mode,
            timestamp: now,
            screenSource,
            cameraSource,
            microphoneSource,
            userEvents: events ?? {
                mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [],
                scrolls: [], typingEvents: [], urlChanges: [], hoveredCards: [],
            },
        };
        await ProjectStorage.saveRawRecording(rawRecording);


    }


    // --- Cleanup ---

    private releaseStreams() {
        this.stopAudioDetection();
        this.activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
        this.activeStreams = [];

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.audioAnalyser = null;
        this.state = 'idle'; // Reset state on release
    }

    // --- Audio Detection ---

    /**
     * Sets up an AnalyserNode on the screen stream's audio to detect
     * whether actual audio content is present (not just a silent track).
     */
    private setupAudioAnalyser() {
        const screenStream = this.activeStreams[0];
        if (!screenStream || screenStream.getAudioTracks().length === 0) return;

        try {
            const ctx = this.audioContext || new AudioContext();
            if (!this.audioContext) this.audioContext = ctx;

            const source = ctx.createMediaStreamSource(screenStream);
            this.audioAnalyser = ctx.createAnalyser();
            this.audioAnalyser.fftSize = 2048;
            source.connect(this.audioAnalyser);
            // Don't connect to destination — we only observe, no playback
        } catch (e) {
            console.warn('[VideoRecorder] Failed to set up audio analyser:', e);
        }
    }

    private startAudioDetection() {
        if (!this.audioAnalyser) return;

        const dataArray = new Float32Array(this.audioAnalyser.fftSize);
        this.audioDetectionInterval = setInterval(() => {
            if (!this.audioAnalyser) return;
            this.audioAnalyser.getFloatTimeDomainData(dataArray);
            // RMS (root mean square) — measures actual signal energy
            const rms = Math.sqrt(dataArray.reduce((sum, v) => sum + v * v, 0) / dataArray.length);
            if (rms > 0.001) { // ~-60dB threshold
                this.detectedScreenAudio = true;
            }
        }, 500);
    }

    private stopAudioDetection() {
        if (this.audioDetectionInterval) {
            clearInterval(this.audioDetectionInterval);
            this.audioDetectionInterval = null;
        }
    }

    private validateSession(sessionId?: string) {
        if (sessionId && sessionId !== this.currentSessionId) {
            throw new Error(`Session mismatch: Action for ${sessionId} but current is ${this.currentSessionId}`);
        }
    }



    private applyOffsetToEvent(e: any, xOff: number, yOff: number) {
        if (xOff === 0 && yOff === 0) return;

        const offsetPoint = (p: { x: number, y: number }) => {
            p.x += xOff;
            p.y += yOff;
        };

        const offsetRect = (r: { x: number, y: number }) => {
            r.x += xOff;
            r.y += yOff;
        };

        if (e.mousePos) offsetPoint(e.mousePos);
        if (e.targetRect) offsetRect(e.targetRect);
    }

    /**
     * Scales all event coordinates to match actual video dimensions.
     * Used to align CSS-pixel events with whatever resolution Chrome captured.
     */
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

    /**
     * static helper to detect supported mime type
     */
    static getSupportedMimeType(): string {
        const types = [
            'video/webm;codecs=vp9',           // High quality VP9
            'video/webm;codecs=vp8',           // Fallback VP8
            'video/webm',                       // Generic
            'video/mp4;codecs=avc1,mp4a.40.2', // Standard MP4 (Moved to bottom)
            'video/webm;codecs=h264'          // Standard WebM (H.264)
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return 'video/webm';
    }
}

/**
 * @fileoverview Video Recorder (MediaRecorder Wrapper)
 * 
 * Handles screen and camera capture using MediaRecorder API.
 * - Manages screen stream (desktop capture via window/screen mode)
 * - Optional camera stream (dual recording mode)
 * - Audio mixing (system audio + microphone)
 * - Saves RawRecording (lightweight handoff format) to storage
 * 
 * Used by controller.ts (the controller tab handles all recording).
 */

import type { RecorderMode, RecordingConfig } from './messageTypes';
import { ProjectStorage } from '../storage/projectStorage';
import { captureException } from '../utils/sentry';
import { EventType, type UserEvents, type Size, type ScreenMetadata, type CameraMetadata, type MicrophoneMetadata, type Rect } from '@shared/types';
import { detectControllerWindow, type WindowDetectionResult } from './windowDetector';
import type { RawRecording, RecordingPreferences } from '@shared/types';

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

    // Recording Preferences (post-processing hints)
    private recordingPreferences: RecordingPreferences | undefined;

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
        this.screenData = [];
        this.cameraData = [];
        this.micData = [];
        this.activeStreams = [];

        await this.initializeStreams(this.config);

        // Detect Window if Window Mode
        if (this.mode === 'window') {
            const screenStream = this.activeStreams[0];
            if (screenStream) {
                // Clone stream for detection to avoid interfering with the main recorder stream
                const detectionStream = screenStream.clone();
                this.detectionResult = await detectControllerWindow(detectionStream);
                // Ensure we stop the cloned tracks after detection
                detectionStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());

                // Store trackable content rect for later use (events + screenSource metadata)
                // Detection offsets are in video pixels; convert to CSS pixels to match tabViewportSize.
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
    }

    /**
     * Finishes the recording session, saves the files, and creates the RawRecording.
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

        const e = event;
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
        this.releaseStreams();
    }


    // --- Media Setup ---

    private async initializeStreams(config: RecordingConfig) {
        // 1. Get Screen Stream (System Audio + Video)
        const screenStream = await this.getScreenStream(config);
        this.activeStreams.push(screenStream);

        // 2. Playback System Audio (Anti-Swallow)
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
        // Window/Screen (desktop) mode: use sourceId from chooseDesktopMedia
        const sourceId = config.sourceId;
        if (!sourceId) throw new Error("Source ID is required for recording.");

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

        // 2. Create Screen Source Metadata
        let trackableContentRect = this.viewportRect ?? undefined;

        const screenSize = this.screenDimensions || { width: 1920, height: 1080 };

        // Scale events from CSS pixels to match actual video dimensions.
        if (trackableContentRect && events) {
            const cssWidth = trackableContentRect.width;
            if (cssWidth > 0) {
                const scale = screenSize.width / cssWidth;
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

        // 5. Create & Save RawRecording
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
            recordingPreferences: this.recordingPreferences,
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
        this.state = 'idle';
    }

    // --- Audio Detection ---

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
            const rms = Math.sqrt(dataArray.reduce((sum, v) => sum + v * v, 0) / dataArray.length);
            if (rms > 0.001) {
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

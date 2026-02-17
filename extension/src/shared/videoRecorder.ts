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
import { EventType, type UserEvents, type Size, type ScreenMetadata, type CameraMetadata, type Rect } from '@shared/types';
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

    private screenData: BlobPart[] = [];
    private cameraData: BlobPart[] = [];

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
        allEvents: []
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

        console.log(`[VideoRecorder] Preparing session ${this.currentSessionId} in ${this.mode} mode.`, config);

        this.state = 'preparing';
        this.config = config; // Update config with potentially newer one
        this.screenData = [];
        this.cameraData = [];
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

                console.log("[VideoRecorder] Detection isControllerWindow:", this.detectionResult?.isControllerWindow);

                // Store viewport rect for later use (events + screenSource metadata)
                if (this.detectionResult?.isControllerWindow && this.config.tabViewportSize) {
                    this.viewportRect = {
                        x: this.detectionResult.xOffset,
                        y: this.detectionResult.yOffset,
                        width: this.config.tabViewportSize.width,
                        height: this.config.tabViewportSize.height
                    };
                    this.events.viewportRect = this.viewportRect;
                }
            }
        }

        console.log(`[VideoRecorder] Streams initialized (warmup complete).`);

        // Set up audio analyser to detect actual audio content
        this.setupAudioAnalyser();

        return this.detectionResult;
    }

    /**
     * Starts the recording session.
     */
    public async start(): Promise<void> {
        if (this.state !== 'preparing') {
            throw new Error(`Cannot start recording: Recorder is in ${this.state} state. It must be in 'preparing' state.`);
        }

        console.log(`[VideoRecorder] Starting session ${this.currentSessionId} in ${this.mode} mode.`, this.config);


        if (!this.screenRecorder) {
            throw new Error("Screen Recorder failed to initialize.");
        }

        this.screenRecorder.start(100);
        if (this.cameraRecorder) {
            this.cameraRecorder.start(100);
        }

        this.startTime = Date.now();
        this.state = 'recording';
        this.startAudioDetection();

        console.log(`[VideoRecorder] Recording started.`);

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

        console.log(`[VideoRecorder] Finishing session ${sessionId}.`);
        this.state = 'stopping';

        // Stop Recorders
        const stopPromises: Promise<void>[] = [];

        let displaySurface: string | undefined;
        if (this.screenRecorder && this.screenRecorder.state !== 'inactive') {
            stopPromises.push(new Promise(resolve => {
                if (this.screenRecorder) {
                    this.screenRecorder.onstop = () => resolve();
                    this.screenRecorder.stop();
                } else resolve();
            }));
            // Capture dims
            const vt = this.screenRecorder.stream.getVideoTracks()[0];
            const set = vt?.getSettings();
            displaySurface = set?.displaySurface;
            if (set && set.width && set.height) {
                this.screenDimensions = { width: set.width, height: set.height };
            }
        }

        if (this.cameraRecorder && this.cameraRecorder.state !== 'inactive') {
            stopPromises.push(new Promise(resolve => {
                if (this.cameraRecorder) {
                    this.cameraRecorder.onstop = () => resolve();
                    this.cameraRecorder.stop();
                } else resolve();
            }));
            // Capture dims
            const vt = this.cameraRecorder.stream.getVideoTracks()[0];
            const settings = vt?.getSettings();
            if (settings && settings.width && settings.height) {
                this.cameraDimensions = { width: settings.width, height: settings.height };
            }
        }

        await Promise.all(stopPromises);
        this.stopAudioDetection();

        console.log(`[VideoRecorder] Stopped recorders. Display Surface: ${displaySurface}, Detected audio: ${this.detectedScreenAudio}`);

        // Save Data
        // Use currentSessionId if not provided (should match due to validateSession)
        const effectiveId = sessionId || this.currentSessionId;
        if (!effectiveId) throw new Error("No session ID available to save");

        await this.saveRecordingData(effectiveId, this.events);

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
        console.log(`[VideoRecorder] Cancelling session ${sessionId}.`);

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
            const constraints = config.audioDeviceId ? { deviceId: { exact: config.audioDeviceId } } : true;
            micStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
            this.activeStreams.push(micStream);
        }

        // 4. Get Camera Stream (Dual Mode)
        let cameraStream: MediaStream | null = null;
        if (config.hasCamera) {
            const videoConstraints: MediaTrackConstraints = {
                ...(config.videoDeviceId && { deviceId: { exact: config.videoDeviceId } }),
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            };
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
            this.activeStreams.push(cameraStream);
        }

        // 5. Mix Audio & Setup Recorders
        const mimeType = VideoRecorder.getSupportedMimeType();
        console.log(`[VideoRecorder] Selected MimeType: ${mimeType}`);

        if (cameraStream) {
            // --- DUAL MODE ---
            // Camera Stream gets Microphone
            let cameraFinalStream = new MediaStream(cameraStream.getVideoTracks());
            if (micStream) {
                micStream.getAudioTracks().forEach(t => cameraFinalStream.addTrack(t));
            }

            // Screen Stream is just Screen (System Audio already inside + playing locally)
            this.screenRecorder = new MediaRecorder(screenStream, { mimeType });
            this.cameraRecorder = new MediaRecorder(cameraFinalStream, { mimeType });
        } else {
            // --- SINGLE MODE ---
            // Screen Stream gets mixed: System (if any) + Mic
            let finalScreenStream = screenStream;

            if (micStream) {
                if (!this.audioContext) this.audioContext = new AudioContext();
                const dest = this.audioContext.createMediaStreamDestination();

                // Mix System
                if (screenStream.getAudioTracks().length > 0) {
                    const sysSource = this.audioContext.createMediaStreamSource(screenStream);
                    sysSource.connect(dest);
                }

                // Mix Mic
                const micSource = this.audioContext.createMediaStreamSource(micStream);
                micSource.connect(dest);

                finalScreenStream = new MediaStream([
                    ...screenStream.getVideoTracks(),
                    dest.stream.getAudioTracks()[0]
                ]);
            }

            this.screenRecorder = new MediaRecorder(finalScreenStream, { mimeType });
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
    }

    private async getScreenStream(config: RecordingConfig): Promise<MediaStream> {
        console.log("getScreenStream: ", this.mode);
        if (this.mode === 'tab') {
            const streamId = config.streamId;
            if (!streamId) throw new Error("Stream ID is required for tab recording mode.");

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
                        maxWidth: config.tabViewportSize?.width,
                        maxHeight: config.tabViewportSize?.height
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
                        chromeMediaSourceId: sourceId
                    }
                }
            } as any);
        }
    }

    // --- Storage ---    

    private async saveRecordingData(projectId: string, events: UserEvents | null) {
        const duration = Date.now() - this.startTime;
        const now = Date.now();

        // 1. Save Screen Recording Blob
        const screenMimeType = this.screenRecorder?.mimeType || 'video/webm';
        console.log(`[VideoRecorder] Saving Screen Blob with MimeType: ${screenMimeType}`);
        const screenBlob = new Blob(this.screenData, { type: screenMimeType });
        const screenBlobId = `rec-${projectId}-screen`;
        await ProjectStorage.saveRecordingBlob(screenBlobId, screenBlob);

        // Screen hasAudio: audio track exists AND actual audio content was detected
        const hasAudioTrack = (this.screenRecorder?.stream.getAudioTracks().length ?? 0) > 0;
        const screenHasAudio = hasAudioTrack && this.detectedScreenAudio;

        // 2. Create Screen Source Metadata (embedded in project, not saved separately)
        // For tab recordings, viewportRect is the full frame (x=0, y=0)
        const viewportRect = this.viewportRect
            ?? (this.mode === 'tab' && this.config.tabViewportSize
                ? { x: 0, y: 0, ...this.config.tabViewportSize }
                : undefined);

        const screenSource: ScreenMetadata = {
            id: `src-${projectId}-screen`,
            storageUrl: `recordio-blob://${screenBlobId}`,
            durationMs: duration,
            size: this.screenDimensions || { width: 1920, height: 1080 },
            recordingType: this.mode,
            viewportRect,
            hasAudio: screenHasAudio,
            hasMicrophone: Boolean(this.config.hasAudio && this.cameraData.length === 0),
            createdAt: now,
        };

        // 3. Save Camera Recording Blob (If any)
        let cameraSource: CameraMetadata | undefined;
        if (this.cameraData.length > 0) {
            const camMimeType = this.cameraRecorder?.mimeType || 'video/webm';
            console.log(`[VideoRecorder] Saving Camera Blob with MimeType: ${camMimeType}`);
            const camBlob = new Blob(this.cameraData, { type: camMimeType });
            const camBlobId = `rec-${projectId}-camera`;
            await ProjectStorage.saveRecordingBlob(camBlobId, camBlob);

            cameraSource = {
                id: `src-${projectId}-camera`,
                storageUrl: `recordio-blob://${camBlobId}`,
                durationMs: duration,
                size: this.cameraDimensions || { width: 1280, height: 720 },
                hasMicrophone: Boolean(this.config.hasAudio),
                createdAt: now,
            };
        }

        // 4. Prepare events (populate allEvents for FocusManager)
        const effectiveEvents: UserEvents = events ? {
            ...events,
            allEvents: [
                ...(events.mouseClicks || []),
                ...(events.keyboardEvents || []),
                ...(events.drags || []),
                ...(events.scrolls || []),
                ...(events.typingEvents || []),
                ...(events.urlChanges || []),
                ...(events.hoveredCards || []),
            ].sort((a, b) => a.timestamp - b.timestamp)
        } : {
            mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [],
            scrolls: [], typingEvents: [], urlChanges: [], hoveredCards: [], allEvents: []
        };

        // 5. Create & Save RawRecording (lightweight handoff format)
        const rawRecording: RawRecording = {
            id: projectId,
            name: this.config.sourceName || this.mode,
            timestamp: now,
            screenSource,
            cameraSource,
            userEvents: effectiveEvents,
        };
        await ProjectStorage.saveRawRecording(rawRecording);

        console.log(`[VideoRecorder] RawRecording ${projectId} saved successfully.`);
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

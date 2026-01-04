/**
 * @fileoverview Video Recorder (MediaRecorder Wrapper)
 * 
 * Handles screen and camera capture using MediaRecorder API.
 * - Manages screen stream (tab capture or desktop capture)
 * - Optional camera stream (dual recording mode)
 * - Audio mixing (system audio + microphone)
 * - Saves recordings and events to ProjectStorage
 * 
 * Used by both offscreen.ts (tab mode) and controller.ts (window/desktop mode).
 */

import type { RecorderMode, RecordingConfig } from './messageTypes';
import { ProjectStorage } from '../../storage/projectStorage';
import { ProjectImpl } from '../../core/Project';
import { EventType, type UserEvents, type Size, type SourceMetadata } from '../../core/types';
import { detectWindow, type WindowDetectionResult } from './windowDetector';

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
        urlChanges: []
    };

    // Detection Result (Window Mode)
    private detectionResult: WindowDetectionResult | null = null;

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
    public async prepare(config: RecordingConfig): Promise<void> {
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

        console.log(`[VideoRecorder] Streams initialized (warmup complete).`);
    }

    /**
     * Starts the recording session.
     */
    public async start(): Promise<WindowDetectionResult | null> {
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

        console.log(`[VideoRecorder] Recording started.`);

        // Detect Window if Window Mode
        if (this.mode === 'window') {
            const screenStream = this.activeStreams[0];
            if (screenStream) {
                this.detectionResult = await detectWindow(screenStream);
                console.log("[VideoRecorder] Detection isCurrentWindow:", this.detectionResult.isCurrentWindow);
            }
        }

        return this.detectionResult; // Return to controller
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

        console.log("[VideoRecorder] Stopped recorders. Display Surface: ", displaySurface);

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

        // Apply Offsets if Valid
        if (this.detectionResult && this.detectionResult.isCurrentWindow) {
            this.applyOffsetToEvent(event, this.detectionResult.xOffset, this.detectionResult.yOffset);
        }

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
            const constraints = config.videoDeviceId ? { deviceId: { exact: config.videoDeviceId } } : true;
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: constraints });
            this.activeStreams.push(cameraStream);
        }

        // 5. Mix Audio & Setup Recorders
        if (cameraStream) {
            // --- DUAL MODE ---
            // Camera Stream gets Microphone
            let cameraFinalStream = new MediaStream(cameraStream.getVideoTracks());
            if (micStream) {
                micStream.getAudioTracks().forEach(t => cameraFinalStream.addTrack(t));
            }

            // Screen Stream is just Screen (System Audio already inside + playing locally)
            this.screenRecorder = new MediaRecorder(screenStream, { mimeType: 'video/webm;codecs=vp9' });
            this.cameraRecorder = new MediaRecorder(cameraFinalStream, { mimeType: 'video/webm;codecs=vp9' });
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

            this.screenRecorder = new MediaRecorder(finalScreenStream, { mimeType: 'video/webm;codecs=vp9' });
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

        // 1. Save Screen Recording
        const screenBlob = new Blob(this.screenData, { type: 'video/webm' });
        const screenBlobId = `rec-${projectId}-screen`;
        await ProjectStorage.saveRecordingBlob(screenBlobId, screenBlob);

        // 2. Save Events (only if present)
        let eventsBlobId: string | undefined;
        if (events) {
            const eventsBlob = new Blob([JSON.stringify(events)], { type: 'application/json' });
            eventsBlobId = `evt-${projectId}-screen`;
            await ProjectStorage.saveRecordingBlob(eventsBlobId, eventsBlob);
        }

        // 3. Create Screen Source
        const screenSource: SourceMetadata = {
            id: `src-${projectId}-screen`,
            type: 'video',
            url: `recordo-blob://${screenBlobId}`,
            eventsUrl: eventsBlobId ? `recordo-blob://${eventsBlobId}` : undefined,
            durationMs: duration,
            size: this.screenDimensions || { width: 1920, height: 1080 },
            hasAudio: true,
            createdAt: now,
            name: this.config.sourceName || this.mode
        };
        await ProjectStorage.saveSource(screenSource);

        // 4. Save Camera Recording (If any)
        let cameraSource: SourceMetadata | undefined;
        if (this.cameraData.length > 0) {
            const camBlob = new Blob(this.cameraData, { type: 'video/webm' });
            const camBlobId = `rec-${projectId}-camera`;
            await ProjectStorage.saveRecordingBlob(camBlobId, camBlob);

            cameraSource = {
                id: `src-${projectId}-camera`,
                type: 'video',
                url: `recordo-blob://${camBlobId}`,
                durationMs: duration,
                size: this.cameraDimensions || { width: 1280, height: 720 },
                hasAudio: false, // Audio is in screen or mixed separate, but cam stream usually just video if separate
                createdAt: now,
                name: 'Camera'
            };
            await ProjectStorage.saveSource(cameraSource);
        }

        // 5. Create & Save Project
        // Use empty events for calculation if none provided, to avoid crash, but don't save them.
        const effectiveEvents = events || {
            mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [], scrolls: [], typingEvents: [], urlChanges: []
        };
        const project = ProjectImpl.createFromSource(projectId, screenSource, effectiveEvents, cameraSource);
        await ProjectStorage.saveProject(project);

        console.log(`[VideoRecorder] Project ${projectId} saved successfully.`);
    }


    // --- Cleanup ---

    private releaseStreams() {
        this.activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
        this.activeStreams = [];

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.state = 'idle'; // Reset state on release
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

        if (e.type === EventType.MOUSEDRAG) {
            if (e.path) {
                e.path.forEach((p: any) => { // Drag path is array of MousePositionEvent (BaseEvent)
                    if (p.mousePos) offsetPoint(p.mousePos);
                });
            }
        }
    }
}

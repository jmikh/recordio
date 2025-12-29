import type { RecorderMode, RecordingConfig } from './messageTypes';
import { ProjectLibrary } from '../core/project/ProjectLibrary';
import { ProjectImpl } from '../core/project/Project';
import type { UserEvents, Size, SourceMetadata } from '../core/types';

export type RecorderState = 'idle' | 'preparing' | 'recording' | 'stopping';

export class VideoRecorder {
    private mode: RecorderMode | null = null;
    private state: RecorderState = 'idle';
    private currentSessionId: string | null = null;

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

    // Singleton check helper
    private static instance: VideoRecorder | null = null;

    constructor() {
        if (VideoRecorder.instance) {
            throw new Error(`VideoRecorder already instantiated. Only one instance allowed per context.`);
        }
        VideoRecorder.instance = this;
    }


    public getStatus() {
        return {
            state: this.state,
            sessionId: this.currentSessionId,
        };
    }

    /**
     * Starts the recording session.
     */
    public async start(sessionId: string, config: RecordingConfig, mode: RecorderMode): Promise<void> {
        if (this.state !== 'idle') {
            throw new Error(`Cannot start recording: Recorder is in ${this.state} state.`);
        }

        console.log(`[VideoRecorder] Starting session ${sessionId} in ${mode} mode.`, config);
        this.currentSessionId = sessionId;
        this.mode = mode;
        this.state = 'preparing';
        this.screenData = [];
        this.cameraData = [];
        this.activeStreams = [];

        try {
            await this.initializeStreams(config);

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

        } catch (error: any) {
            console.error("[VideoRecorder] Start failed:", error);
            this.cleanup();
            throw error;
        }
    }

    /**
     * Finishes the recording session, saves the files, and creates the Project.
     */
    public async finish(sessionId: string): Promise<{ durationMs: number }> {
        this.validateSession(sessionId);

        if (this.state !== 'recording') {
            console.warn(`[VideoRecorder] finish called but state is ${this.state}. Ignoring.`);
            return { durationMs: 0 };
        }

        console.log(`[VideoRecorder] Finishing session ${sessionId}.`);
        this.state = 'stopping';

        // Stop Recorders
        const stopPromises: Promise<void>[] = [];

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
            const set = vt?.getSettings();
            if (set && set.width && set.height) {
                this.cameraDimensions = { width: set.width, height: set.height };
            }
        }

        await Promise.all(stopPromises);

        // Save Data
        await this.saveRecordingData(sessionId, this.events);

        const durationMs = Date.now() - this.startTime;

        this.cleanup();
        return { durationMs };
    }

    /**
     * Adds a user event to the buffer.
     */
    public addEvent(event: any) {
        if (this.state !== 'recording') return;

        // Categorize on the fly
        const e = event; // Incoming event payload
        switch (e.type) {
            case 'click': this.events.mouseClicks.push(e); break;
            case 'mousemove': this.events.mousePositions.push(e); break;
            case 'keydown': this.events.keyboardEvents.push(e); break;
            case 'drag': this.events.drags.push(e); break;
            case 'scroll': this.events.scrolls.push(e); break;
            case 'input': this.events.typingEvents.push(e); break;
            case 'urlchange': this.events.urlChanges.push(e); break;
            default:
                // Try legacy mapping or ignore
                break;
        }
    }

    /**
     * Cancels the recording session, discards data, and resets.
     */
    public async cancel(sessionId: string): Promise<void> {
        this.validateSession(sessionId);
        console.log(`[VideoRecorder] Cancelling session ${sessionId}.`);

        this.cleanup();
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
            try {
                const constraints = config.audioDeviceId ? { deviceId: { exact: config.audioDeviceId } } : true;
                micStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
                this.activeStreams.push(micStream);
            } catch (e) {
                console.warn("[VideoRecorder] Failed to get microphone:", e);
            }
        }

        // 4. Get Camera Stream (Dual Mode)
        let cameraStream: MediaStream | null = null;
        if (config.hasCamera) {
            try {
                const constraints = config.videoDeviceId ? { deviceId: { exact: config.videoDeviceId } } : true;
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: constraints });
                this.activeStreams.push(cameraStream);
            } catch (e) {
                console.warn("[VideoRecorder] Failed to get camera:", e);
            }
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
            // @ts-ignore
            return await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
        }
    }

    // --- Storage ---    

    private async saveRecordingData(projectId: string, events: UserEvents | null) {
        const duration = Date.now() - this.startTime;
        const now = Date.now();

        // 1. Save Screen Recording
        const screenBlob = new Blob(this.screenData, { type: 'video/webm' });
        const screenBlobId = `rec-${projectId}-screen`;
        await ProjectLibrary.saveRecordingBlob(screenBlobId, screenBlob);

        // 2. Save Events (only if present)
        let eventsBlobId: string | undefined;
        if (events) {
            const eventsBlob = new Blob([JSON.stringify(events)], { type: 'application/json' });
            eventsBlobId = `evt-${projectId}-screen`;
            await ProjectLibrary.saveRecordingBlob(eventsBlobId, eventsBlob);
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
            createdAt: now
        };
        await ProjectLibrary.saveSource(screenSource);

        // 4. Save Camera Recording (If any)
        let cameraSource: SourceMetadata | undefined;
        if (this.cameraData.length > 0) {
            const camBlob = new Blob(this.cameraData, { type: 'video/webm' });
            const camBlobId = `rec-${projectId}-camera`;
            await ProjectLibrary.saveRecordingBlob(camBlobId, camBlob);

            cameraSource = {
                id: `src-${projectId}-camera`,
                type: 'video',
                url: `recordo-blob://${camBlobId}`,
                durationMs: duration,
                size: this.cameraDimensions || { width: 1280, height: 720 },
                hasAudio: false, // Audio is in screen or mixed separate, but cam stream usually just video if separate
                createdAt: now
            };
            await ProjectLibrary.saveSource(cameraSource);
        }

        // 5. Create & Save Project
        // Use empty events for calculation if none provided, to avoid crash, but don't save them.
        const effectiveEvents = events || {
            mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [], scrolls: [], typingEvents: [], urlChanges: []
        };
        const project = ProjectImpl.createFromSource(projectId, screenSource, effectiveEvents, cameraSource);
        await ProjectLibrary.saveProject(project);

        console.log(`[VideoRecorder] Project ${projectId} saved successfully.`);
    }


    // --- Cleanup ---

    private cleanup() {
        this.activeStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
        this.activeStreams = [];

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.screenRecorder = null;
        this.cameraRecorder = null;
        this.screenData = [];
        this.cameraData = [];
        this.currentSessionId = null;
        this.state = 'idle';
        this.startTime = 0;
    }

    private validateSession(sessionId: string) {
        if (sessionId !== this.currentSessionId) {
            throw new Error(`Session mismatch: Action for ${sessionId} but current is ${this.currentSessionId}`);
        }
    }


}

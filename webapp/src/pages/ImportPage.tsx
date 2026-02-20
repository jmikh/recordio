import { useState, useEffect } from 'react';
import { useExtensionBridge } from '../hooks/useExtensionBridge';
import { importFromRawRecording, ProjectStorage } from '../storage/projectStorage';
import { trackProjectCreated } from '../core/analytics';
import { useUserStore } from '../editor/stores/useUserStore';
import { LogoLink } from '@shared/components';

type ImportStatus =
    | 'init'
    | 'checking'
    | 'receiving'
    | 'streaming'
    | 'storing'
    | 'success'
    | 'error-no-id'
    | 'error-extension'
    | 'error-storage';

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ImportPage() {
    const [status, setStatus] = useState<ImportStatus>('init');
    const [_projectId, setProjectId] = useState<string | null>(null);
    const [errorDetails, setErrorDetails] = useState<string | null>(null);
    const [hasStarted, setHasStarted] = useState(false);

    const { state, requestHandoff, confirmHandoff } = useExtensionBridge();

    // Get recording ID from URL
    const params = new URLSearchParams(window.location.search);
    const recordingId = params.get('id');

    // Check for existing project and start handoff when page loads
    useEffect(() => {
        if (!recordingId) {
            setStatus('error-no-id');
            return;
        }

        if (hasStarted) return;
        setHasStarted(true);

        // Check if project already exists in local DB
        const projectId = `proj-${recordingId}`;
        setStatus('checking');

        ProjectStorage.loadProjectRaw(projectId)
            .then((existingProject) => {
                if (existingProject) {
                    // Project already exists, redirect to editor
                    setStatus('success');
                    setProjectId(projectId);
                    window.location.href = `/editor?projectId=${projectId}`;
                } else {
                    // Project doesn't exist, initiate handoff
                    requestHandoff(recordingId);
                    setStatus('receiving');
                }
            })
            .catch((error) => {
                console.error('[ImportPage] Error checking for existing project:', error);
                // Proceed with handoff on error
                requestHandoff(recordingId);
                setStatus('receiving');
            });
    }, [recordingId, hasStarted, requestHandoff]);

    // Handle handoff state changes
    useEffect(() => {
        // Update status based on bridge state
        if (state.status === 'streaming') {
            setStatus('streaming');
        }

        if (state.status === 'success' && state.recording && state.screenVideo) {
            setStatus('storing');

            importFromRawRecording(
                state.recording,
                state.screenVideo,
                state.cameraVideo || undefined,
                state.micAudio || undefined
            )
                .then((project) => {
                    setProjectId(project.id);
                    setStatus('success');
                    confirmHandoff(project.id);

                    // --- Analytics: project_created ---
                    try {
                        const recording = state.recording!;
                        const events = recording.userEvents;
                        const { userId } = useUserStore.getState();

                        // Strip first URL to domain only (privacy)
                        let firstUrl: string | null = null;
                        if (events.urlChanges.length > 0) {
                            try {
                                firstUrl = new URL(events.urlChanges[0].url).hostname;
                            } catch { /* malformed URL – skip */ }
                        }

                        const userEventCount =
                            events.mouseClicks.length +
                            events.keyboardEvents.length +
                            events.typingEvents.length +
                            events.drags.length +
                            events.hoveredCards.length;

                        trackProjectCreated({
                            duration_seconds: Math.round(recording.screenSource.durationMs / 1000),
                            microphone_on: !!recording.microphoneSource,
                            webcam_on: !!state.cameraVideo,
                            has_system_audio: recording.screenSource.hasAudio,
                            first_url: firstUrl,
                            recording_type: recording.screenSource.recordingType,
                            user_id: userId,
                            user_event_count: userEventCount,
                            has_click_events: events.mouseClicks.length > 0,
                            has_keyboard_events: events.keyboardEvents.length > 0,
                            has_typing_events: events.typingEvents.length > 0,
                            has_drag_events: events.drags.length > 0,
                            has_hovered_cards: events.hoveredCards.length > 0,
                            auto_zoom_count: project.timeline.zoomSegments.length,
                            auto_spotlight_count: project.timeline.spotlightSegments.length,
                            screen_frame_rate: recording.screenSource.frameRate ?? null,
                            camera_frame_rate: recording.cameraSource?.frameRate ?? null,
                        });
                    } catch { /* analytics should never break the app */ }

                    setTimeout(() => {
                        window.location.href = `/editor?projectId=${project.id}`;
                    }, 1500);
                })
                .catch((error) => {
                    console.error('[ImportPage] Storage failed:', error);
                    setStatus('error-storage');
                    setErrorDetails(error.message);
                });
        }

        if (state.status === 'error') {
            setStatus('error-extension');
            setErrorDetails(state.error);
        }
    }, [state, confirmHandoff]);

    const getStatusMessage = () => {
        switch (status) {
            case 'init':
            case 'checking':
            case 'receiving':
            case 'streaming':
            case 'storing':
                return 'Initializing Project';
            case 'success': return 'Opening Editor...';
            case 'error-no-id': return 'No recording ID provided';
            case 'error-extension': return 'Failed to initialize project';
            case 'error-storage': return 'Failed to save project';
        }
    };

    const isError = status.startsWith('error');
    const progress = state.progress;

    // Calculate progress percentage
    const progressPercent = progress && progress.totalBytes > 0
        ? Math.round((progress.bytesReceived / progress.totalBytes) * 100)
        : 0;

    return (
        <div className="min-h-screen bg-surface-body text-text-main flex flex-col items-center justify-center">
            <LogoLink />

            <div className="mt-8 text-center max-w-md">
                <div className={`text-lg ${isError ? 'text-red-400' : 'text-text-main'}`}>
                    {getStatusMessage()}
                </div>

                {errorDetails && (
                    <div className="mt-2 text-sm text-text-muted">
                        {errorDetails}
                    </div>
                )}

                {/* Progress bar */}
                {!isError && status !== 'success' && (
                    <div className="mt-6 w-full">
                        <div className="w-full h-2 bg-surface-raised rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-300 ease-out"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        <div className="mt-2 text-sm text-text-muted text-center">
                            {progressPercent}%
                        </div>
                    </div>
                )}



                {isError && (
                    <button
                        onClick={() => window.location.href = '/'}
                        className="mt-4 px-4 py-2 bg-surface-raised hover:bg-state-hover rounded-lg text-sm"
                    >
                        Go to Dashboard
                    </button>
                )}
            </div>
        </div>
    );
}

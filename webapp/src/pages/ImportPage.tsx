import { useState, useEffect } from 'react';
import { useExtensionBridge } from '../hooks/useExtensionBridge';
import { CloudProjectService } from '../storage/cloudProjectService';
import { usePendingUploadStore } from '../storage/pendingUploadStore';
import { captureImportError } from '../utils/sentry';
import { trackProjectCreated, identifyExtensionUser } from '../core/analytics';
import { useUserStore } from '../editor/stores/useUserStore';
import { LogoLink, Button } from '@shared/components';
import { AuthModal } from '../editor/components/header/AuthModal';
import { navigate } from '../navigate';

type ImportStatus =
    | 'init'
    | 'receiving'
    | 'streaming'
    | 'uploading'
    | 'success'
    | 'error-no-id'
    | 'error-extension'
    | 'error-auth'
    | 'error-upload';

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ImportPage() {
    const [status, setStatus] = useState<ImportStatus>('init');
    const [errorDetails, setErrorDetails] = useState<string | null>(null);
    const [hasStarted, setHasStarted] = useState(false);
    const [uploadPhase, setUploadPhase] = useState<string | null>(null);

    // Auth modal state
    const [showAuthModal, setShowAuthModal] = useState(false);

    const { state, requestHandoff, confirmHandoff } = useExtensionBridge();

    // Get recording ID from URL, stripping any legacy "proj-" prefix
    const params = new URLSearchParams(window.location.search);
    const recordingId = params.get('id')?.replace(/^proj-/, '') ?? null;

    // Start handoff when page loads
    useEffect(() => {
        if (!recordingId) {
            setStatus('error-no-id');
            return;
        }

        if (hasStarted) return;
        setHasStarted(true);

        requestHandoff(recordingId);
        setStatus('receiving');
    }, [recordingId, hasStarted, requestHandoff]);

    // Handle handoff state changes
    useEffect(() => {
        if (state.status === 'streaming') {
            setStatus('streaming');
        }

        if (state.status === 'success' && state.recording && state.screenVideo) {
            // Blobs received — now upload to cloud
            const { userId, isPro } = useUserStore.getState();

            if (!userId) {
                // Must be logged in to upload
                setShowAuthModal(true);
                return;
            }

            performUpload(userId, isPro);
        }

        if (state.status === 'error') {
            captureImportError(
                new Error(state.error || 'Extension bridge error'),
                {
                    recordingId,
                    phase: 'receiving',
                    bridgeStatus: state.status,
                    progress: state.progress ? {
                        bytesReceived: state.progress.bytesReceived,
                        totalBytes: state.progress.totalBytes,
                        chunksReceived: state.progress.chunksReceived,
                        totalChunks: state.progress.totalChunks,
                        source: state.progress.source,
                    } : null,
                }
            );
            setStatus('error-extension');
            setErrorDetails(state.error);

            trackProjectCreatedFailure('extension');
        }
    }, [state]);

    // When auth completes after modal, retry upload
    const userId = useUserStore(s => s.userId);
    useEffect(() => {
        if (showAuthModal && userId && state.status === 'success' && state.recording && state.screenVideo) {
            setShowAuthModal(false);
            const { isPro } = useUserStore.getState();
            performUpload(userId, isPro);
        }
    }, [userId, showAuthModal, state.status]);

    async function performUpload(uid: string, isPro: boolean) {
        if (!state.recording || !state.screenVideo) return;

        setStatus('uploading');
        setUploadPhase('Saving project...');

        // Link Mixpanel profiles: extension anonymous ID → webapp
        if (state.extensionDistinctId) {
            identifyExtensionUser(state.extensionDistinctId);
        }

        try {
            // Fast local import: create project on server, get signed URLs + blob URLs
            const { project, uploads } = await CloudProjectService.importRecordingLocal(
                state.recording,
                state.screenVideo,
                isPro,
                state.cameraVideo || undefined,
                state.micAudio || undefined,
            );

            // Store blobs + signed URLs for background upload in editor
            usePendingUploadStore.getState().setPending({
                projectId: project.id,
                screenBlob: state.screenVideo,
                cameraBlob: state.cameraVideo || undefined,
                micBlob: state.micAudio || undefined,
                uploads,
            });

            setStatus('success');
            confirmHandoff(project.id);

            // --- Analytics: project_created ---
            trackProjectCreatedSuccess(project);

            // Navigate to editor immediately — upload continues in background
            navigate(`/editor?projectId=${project.id}`);
        } catch (error) {
            console.error('[ImportPage] Import failed:', error);
            captureImportError(error, {
                recordingId,
                phase: 'uploading',
                bridgeStatus: state.status,
                screenVideoSize: state.screenVideo?.size,
                cameraVideoSize: state.cameraVideo?.size ?? undefined,
                micAudioSize: state.micAudio?.size ?? undefined,
            });
            setStatus('error-upload');
            setErrorDetails(error instanceof Error ? error.message : 'Import failed');

            trackProjectCreatedFailure('import', error instanceof Error ? error.message : undefined);
        }
    }

    function trackProjectCreatedSuccess(project: { id: string; timeline: { zoomSegments: unknown[]; spotlightSegments: unknown[] } }) {
        try {
            const recording = state.recording!;
            const events = recording.userEvents;
            const { userId: uid } = useUserStore.getState();

            let firstUrl: string | null = null;
            if (events.urlChanges.length > 0) {
                try { firstUrl = new URL(events.urlChanges[0].url).hostname; } catch { /* skip */ }
            }

            const userEventCount =
                events.mouseClicks.length + events.keyboardEvents.length +
                events.typingEvents.length + events.drags.length + events.hoveredCards.length;

            trackProjectCreated({
                duration_ms: Math.round(recording.screenSource.durationMs),
                microphone_on: !!recording.microphoneSource,
                camera_on: !!state.cameraVideo,
                has_system_audio: recording.screenSource.hasAudio,
                first_url: firstUrl,
                recording_current_window: !!recording.screenSource.trackableContentRect,
                user_id: uid,
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
                success: true,
            });
        } catch { /* analytics should never break the app */ }
    }

    function trackProjectCreatedFailure(phase: string, errorMsg?: string) {
        try {
            const recording = state.recording;
            const events = recording?.userEvents;
            const { userId: uid } = useUserStore.getState();

            let firstUrl: string | null = null;
            if (events && events.urlChanges.length > 0) {
                try { firstUrl = new URL(events.urlChanges[0].url).hostname; } catch { /* skip */ }
            }

            trackProjectCreated({
                duration_ms: recording ? Math.round(recording.screenSource.durationMs) : 0,
                microphone_on: !!recording?.microphoneSource,
                camera_on: !!state.cameraVideo,
                has_system_audio: recording?.screenSource.hasAudio ?? false,
                first_url: firstUrl,
                recording_current_window: !!recording?.screenSource.trackableContentRect,
                user_id: uid,
                user_event_count: events
                    ? events.mouseClicks.length + events.keyboardEvents.length +
                      events.typingEvents.length + events.drags.length + events.hoveredCards.length
                    : 0,
                has_click_events: (events?.mouseClicks.length ?? 0) > 0,
                has_keyboard_events: (events?.keyboardEvents.length ?? 0) > 0,
                has_typing_events: (events?.typingEvents.length ?? 0) > 0,
                has_drag_events: (events?.drags.length ?? 0) > 0,
                has_hovered_cards: (events?.hoveredCards.length ?? 0) > 0,
                auto_zoom_count: 0,
                auto_spotlight_count: 0,
                screen_frame_rate: recording?.screenSource.frameRate ?? null,
                camera_frame_rate: recording?.cameraSource?.frameRate ?? null,
                success: false,
                error: errorMsg ?? `${phase} error`,
            });
        } catch { /* analytics should never break the app */ }
    }

    const getStatusMessage = () => {
        switch (status) {
            case 'init':
            case 'receiving':
            case 'streaming':
                return 'Receiving Recording';
            case 'uploading':
                return uploadPhase || 'Uploading...';
            case 'success':
                return 'Opening Editor...';
            case 'error-no-id':
                return 'No recording ID provided';
            case 'error-extension':
                return 'Failed to receive recording';
            case 'error-auth':
                return 'Sign in required';
            case 'error-upload':
                return 'Failed to upload project';
        }
    };

    const isError = status.startsWith('error');
    const progress = state.progress;

    // Progress: streaming progress from extension bridge
    const progressPercent = (progress && progress.totalBytes > 0)
        ? Math.round((progress.bytesReceived / progress.totalBytes) * 100)
        : 0;

    return (
        <div className="min-h-screen bg-surface-body text-text-main flex flex-col items-center justify-center">
            <LogoLink />

            <div className="mt-8 text-center max-w-md">
                <div className={`text-lg ${isError ? 'text-destructive' : 'text-text-main'}`}>
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

                        {status === 'uploading' && (
                            <div className="mt-3 text-xs text-text-muted">
                                Preparing project...
                            </div>
                        )}
                    </div>
                )}

                {isError && (
                    <Button
                        variant="ghost"
                        onClick={() => navigate('/')}
                        className="mt-4"
                    >
                        Go to Dashboard
                    </Button>
                )}
            </div>

            {/* Auth modal — shown when blobs are received but user is not logged in */}
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </div>
    );
}


import { useState, useEffect } from 'react';
import { useExtensionBridge } from '../hooks/useExtensionBridge';
import { CloudProjectService } from '../storage/cloudProjectService';
import { useSyncStatusStore } from '../storage/syncStatusStore';
import { captureImportError } from '../utils/sentry';
import { trackProjectCreated, trackImportPageLoaded, trackImportFailed, trackProjectCreationFailed } from '../core/analytics';
import { useUserStore } from '../editor/stores/useUserStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { LogoLink, Button } from '@shared/components';
import { AuthModal } from '../editor/components/header/AuthModal';
import { navigate } from '../navigate';
import { supabase } from '../auth/AuthManager';

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


export function ImportPage() {
    const [status, setStatus] = useState<ImportStatus>('init');
    const [errorDetails, setErrorDetails] = useState<string | null>(null);
    const [hasStarted, setHasStarted] = useState(false);
    const [uploadPhase, setUploadPhase] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);

    // Auth modal state
    const [showAuthModal, setShowAuthModal] = useState(false);

    const { state, requestHandoff, confirmHandoff, sendIdentify } = useExtensionBridge();

    // Get recording ID from URL, stripping any legacy "proj-" prefix
    const params = new URLSearchParams(window.location.search);
    const recordingId = params.get('id')?.replace(/^proj-/, '') ?? null;

    // Track page view once on mount
    useEffect(() => {
        trackImportPageLoaded({ recording_id: recordingId });
    }, []);

    // Start handoff when page loads
    useEffect(() => {
        if (!recordingId) {
            setStatus('error-no-id');
            trackImportFailed({
                recording_id: null,
                phase: 'no_id',
                error: 'No recording id in URL',
                is_offline: !navigator.onLine,
            });
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
            const { userId } = useUserStore.getState();

            if (!userId) {
                // Must be logged in to upload
                setShowAuthModal(true);
                return;
            }

            performUpload();
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

            trackImportFailed({
                recording_id: recordingId,
                phase: 'extension',
                bridge_status: state.status,
                error: state.error || 'Extension bridge error',
                is_offline: !navigator.onLine,
            });
            trackProjectCreatedFailure('extension');
        }
    }, [state]);

    // When auth completes after modal, retry upload
    const userId = useUserStore(s => s.userId);
    useEffect(() => {
        if (showAuthModal && userId && state.status === 'success' && state.recording && state.screenVideo) {
            setShowAuthModal(false);
            performUpload();
        }
    }, [userId, showAuthModal, state.status]);

    async function performUpload() {
        if (!state.recording || !state.screenVideo) return;

        // Reset any lingering sync-error state from a previous attempt
        useSyncStatusStore.getState().setIdle();

        setStatus('uploading');
        setUploadPhase('Saving project...');
        setUploadProgress(0);

        // Tell extension which user this is so its events share the same Mixpanel distinct_id.
        // The extension aliases its anonymous UUID to the email and switches going forward.
        const { email } = useUserStore.getState();
        if (email) {
            sendIdentify(email);
        }

        let { workspaceId } = useWorkspaceStore.getState();
        if (!workspaceId && supabase) {
            // Workspace fetch may not have completed yet — resolve it now
            const { data } = await supabase.rpc('workspace_get_default');
            if (data?.id) {
                useWorkspaceStore.getState().setWorkspace(data.id, data.name, data.owner_id);
                workspaceId = data.id;
            }
        }
        if (!workspaceId) {
            console.error('[ImportPage] No workspace ID available');
            trackImportFailed({
                recording_id: recordingId,
                phase: 'no_workspace',
                error: 'No workspace id available',
                is_offline: !navigator.onLine,
            });
            setStatus('error-upload');
            return;
        }

        try {
            // 1. Create project on server, get signed upload URLs, cache blobs locally
            const { project, uploads } = await CloudProjectService.importRecordingLocal(
                state.recording,
                state.screenVideo,
                workspaceId,
                state.cameraVideo || undefined,
                state.micAudio || undefined,
            );

            // 2. Upload media to cloud — block until all blobs are uploaded
            //    and project_confirm_upload flips upload_status to 'ready'.
            setUploadPhase('Uploading media...');
            const blobs: { fileType: string; blob: Blob }[] = [
                { fileType: 'screen', blob: state.screenVideo },
            ];
            if (state.cameraVideo) blobs.push({ fileType: 'camera', blob: state.cameraVideo });
            if (state.micAudio) blobs.push({ fileType: 'mic', blob: state.micAudio });

            await CloudProjectService.uploadMedia(
                project.id,
                uploads,
                blobs,
                (_phase, fraction) => {
                    // uploadMedia tracks min progress across files via syncStatusStore;
                    // for the import UI use the aggregate fraction directly.
                    const { currentUpload } = useSyncStatusStore.getState();
                    setUploadProgress(Math.round((currentUpload?.progress ?? fraction) * 100));
                },
            );

            // 3. All media uploaded and confirmed — safe to open the editor.
            setUploadProgress(100);
            setStatus('success');
            confirmHandoff(project.id);
            trackProjectCreatedSuccess(project);
            navigate(`/editor?projectId=${project.id}`);
        } catch (error: any) {
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

            trackProjectCreationFailed({
                recording_id: recordingId,
                error: error?.message || 'Import failed',
                error_name: error?.name,
                is_offline: !navigator.onLine,
                screen_video_size: state.screenVideo?.size,
                camera_video_size: state.cameraVideo?.size ?? undefined,
                mic_audio_size: state.micAudio?.size ?? undefined,
            });
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

    // Progress: streaming progress from extension bridge during streaming,
    // then media-upload progress during upload.
    const streamingPercent = (progress && progress.totalBytes > 0)
        ? Math.round((progress.bytesReceived / progress.totalBytes) * 100)
        : 0;
    const progressPercent = status === 'uploading' ? uploadProgress : streamingPercent;

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

                        {status === 'uploading' && uploadPhase && (
                            <div className="mt-3 text-xs text-text-muted">
                                {uploadPhase}
                            </div>
                        )}
                    </div>
                )}

                {isError && (
                    <div className="mt-4 flex flex-col items-center gap-2">
                        {status === 'error-upload' && state.recording && state.screenVideo && (
                            <Button
                                variant="primary"
                                onClick={() => performUpload()}
                            >
                                Retry upload
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            onClick={() => navigate('/')}
                        >
                            Go to Dashboard
                        </Button>
                    </div>
                )}
            </div>

            {/* Auth modal — shown when blobs are received but user is not logged in */}
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </div>
    );
}


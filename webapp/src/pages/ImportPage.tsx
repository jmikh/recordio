import { useState, useEffect } from 'react';
import { useExtensionBridge } from '../hooks/useExtensionBridge';
import { importFromRawRecording, LocalStorage } from '../storage/localStorage';
import { SyncService } from '../storage/syncService';
import { captureImportError } from '../utils/sentry';
import { trackProjectCreated, identifyExtensionUser } from '../core/analytics';
import { useUserStore } from '../editor/stores/useUserStore';
import { useAuthListener } from '../hooks/useAuthListener';
import { AuthManager } from '../auth/AuthManager';
import { FcGoogle } from 'react-icons/fc';
import { LogoLink, Modal, Button } from '@shared/components';
import { navigate } from '../navigate';
import { cleanupStorageIfNeeded } from '../storage/storageCleanup';

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

    // Existing-projects prompt (shown when not logged in and other local projects exist)
    const [existingProjectsPrompt, setExistingProjectsPrompt] = useState<{
        newProjectId: string;
        projectIds: string[];
    } | null>(null);
    const [isSigningIn, setIsSigningIn] = useState(false);
    const [signInError, setSignInError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [syncPromptProjectId, setSyncPromptProjectId] = useState<string | null>(null);

    const { state, requestHandoff, confirmHandoff } = useExtensionBridge();
    useAuthListener();

    // Get recording ID from URL, stripping any legacy "proj-" prefix
    const params = new URLSearchParams(window.location.search);
    const recordingId = params.get('id')?.replace(/^proj-/, '') ?? null;

    // Check for existing project and start handoff when page loads
    useEffect(() => {
        if (!recordingId) {
            setStatus('error-no-id');
            return;
        }

        if (hasStarted) return;
        setHasStarted(true);

        // Free space before importing a new recording
        cleanupStorageIfNeeded();

        // Check if project already exists in local DB
        const projectId = recordingId;
        setStatus('checking');

        LocalStorage.loadProjectRaw(projectId)
            .then((existingProject) => {
                if (existingProject) {
                    // Project already exists, redirect to editor
                    setStatus('success');
                    setProjectId(projectId);
                    navigate(`/editor?projectId=${projectId}`);
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

            // Link Mixpanel profiles: extension anonymous ID → webapp
            if (state.extensionDistinctId) {
                identifyExtensionUser(state.extensionDistinctId);
            }

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

                    // Upload project metadata to cloud (non-blocking)
                    const { userId, isPro } = useUserStore.getState();
                    SyncService.onProjectCreated(project, userId, isPro).catch(console.error);

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
                            duration_ms: Math.round(recording.screenSource.durationMs),
                            microphone_on: !!recording.microphoneSource,
                            camera_on: !!state.cameraVideo,
                            has_system_audio: recording.screenSource.hasAudio,
                            first_url: firstUrl,
                            recording_current_window: !!recording.screenSource.trackableContentRect,
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
                            success: true,
                        });
                    } catch { /* analytics should never break the app */ }

                    // Check if user needs to handle existing local projects
                    const { userId: currentUserId } = useUserStore.getState();
                    if (currentUserId) {
                        setTimeout(() => navigate(`/editor?projectId=${project.id}`), 1500);
                    } else {
                        // Not logged in — check for other unsynced local projects
                        LocalStorage.listProjects().then(async (allLocal) => {
                            const allSyncMeta = await LocalStorage.listSyncMeta();
                            const syncedIds = new Set(allSyncMeta.map(m => m.projectId));
                            const unsyncedOthers = allLocal.filter(
                                p => p.id !== project.id && !syncedIds.has(p.id)
                            );

                            if (unsyncedOthers.length === 0) {
                                setSyncPromptProjectId(project.id);
                            } else {
                                setExistingProjectsPrompt({
                                    newProjectId: project.id,
                                    projectIds: unsyncedOthers.map(p => p.id),
                                });
                            }
                        }).catch(() => {
                            setSyncPromptProjectId(project.id);
                        });
                    }
                })
                .catch((error) => {
                    console.error('[ImportPage] Storage failed:', error);
                    captureImportError(error, {
                        recordingId,
                        phase: 'storing',
                        bridgeStatus: state.status,
                        screenVideoSize: state.screenVideo?.size,
                        cameraVideoSize: state.cameraVideo?.size ?? undefined,
                        micAudioSize: state.micAudio?.size ?? undefined,
                    });
                    setStatus('error-storage');
                    setErrorDetails(error.message);

                    // --- Analytics: project_created (storage failure) ---
                    try {
                        const recording = state.recording!;
                        const events = recording.userEvents;
                        const { userId } = useUserStore.getState();

                        let firstUrl: string | null = null;
                        if (events.urlChanges.length > 0) {
                            try { firstUrl = new URL(events.urlChanges[0].url).hostname; } catch { /* skip */ }
                        }

                        trackProjectCreated({
                            duration_ms: Math.round(recording.screenSource.durationMs),
                            microphone_on: !!recording.microphoneSource,
                            camera_on: !!state.cameraVideo,
                            has_system_audio: recording.screenSource.hasAudio,
                            first_url: firstUrl,
                            recording_current_window: !!recording.screenSource.trackableContentRect,
                            user_id: userId,
                            user_event_count:
                                events.mouseClicks.length + events.keyboardEvents.length +
                                events.typingEvents.length + events.drags.length + events.hoveredCards.length,
                            has_click_events: events.mouseClicks.length > 0,
                            has_keyboard_events: events.keyboardEvents.length > 0,
                            has_typing_events: events.typingEvents.length > 0,
                            has_drag_events: events.drags.length > 0,
                            has_hovered_cards: events.hoveredCards.length > 0,
                            auto_zoom_count: 0,
                            auto_spotlight_count: 0,
                            screen_frame_rate: recording.screenSource.frameRate ?? null,
                            camera_frame_rate: recording.cameraSource?.frameRate ?? null,
                            success: false,
                            error: error.message,
                        });
                    } catch { /* analytics should never break the app */ }
                });
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

            // --- Analytics: project_created (extension bridge failure) ---
            try {
                const { userId } = useUserStore.getState();
                const recording = state.recording;
                const events = recording?.userEvents;

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
                    user_id: userId,
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
                    error: state.error ?? 'Extension bridge error',
                });
            } catch { /* analytics should never break the app */ }
        }
    }, [state, confirmHandoff]);

    const handleSignIn = async () => {
        setIsSigningIn(true);
        setSignInError(null);
        const result = await AuthManager.signInWithProvider('google');
        if (result.error) {
            setSignInError(result.error.message);
            setIsSigningIn(false);
        }
        // If no error, browser redirects to Google — on return, useAuthListener
        // picks up the session and the import page redirects to editor
    };

    const handleStartFresh = async () => {
        if (!existingProjectsPrompt) return;
        setIsDeleting(true);
        try {
            for (const id of existingProjectsPrompt.projectIds) {
                await LocalStorage.deleteProject(id);
            }
        } catch (e) {
            console.error('[ImportPage] Failed to delete existing projects:', e);
        }
        navigate(`/editor?projectId=${existingProjectsPrompt.newProjectId}`);
    };

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

            {/* Existing projects prompt — shown when not logged in and other local projects exist */}
            <Modal isOpen={!!existingProjectsPrompt} maxWidth="max-w-[400px]">
                <h2 className="text-lg font-semibold text-text-highlighted mb-2">
                    Existing Projects Found
                </h2>
                <p className="text-sm text-text-main mb-6">
                    You have {existingProjectsPrompt?.projectIds.length} existing project{existingProjectsPrompt?.projectIds.length !== 1 ? 's' : ''} on this device.
                    Sign in to sync them to the cloud, or overwrite.
                </p>

                {signInError && (
                    <div className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-sm text-xs mb-4">
                        {signInError}
                    </div>
                )}

                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={handleSignIn}
                        disabled={isSigningIn || isDeleting}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-surface-raised hover:bg-state-hover text-text-highlighted font-medium rounded-[var(--radius-interactive)] border border-border transition-colors disabled:opacity-50"
                    >
                        {isSigningIn ? (
                            <div className="h-4 w-4 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin" />
                        ) : (
                            <FcGoogle className="icon-lg" />
                        )}
                        <span>{isSigningIn ? 'Connecting...' : 'Continue with Google'}</span>
                    </button>
                    <Button
                        fullWidth
                        onClick={handleStartFresh}
                        disabled={isDeleting || isSigningIn}
                    >
                        {isDeleting ? 'Deleting...' : 'Overwrite'}
                    </Button>
                </div>
            </Modal>

            {/* Sync prompt — shown when not logged in and no other local projects */}
            <Modal isOpen={!!syncPromptProjectId} maxWidth="max-w-[400px]">
                <h2 className="text-lg font-semibold text-text-highlighted mb-2">
                    Project Ready
                </h2>
                <p className="text-sm text-text-main mb-6">
                    Sign in to sync your project to the cloud, or continue locally.
                </p>

                {signInError && (
                    <div className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-sm text-xs mb-4">
                        {signInError}
                    </div>
                )}

                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={handleSignIn}
                        disabled={isSigningIn}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-surface-raised hover:bg-state-hover text-text-highlighted font-medium rounded-[var(--radius-interactive)] border border-border transition-colors disabled:opacity-50"
                    >
                        {isSigningIn ? (
                            <div className="h-4 w-4 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin" />
                        ) : (
                            <FcGoogle className="icon-lg" />
                        )}
                        <span>{isSigningIn ? 'Connecting...' : 'Continue with Google'}</span>
                    </button>
                    <Button
                        fullWidth
                        onClick={() => navigate(`/editor?projectId=${syncPromptProjectId}`)}
                    >
                        Continue Locally
                    </Button>
                </div>
            </Modal>
        </div>
    );
}

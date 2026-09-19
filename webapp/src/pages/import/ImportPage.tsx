import { useState, useEffect, useRef } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useExtensionBridge } from './useExtensionBridge';
import { CloudProjectService } from '../../storage/cloudProjectService';
import { useSyncStatusStore } from '../../storage/syncStatusStore';
import { captureImportError } from '../../lib/sentry';
import { trackProjectCreated, trackImportPageLoaded, trackImportFailed, trackProjectCreationFailed, trackScreenshotCreated, rememberExtensionDistinctId, linkExtensionIdentity } from '../../analytics';
import { ScreenshotService, readScreenshotCapError } from '../../screenshot/screenshotService';
import { screenshotEditPath } from '../../lib/screenshotUrls';
import { useUserStore } from '../../auth/useUserStore';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { LogoLink, Button, Modal } from '@shared/components';
import { AuthModal } from '../../auth/AuthModal';
import { navigate } from '../../lib/navigate';
import { editorPath } from '../../lib/videoUrls';
import { invokeFunction } from '../../api/client';
import { CapRecoveryPanel } from './CapRecoveryPanel';
import { UserDefaultsService } from '../../storage/userDefaultsService';
import { resolveProjectDefaults } from '../../core/projectDefaults';
import type { ProjectSettings } from '@shared/types';
import type { StoredProjectDefaults } from '@shared/api';

/**
 * How long the import waits for the user's personal default settings
 * before building the project from the shipped defaults instead
 * (plans/user-default-project-settings §3.4). The fetch starts on page
 * load, so this only bites on a slow API — and never fails the import.
 */
const DEFAULTS_WAIT_MS = 3000;

type ImportStatus =
    | 'init'
    | 'receiving'
    | 'streaming'
    | 'uploading'
    | 'success'
    | 'error-no-id'
    | 'error-extension'
    | 'error-auth'
    | 'error-upload'
    | 'error-cap';

/**
 * project-create-v2's 403 { error: 'project_cap_reached', cap } (revamp
 * Step 4) — the only server refusal the import page branches on. Any
 * other error shape returns null and takes the generic failure path.
 */
async function readProjectCapError(error: unknown): Promise<{ cap: number | null } | null> {
    if (!(error instanceof FunctionsHttpError)) return null;
    const response = (error as { context?: unknown }).context;
    if (!(response instanceof Response)) return null;
    try {
        const body = await response.clone().json();
        return body?.error === 'project_cap_reached'
            ? { cap: typeof body.cap === 'number' ? body.cap : null }
            : null;
    } catch {
        return null;
    }
}


export function ImportPage() {
    const [status, setStatus] = useState<ImportStatus>('init');
    const [errorDetails, setErrorDetails] = useState<string | null>(null);
    // Must be a ref, not state: React state updates are not synchronous, so under
    // StrictMode's double-invoked mount effect both runs would read `false` and
    // start a second concurrent handoff — two ports streaming the same recording,
    // doubling the service worker's memory and encode work.
    const hasStartedRef = useRef(false);
    const [uploadPhase, setUploadPhase] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [capInfo, setCapInfo] = useState<{ cap: number | null; kind: 'project' | 'screenshot' } | null>(null);
    // The recovery panel switches workspaces; retries follow the store
    const storeWorkspaceId = useWorkspaceStore(s => s.workspaceId);

    // Auth modal state
    const [showAuthModal, setShowAuthModal] = useState(false);

    const { state, requestHandoff, confirmHandoff } = useExtensionBridge();

    // Get recording ID from URL, stripping any legacy "proj-" prefix
    const params = new URLSearchParams(window.location.search);
    const recordingId = params.get('id')?.replace(/^proj-/, '') ?? null;
    // Screenshot handoff (plans/screenshots): the extension tags the URL so the
    // copy is right before metadata arrives; the bridge's `kind` is authoritative
    const isScreenshot = state.kind ? state.kind === 'screenshot' : params.get('kind') === 'screenshot';
    /** The handoff delivered everything the upload needs. */
    const hasPayload = state.kind === 'screenshot'
        ? !!(state.screenshot && state.image)
        : !!(state.recording && state.screenVideo);

    // Track page view once on mount
    useEffect(() => {
        trackImportPageLoaded({ recording_id: recordingId });
    }, []);

    // The handoff carries the extension's anonymous Mixpanel ID. Stash it, then link
    // it immediately if we already know who the user is — otherwise setUser() picks it
    // up when they sign in. Whichever happens last does the work.
    useEffect(() => {
        if (!state.extensionDistinctId) return;
        rememberExtensionDistinctId(state.extensionDistinctId);
        const { email } = useUserStore.getState();
        if (email) linkExtensionIdentity(email);
    }, [state.extensionDistinctId]);

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

        if (hasStartedRef.current) return;
        hasStartedRef.current = true;

        requestHandoff(recordingId);
        setStatus('receiving');
    }, [recordingId, requestHandoff]);

    // Handle handoff state changes
    useEffect(() => {
        if (state.status === 'streaming') {
            setStatus('streaming');
        }

        if (state.status === 'success' && hasPayload) {
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
            // `failureKind` distinguishes the failure modes that all used to look
            // identical (or, for stalls, produced no report at all): 'stall',
            // 'port-disconnected', 'stream-error', 'metadata'.
            const failureKind = state.failureKind ?? 'unknown';

            // Streaming failures self-report to Sentry from the bridge with timing
            // context; only the ones that didn't need capturing here.
            if (!state.failureKind) {
                captureImportError(
                    new Error(state.error || 'Extension bridge error'),
                    {
                        recordingId,
                        phase: 'receiving',
                        bridgeStatus: failureKind,
                        progress: state.progress ? {
                            bytesReceived: state.progress.bytesReceived,
                            totalBytes: state.progress.totalBytes,
                            chunksReceived: state.progress.chunksReceived,
                            totalChunks: state.progress.totalChunks,
                            source: state.progress.source,
                        } : null,
                    }
                );
            }

            setStatus('error-extension');
            setErrorDetails(state.error);

            const progress = state.progress;
            trackImportFailed({
                recording_id: recordingId,
                phase: 'extension',
                bridge_status: failureKind,
                error: state.error || 'Extension bridge error',
                is_offline: !navigator.onLine,
                bytes_received: progress?.bytesReceived ?? 0,
                total_bytes: progress?.totalBytes ?? 0,
                percent_complete: progress && progress.totalBytes > 0
                    ? Math.round((progress.bytesReceived / progress.totalBytes) * 100)
                    : 0,
                chunks_received: progress?.chunksReceived ?? 0,
                total_chunks: progress?.totalChunks ?? 0,
                stalled_source: progress?.source ?? null,
            });
            trackProjectCreatedFailure('extension');
        }
    }, [state]);

    // When auth completes after modal, retry upload
    const userId = useUserStore(s => s.userId);

    // Personal default settings: kick off the read as soon as we know who
    // the user is, so it's normally resolved before the blobs finish
    // streaming. Consumed (with a timeout) by resolveDefaultsForImport().
    const defaultsPromise = useRef<Promise<StoredProjectDefaults | null> | null>(null);
    useEffect(() => {
        if (userId && !defaultsPromise.current) {
            defaultsPromise.current = UserDefaultsService.fetchOrNull();
        }
    }, [userId]);

    /** Resolved settings for the new project + whether they came from the user's saved defaults. */
    async function resolveDefaultsForImport(): Promise<{ settings: ProjectSettings; personal: boolean }> {
        const pending = defaultsPromise.current ?? UserDefaultsService.fetchOrNull();
        defaultsPromise.current = pending;
        const stored = await Promise.race([
            pending,
            new Promise<null>(resolve => setTimeout(() => resolve(null), DEFAULTS_WAIT_MS)),
        ]);
        return { settings: resolveProjectDefaults(stored), personal: stored !== null };
    }
    useEffect(() => {
        if (showAuthModal && userId && state.status === 'success' && hasPayload) {
            setShowAuthModal(false);
            performUpload();
        }
    }, [userId, showAuthModal, state.status]);

    /** Shared preamble of both upload paths; null (after reporting) when no workspace resolves. */
    async function prepareUpload(phase: string): Promise<string | null> {
        // Reset any lingering sync-error state from a previous attempt
        useSyncStatusStore.getState().setIdle();

        setStatus('uploading');
        setUploadPhase(phase);
        setUploadProgress(0);

        let { workspaceId } = useWorkspaceStore.getState();
        if (!workspaceId) {
            // Workspace fetch may not have completed yet — resolve it now
            const { data } = await invokeFunction('workspace-get-default', {});
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
            return null;
        }
        return workspaceId;
    }

    async function performUpload() {
        if (state.kind === 'screenshot') return performScreenshotUpload();
        if (!state.recording || !state.screenVideo) return;

        const workspaceId = await prepareUpload('Saving project...');
        if (!workspaceId) return;

        try {
            // 1. Create project on server, get storage paths, cache blobs locally.
            //    Blobs are cached BEFORE the upload starts, so editor playback works
            //    immediately and a refresh mid-upload can resume from cache.
            const defaults = await resolveDefaultsForImport();
            const { project, name, slug, bucket, uploads } = await CloudProjectService.importRecordingLocalV2(
                state.recording,
                state.screenVideo,
                workspaceId,
                state.cameraVideo || undefined,
                state.micAudio || undefined,
                { defaultSettings: defaults.settings },
            );

            // 2. Kick off the cloud upload as fire-and-forget. Progress shows
            //    as an upload task: the editor header's badge and, back on
            //    the dashboard, the project card's; project-confirm-upload
            //    flips upload_status to 'ready' when done.
            const blobs: { fileType: string; blob: Blob }[] = [
                { fileType: 'screen', blob: state.screenVideo },
            ];
            if (state.cameraVideo) blobs.push({ fileType: 'camera', blob: state.cameraVideo });
            if (state.micAudio) blobs.push({ fileType: 'mic', blob: state.micAudio });

            CloudProjectService.startMediaUpload(project.id, name, bucket, uploads, blobs, slug);

            // 3. Navigate immediately — editor allows pending projects whose upload
            //    is active in this tab.
            setUploadProgress(100);
            setStatus('success');
            confirmHandoff(project.id);
            trackProjectCreatedSuccess(project, defaults.personal);
            navigate(editorPath(slug));
        } catch (error: any) {
            // The at-cap refusal is expected product behavior, not a failure —
            // no Sentry, dedicated recovery UI (revamp Step 4)
            const capRefusal = await readProjectCapError(error);
            if (capRefusal) {
                setCapInfo({ ...capRefusal, kind: 'project' });
                setStatus('error-cap');
                trackImportFailed({
                    recording_id: recordingId,
                    phase: 'cap',
                    error: 'project_cap_reached',
                    is_offline: !navigator.onLine,
                });
                return;
            }

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

    /**
     * Screenshot path (plans/screenshots Step 6): create the row, upload the
     * PNG (awaited — one small file), then open the editor. The cap refusal
     * gets the same recovery panel as projects, listing screenshots.
     */
    async function performScreenshotUpload() {
        const { screenshot, image } = state;
        if (!screenshot || !image) return;

        const workspaceId = await prepareUpload('Saving screenshot...');
        if (!workspaceId) return;

        const { userId: uid } = useUserStore.getState();
        let pageHost: string | null = null;
        try { pageHost = new URL(screenshot.page.url).hostname; } catch { /* file:// etc. */ }

        try {
            const result = await ScreenshotService.importScreenshot(
                screenshot,
                image,
                workspaceId,
                fraction => setUploadProgress(Math.round(fraction * 100)),
            );

            setUploadProgress(100);
            setStatus('success');
            confirmHandoff(result.id);
            trackScreenshotCreated({
                capture_mode: screenshot.captureMode,
                width_px: result.doc.source.widthPx,
                height_px: result.doc.source.heightPx,
                page_host: pageHost,
                user_id: uid,
                success: true,
            });
            navigate(screenshotEditPath(result.slug));
        } catch (error: unknown) {
            const capRefusal = await readScreenshotCapError(error);
            if (capRefusal) {
                setCapInfo({ ...capRefusal, kind: 'screenshot' });
                setStatus('error-cap');
                trackImportFailed({
                    recording_id: recordingId,
                    phase: 'cap',
                    error: 'screenshot_cap_reached',
                    is_offline: !navigator.onLine,
                });
                return;
            }

            console.error('[ImportPage] Screenshot import failed:', error);
            captureImportError(error, {
                recordingId,
                phase: 'uploading',
                bridgeStatus: state.status,
                extra: { kind: 'screenshot', imageSize: image.size },
            });
            const message = error instanceof Error && error.message ? error.message : 'Import failed';
            setStatus('error-upload');
            setErrorDetails(message);
            trackScreenshotCreated({
                capture_mode: screenshot.captureMode,
                width_px: screenshot.image.size.width,
                height_px: screenshot.image.size.height,
                page_host: pageHost,
                user_id: uid,
                success: false,
                error: message,
            });
        }
    }

    function trackProjectCreatedSuccess(
        project: { id: string; timeline: { zoomSegments: unknown[]; spotlightSegments: unknown[] } },
        usedPersonalDefaults: boolean,
    ) {
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
                used_personal_defaults: usedPersonalDefaults,
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
                used_personal_defaults: false,
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
                // Deliberately not "receiving"/"streaming": the transfer mechanics
                // are ours, not the user's — to them this is the app starting up.
                return 'Initializing';
            case 'uploading':
                return uploadPhase || 'Uploading...';
            case 'success':
                return 'Opening Editor...';
            case 'error-no-id':
                return isScreenshot ? 'No screenshot ID provided' : 'No recording ID provided';
            case 'error-extension':
                return isScreenshot ? 'Failed to receive screenshot' : 'Failed to receive recording';
            case 'error-auth':
                return 'Sign in required';
            case 'error-upload':
                return isScreenshot ? 'Failed to upload screenshot' : 'Failed to upload project';
            case 'error-cap':
                return isScreenshot ? 'Screenshot limit reached' : 'Project limit reached';
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
        <div className="min-h-screen bg-surface-body text-text-main">
            {/* Stands down while the auth modal is up so the two backdrops don't stack */}
            <Modal
                isOpen={!showAuthModal}
                maxWidth="max-w-[460px]"
                ariaLabel={isScreenshot ? 'Importing screenshot' : 'Importing recording'}
            >
                <div className="flex flex-col items-center text-center py-6 px-4">
                    <LogoLink imgClassName="h-8" className="mb-10" />

                    <div
                        role={isError ? 'alert' : 'status'}
                        className={`heading-2 ${isError ? 'text-destructive' : ''}`}
                    >
                        {getStatusMessage()}
                    </div>

                    {errorDetails && (
                        <div className="mt-2 text-xs text-text-muted">
                            {errorDetails}
                        </div>
                    )}

                    {/* Progress bar */}
                    {!isError && status !== 'success' && (
                        <div className="mt-8 w-full">
                            <div className="w-full h-2 bg-state-inactive rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-300 ease-out"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>

                            <div className="mt-2 text-label">
                                {progressPercent}%
                            </div>
                        </div>
                    )}

                    {status === 'error-cap' && capInfo && storeWorkspaceId && (
                        <CapRecoveryPanel
                            kind={capInfo.kind}
                            cap={capInfo.cap}
                            workspaceId={storeWorkspaceId}
                            onRetry={() => performUpload()}
                        />
                    )}

                    {isError && status !== 'error-cap' && (
                        <div className="mt-6 flex flex-col items-center gap-2">
                            {status === 'error-upload' && hasPayload && (
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
            </Modal>

            {/* Auth modal — shown when blobs are received but user is not logged in */}
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </div>
    );
}


/**
 * Screenshot editor bootstrap + layout (plans/screenshots Step 8):
 * resolve the slug, wait for auth, load the document and decode the
 * source image, then host the header / tool rail / canvas / inspector.
 * Export and share actions plug into the header in Steps 9–10.
 */
import { useEffect, useRef, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { AuthManager } from '../auth/AuthManager';
import { AuthPage } from '../auth/AuthPage';
import { useUserStore } from '../auth/useUserStore';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useSyncStatusStore } from '../storage/syncStatusStore';
import { navigate } from '../lib/navigate';
import { captureError } from '../lib/sentry';
import { SCREENSHOT_EDIT_PATH, screenshotViewPath } from '../lib/screenshotUrls';
import { trackScreenshotEditorLoaded } from '../analytics';
import { ScreenshotService } from './screenshotService';
import { flushScreenshotSave, replaceScreenshotDoc, useScreenshotStore } from './store/useScreenshotStore';
import { useScreenshotMetaStore } from './store/useScreenshotMetaStore';
import { useScreenshotUIStore } from './store/useScreenshotUIStore';
import { renderThumbnail } from './render/renderScreenshot';
import { useScreenshotShortcuts } from './useScreenshotShortcuts';
import { ScreenshotHeader } from './components/ScreenshotHeader';
import { ScreenshotToolbar } from './components/ScreenshotToolbar';
import { ScreenshotCanvas } from './components/ScreenshotCanvas';
import { ScreenshotInspector } from './components/ScreenshotInspector';
import { ScreenshotConflictModal } from './components/ScreenshotConflictModal';
import { ScreenshotExportActions } from './components/ScreenshotExportActions';
import { ScreenshotShareButton } from './components/ScreenshotShareButton';
import { ScreenshotZoomControls } from './components/ScreenshotZoomControls';
import { publishRenderIfNeeded } from './publish';

/** Decodes an object URL into a drawable image. */
function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to decode screenshot image'));
        img.src = url;
    });
}

export function ScreenshotEditor() {
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [loadingStatus, setLoadingStatus] = useState<string | null>('Loading screenshot...');
    const [loadError, setLoadError] = useState<string | null>(null);
    const [needsAuth, setNeedsAuth] = useState(false);
    const isAuthenticated = useUserStore(s => s.isAuthenticated);
    const lastSyncedAt = useSyncStatusStore(s => s.lastSyncedAt);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const scrollRef = useRef<HTMLElement | null>(null);

    useScreenshotShortcuts();

    // Signed in after the prompt: reload so the load effect runs against a session
    useEffect(() => {
        if (needsAuth && isAuthenticated) window.location.reload();
    }, [needsAuth, isAuthenticated]);

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;
        const slug = window.location.pathname.match(SCREENSHOT_EDIT_PATH)?.[1] ?? null;

        async function init() {
            if (!slug) {
                navigate('/', { replace: true });
                return;
            }
            await AuthManager.ready;
            if (cancelled) return;

            if (!useUserStore.getState().isAuthenticated) {
                setNeedsAuth(true);
                setLoadingStatus(null);
                return;
            }

            try {
                const result = await ScreenshotService.loadScreenshot({ slug }, setLoadingStatus);
                if (cancelled) {
                    if (result) URL.revokeObjectURL(result.imageUrl);
                    return;
                }
                if (!result) {
                    navigate(`/?error=${encodeURIComponent('Screenshot not found')}`, { replace: true });
                    return;
                }
                objectUrl = result.imageUrl;
                setLoadingStatus('Decoding image...');
                const img = await loadImage(result.imageUrl);
                if (cancelled) return;

                useSyncStatusStore.getState().setIdle();
                useScreenshotUIStore.getState().reset();
                replaceScreenshotDoc(result.doc, result.meta.name);
                useScreenshotMetaStore.getState().setMeta(result.meta);
                imageRef.current = img;
                setImage(img);
                setLoadingStatus(null);
                trackScreenshotEditorLoaded(useWorkspaceStore.getState().workspaceId, result.meta.id);

                // First thumbnail for rows that never had one (fresh imports)
                if (!result.meta.thumbnailStoragePath) {
                    renderThumbnail(img, result.doc)
                        .then(blob => ScreenshotService.saveThumbnail(result.meta.id, blob))
                        .catch(err => captureError(err, { flow: 'screenshot_thumbnail', phase: 'initial' }));
                }
            } catch (err) {
                if (cancelled) return;
                // A view-only member opening /edit: screenshot-get 403s → viewer
                if (err instanceof FunctionsHttpError && err.context?.status === 403) {
                    navigate(screenshotViewPath(slug), { replace: true });
                    return;
                }
                captureError(err, { flow: 'screenshot_load', extra: { slug } });
                setLoadError('Could not load this screenshot.');
                setLoadingStatus(null);
            }
        }

        init();
        return () => {
            cancelled = true;
            flushScreenshotSave();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            useScreenshotMetaStore.getState().clear();
            useScreenshotUIStore.getState().reset();
        };
    }, []);

    // After each successful save: refresh the dashboard thumbnail and, while
    // shared, re-publish the flattened render so the public page catches up
    useEffect(() => {
        const img = imageRef.current;
        const doc = useScreenshotStore.getState().doc;
        const meta = useScreenshotMetaStore.getState().meta;
        if (!lastSyncedAt || !img || !doc || !meta) return;
        renderThumbnail(img, doc)
            .then(blob => ScreenshotService.saveThumbnail(meta.id, blob))
            .catch(err => captureError(err, { flow: 'screenshot_thumbnail', phase: 'after_save' }));
        void publishRenderIfNeeded(img, doc);
    }, [lastSyncedAt]);

    if (needsAuth) {
        return <AuthPage />;
    }

    return (
        <div className="h-screen flex flex-col bg-surface-body text-text-main">
            <ScreenshotHeader>
                {image && <ScreenshotExportActions image={image} />}
                <ScreenshotShareButton image={image} />
            </ScreenshotHeader>

            <div className="flex-1 flex min-h-0">
                <ScreenshotToolbar />

                <div className="flex-1 min-w-0 relative flex">
                    <main ref={scrollRef} className="flex-1 min-w-0 overflow-auto scrollbar-thin bg-state-inactive p-6">
                        {loadingStatus && (
                            <p role="status" className="text-sm text-text-muted text-center">{loadingStatus}</p>
                        )}
                        {loadError && (
                            <p role="alert" className="text-sm text-destructive text-center">{loadError}</p>
                        )}
                        {image && <ScreenshotCanvas image={image} scrollContainerRef={scrollRef} />}
                    </main>
                    {image && <ScreenshotZoomControls />}
                </div>

                <ScreenshotInspector />
            </div>

            <ScreenshotConflictModal />
        </div>
    );
}

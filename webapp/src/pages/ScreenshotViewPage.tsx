/**
 * Public screenshot page — /screenshot/{slug} (plans/screenshots Step 10).
 * Mirrors VideoPage: the server returns a presigned URL of the flattened
 * RENDER only (never the source), or null when the owner hasn't published
 * yet; 403 → sign-in prompt for workspace-shared screenshots.
 *
 * Layout matches VideoPage: a full-bleed shell that renders immediately
 * (the image slot shows a loading placeholder, so nothing shifts once the
 * answer arrives), navigation at the header's far left and the account
 * menu (or a Sign in button) at its far right. The screenshot's own
 * actions — copy link, download — sit as icon buttons opposite the
 * title. The image fits the player's width cap, so a 16:9 capture sits
 * exactly where a video would; taller ones scroll. Signed-out viewers
 * get the "Try Recordio" promo in a flush side panel.
 *
 * Zoom: the editor's floating control (same range and step), view only.
 * The image sits in its own scroll area under the fixed title, so a
 * zoomed-in image scrolls both ways without dragging the title along;
 * each step keeps the point at the centre of that area in place.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { LuCheck, LuCopy, LuDownload, LuLock } from 'react-icons/lu';
import { LogoLink } from '@shared/components/LogoLink';
import { Button, LoadingLogo } from '@shared/components';
import type { SharedScreenshotGetResponse } from '@shared/api';
import { CHROME_EXTENSION_URL, MARKETING_ORIGIN } from '@shared/types/bridge';
import { AuthModal } from '../auth/AuthModal';
import { useUserStore } from '../auth/useUserStore';
import { NavDrawer, NavDrawerToggle } from '../components/NavDrawer';
import { SupportModal } from '../components/SupportModal';
import { UserMenu } from '../components/UserMenu';
import { useNavDrawerStore } from '../components/useNavDrawerStore';
import { ScreenshotStorage } from '../screenshot/api/screenshotStorage';
import { downloadBlob, exportFileName } from '../screenshot/export/exportScreenshot';
import { ZoomControls } from '../screenshot/components/ZoomControls';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from '../screenshot/store/useScreenshotUIStore';
import { screenshotUrl } from '../lib/screenshotUrls';
import { captureError } from '../lib/sentry';
import { trackScreenshotViewed, trackScreenshotViewFailed, trackScreenshotViewDownloaded } from '../analytics';

/** VideoPage's player width cap: a 16:9 box this wide fits above the fold */
const WIDTH_CAP = 'w-full max-w-[calc((100vh-11rem)*16/9)] mx-auto';

/**
 * 16:9 stand-in for the image while there is nothing to show — the same
 * dark media box as VideoPage's PlayerPlaceholder. `relative` so
 * LoadingLogo (absolute, full-parent) can fill it.
 */
function ImagePlaceholder({ children }: { children: ReactNode }) {
    return (
        <div className="relative aspect-video w-full bg-surface-media rounded-xl border border-border flex flex-col items-center justify-center gap-2 px-6 text-center">
            {children}
        </div>
    );
}

export function ScreenshotViewPage() {
    const [data, setData] = useState<SharedScreenshotGetResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [authRequired, setAuthRequired] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const isAuthenticated = useUserStore(s => s.isAuthenticated);

    // Display px per source px; null = fit to the width cap (fitEl's width).
    // fitEl is a state-held callback ref so the observer re-attaches when
    // the shell remounts (e.g. back from the sign-in screen).
    const [zoom, setZoom] = useState<number | null>(null);
    const [fitEl, setFitEl] = useState<HTMLDivElement | null>(null);
    const [fitWidth, setFitWidth] = useState(0);
    const stageRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    /** Image-relative point to hold under the stage centre across a zoom step */
    const zoomAnchorRef = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);

    const slug = window.location.pathname.split('/screenshot/')[1]?.split('/')[0]?.split('?')[0];

    // Signing in re-runs the fetch: the screenshot may be visible to the
    // now-authenticated viewer (workspace share) — the previous view stays
    // up until the answer arrives rather than flashing a spinner
    useEffect(() => {
        if (!slug) {
            setError('Invalid link');
            return;
        }
        let cancelled = false;
        ScreenshotStorage.sharedGet(slug)
            .then(result => {
                if (cancelled) return;
                setAuthRequired(false);
                setData(result);
                trackScreenshotViewed({ slug, published: result.imageUrl !== null, stale: result.stale });
            })
            .catch(err => {
                if (cancelled) return;
                const status = err instanceof FunctionsHttpError ? err.context?.status ?? null : null;
                if (status === 403) {
                    setAuthRequired(true);
                    return;
                }
                // 404 is a deleted/unknown slug — not a bug. Anything else
                // (5xx, network, parse) is, and would otherwise read as "not found".
                if (status !== 404) captureError(err, { flow: 'screenshot_view', phase: 'load', extra: { slug, status } });
                trackScreenshotViewFailed({
                    slug,
                    error: err instanceof Error ? err.message : String(err),
                    status,
                    is_offline: !navigator.onLine,
                });
                setError('Screenshot not found or has been removed');
            });
        return () => { cancelled = true; };
    }, [slug, isAuthenticated]);

    // Fit-to-width: track the width-capped measuring strip
    useLayoutEffect(() => {
        if (!fitEl) return;
        const update = () => setFitWidth(fitEl.clientWidth);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(fitEl);
        return () => observer.disconnect();
    }, [fitEl]);

    const fitScale = data ? fitWidth / Math.max(1, data.widthPx) : 0;
    const scale = zoom ?? fitScale;

    // Snapshot which point of the image sits under the stage centre, then
    // (below, after layout at the new scale) scroll it back there
    const zoomTo = (next: number | null) => {
        const stage = stageRef.current;
        const img = imgRef.current;
        if (stage && img) {
            const area = stage.getBoundingClientRect();
            const rect = img.getBoundingClientRect();
            const cx = area.left + area.width / 2;
            const cy = area.top + area.height / 2;
            zoomAnchorRef.current = { fx: (cx - rect.left) / rect.width, fy: (cy - rect.top) / rect.height, cx, cy };
        }
        setZoom(next === null ? null : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
    };
    useLayoutEffect(() => {
        const anchor = zoomAnchorRef.current;
        zoomAnchorRef.current = null;
        const stage = stageRef.current;
        const img = imgRef.current;
        if (!anchor || !stage || !img) return;
        const rect = img.getBoundingClientRect();
        stage.scrollLeft += rect.left + anchor.fx * rect.width - anchor.cx;
        stage.scrollTop += rect.top + anchor.fy * rect.height - anchor.cy;
    }, [scale]);

    const copyLink = async () => {
        if (!slug) return;
        try {
            await navigator.clipboard.writeText(screenshotUrl(slug));
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        } catch (err) {
            captureError(err, { flow: 'screenshot_view', phase: 'copy_link', extra: { slug } });
        }
    };

    const download = async () => {
        if (!data?.imageUrl || !slug || downloading) return;
        setDownloading(true);
        try {
            const response = await fetch(data.imageUrl);
            if (!response.ok) throw new Error(`Download failed: ${response.status}`);
            downloadBlob(await response.blob(), exportFileName(data.name, 'png'));
            trackScreenshotViewDownloaded({ slug, success: true });
        } catch (err) {
            // The presigned URL may have expired — a reload fetches a fresh one
            captureError(err, { flow: 'screenshot_view', phase: 'download', extra: { slug } });
            trackScreenshotViewDownloaded({ slug, success: false, error: err instanceof Error ? err.message : String(err) });
            window.open(data.imageUrl, '_blank');
        } finally {
            setDownloading(false);
        }
    };

    if (authRequired) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                    <LuLock size={32} className="text-text-muted" />
                    <h1 className="heading-2">Sign in to view this screenshot</h1>
                    <p className="text-sm text-text-muted">
                        This screenshot is only available to people it has been shared with.
                    </p>
                    <Button variant="primary" onClick={() => setIsAuthModalOpen(true)}>
                        Sign in
                    </Button>
                </div>
                <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                    <h1 className="heading-2">{error}</h1>
                    <p className="text-sm text-text-muted">
                        This screenshot may have been removed or the link may be incorrect.
                    </p>
                    <a href={MARKETING_ORIGIN} className="text-sm text-primary hover:text-primary-highlighted transition-colors">
                        Go to Recordio
                    </a>
                </div>
            </div>
        );
    }

    const openExtension = () => { window.open(CHROME_EXTENSION_URL, '_blank'); };

    // No data yet = loading: the same shell with an empty title and a
    // dark placeholder, so nothing shifts once the answer arrives
    return (
        <div className="h-screen bg-surface-body flex flex-col">
            {/* Header — nav at the far left, account menu / CTA at the far right */}
            <header className="h-header shrink-0 border-b border-border bg-surface flex items-center justify-between px-4">
                {/* Signed-out viewers have no library to navigate to */}
                {isAuthenticated ? <NavDrawerToggle onOpen={() => useNavDrawerStore.getState().open()} /> : <LogoLink />}
                {isAuthenticated ? (
                    <UserMenu onOpenSupportModal={() => setIsSupportModalOpen(true)} />
                ) : (
                    <Button variant="primary" onClick={() => setIsAuthModalOpen(true)}>
                        Sign in
                    </Button>
                )}
            </header>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
                <main className="flex-1 min-w-0 min-h-0 flex flex-col">
                    <div className="shrink-0 px-6 pt-5 pb-4 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            {/* Non-breaking spaces hold the two lines' height
                                while loading, so the image never shifts up */}
                            <h1 className="heading-2 truncate">{data?.name ?? ' '}</h1>
                            <p className="text-label mt-0.5">{data?.userName ?? ' '}</p>
                        </div>
                        {/* The accessible names stay fixed (tests select by
                            them); the copied state shows in the glyph + tooltip */}
                        <div className="flex items-center gap-1 shrink-0">
                            <Button
                                variant="ghost"
                                icon={linkCopied ? LuCheck : LuCopy}
                                onClick={() => void copyLink()}
                                aria-label="Copy link"
                                title={linkCopied ? 'Copied!' : 'Copy link'}
                            />
                            {data?.imageUrl && (
                                <Button
                                    variant="ghost"
                                    icon={LuDownload}
                                    onClick={() => void download()}
                                    disabled={downloading}
                                    aria-label="Download PNG"
                                    title={downloading ? 'Downloading…' : 'Download PNG'}
                                />
                            )}
                        </div>
                    </div>
                    {/* Positioning context: the zoom control floats over the
                        scroll area rather than scrolling with it */}
                    <div className="relative flex-1 min-h-0 flex">
                        <div ref={stageRef} className="flex-1 min-w-0 overflow-auto scrollbar-thin px-6 pb-6">
                            {/* Zero-height strip at VideoPage's player width
                                cap — its width is the fit-to-width size, so a
                                16:9 capture fits above the fold */}
                            <div ref={setFitEl} aria-hidden="true" className={`h-0 ${WIDTH_CAP}`} />
                            {!data ? (
                                <div className={WIDTH_CAP}>
                                    <ImagePlaceholder>
                                        <LoadingLogo text="Loading screenshot..." />
                                    </ImagePlaceholder>
                                </div>
                            ) : data.imageUrl ? (
                                // Auto margins (not justify-center) so a zoomed-in
                                // image overflows to the right and stays reachable
                                // by scrolling instead of clipping its left edge
                                <div className="w-full flex">
                                    {fitWidth > 0 && (
                                        <img
                                            ref={imgRef}
                                            src={data.imageUrl}
                                            alt={data.name}
                                            width={data.widthPx}
                                            height={data.heightPx}
                                            className="block shrink-0 mx-auto max-w-none h-auto rounded-xl border border-border"
                                            style={{ width: data.widthPx * scale }}
                                        />
                                    )}
                                </div>
                            ) : (
                                <div className={WIDTH_CAP}>
                                    <ImagePlaceholder>
                                        <span className="text-sm text-text-on-media">This screenshot hasn&apos;t been published yet</span>
                                        <span className="text-xs text-text-on-media/70">The owner needs to open it in the editor once to publish the image.</span>
                                    </ImagePlaceholder>
                                </div>
                            )}
                            {/* Sits under the image rather than over it, like
                                VideoPage's version strip */}
                            {data?.stale && data.imageUrl && (
                                <div className={`mt-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-2.5 ${WIDTH_CAP}`}>
                                    <p role="status" className="text-label">The owner has newer edits that aren&apos;t published yet.</p>
                                </div>
                            )}
                        </div>
                        {data?.imageUrl && fitWidth > 0 && (
                            <ZoomControls
                                scale={scale}
                                isFit={zoom === null}
                                canZoomOut={scale > MIN_ZOOM}
                                canZoomIn={scale < MAX_ZOOM}
                                onZoomOut={() => zoomTo(scale / ZOOM_STEP)}
                                onZoomIn={() => zoomTo(scale * ZOOM_STEP)}
                                onFit={() => zoomTo(null)}
                            />
                        )}
                    </div>
                </main>

                {/* Signed-out only — signed-in viewers already have the app.
                    Flush right like VideoPage's panel; stacks under the
                    image on narrow screens */}
                {!isAuthenticated && (
                    <aside
                        aria-label="Try Recordio"
                        className="w-full lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-surface p-4"
                    >
                        <div className="border border-primary/30 rounded-xl p-4 bg-primary/5">
                            <h3 className="text-sm font-bold text-text-highlighted mb-1">Capture and annotate free</h3>
                            <p className="text-xs text-text-muted mb-3">
                                Screenshots and screen recordings with <span className="text-primary">annotations</span> in seconds.
                            </p>
                            <Button variant="primary" onClick={openExtension}>
                                Try Recordio
                            </Button>
                        </div>
                    </aside>
                )}
            </div>

            <NavDrawer />
            <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
            <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
        </div>
    );
}

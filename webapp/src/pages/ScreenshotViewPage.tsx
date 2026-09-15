/**
 * Public screenshot page — /screenshot/{slug} (plans/screenshots Step 10).
 * Mirrors VideoPage: the server returns a presigned URL of the flattened
 * RENDER only (never the source), or null when the owner hasn't published
 * yet; 403 → sign-in prompt for workspace-shared screenshots.
 */
import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { LuCopy, LuDownload, LuLock } from 'react-icons/lu';
import { LogoLink } from '@shared/components/LogoLink';
import { Button } from '@shared/components';
import type { SharedScreenshotGetResponse } from '@shared/api';
import { CHROME_EXTENSION_URL, MARKETING_ORIGIN } from '@shared/types/bridge';
import { ThemeToggle } from '../theme/ThemeToggle';
import { AuthModal } from '../auth/AuthModal';
import { useUserStore } from '../auth/useUserStore';
import { ScreenshotStorage } from '../screenshot/api/screenshotStorage';
import { downloadBlob, exportFileName } from '../screenshot/export/exportScreenshot';
import { screenshotUrl } from '../lib/screenshotUrls';
import { trackScreenshotViewed } from '../analytics';

export function ScreenshotViewPage() {
    const [data, setData] = useState<SharedScreenshotGetResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [authRequired, setAuthRequired] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const isAuthenticated = useUserStore(s => s.isAuthenticated);

    const slug = window.location.pathname.split('/screenshot/')[1]?.split('/')[0]?.split('?')[0];

    // Signing in re-runs the fetch: the screenshot may be visible to the
    // now-authenticated viewer (workspace share)
    useEffect(() => {
        if (!slug) {
            setError('Invalid link');
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        ScreenshotStorage.sharedGet(slug)
            .then(result => {
                if (cancelled) return;
                setAuthRequired(false);
                setData(result);
                trackScreenshotViewed({ slug, published: result.imageUrl !== null, stale: result.stale });
            })
            .catch(err => {
                if (cancelled) return;
                if (err instanceof FunctionsHttpError && err.context?.status === 403) {
                    setAuthRequired(true);
                } else {
                    setError('Screenshot not found or has been removed');
                }
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [slug, isAuthenticated]);

    const copyLink = async () => {
        if (!slug) return;
        await navigator.clipboard.writeText(screenshotUrl(slug));
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
    };

    const download = async () => {
        if (!data?.imageUrl || downloading) return;
        setDownloading(true);
        try {
            const response = await fetch(data.imageUrl);
            if (!response.ok) throw new Error(`Download failed: ${response.status}`);
            downloadBlob(await response.blob(), exportFileName(data.name, 'png'));
        } catch {
            // The presigned URL may have expired — a reload fetches a fresh one
            window.open(data.imageUrl, '_blank');
        } finally {
            setDownloading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-text-muted">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">Loading screenshot...</span>
                </div>
            </div>
        );
    }

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

    if (error || !data) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                    <h1 className="heading-2">{error || 'Screenshot not found'}</h1>
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

    return (
        <div className="min-h-screen bg-surface-body flex flex-col">
            <header className="border-b border-border bg-surface">
                <div style={{ maxWidth: 1400 }} className="mx-auto flex items-center justify-between px-6 py-4">
                    <LogoLink />
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <Button variant="primary" onClick={() => { window.open(CHROME_EXTENSION_URL, '_blank'); }}>
                            Capture for free
                        </Button>
                    </div>
                </div>
            </header>

            <main className="flex-1 p-6">
                <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6">
                    <div className="flex-1 min-w-0 border border-border rounded-xl bg-surface p-5">
                        {/* Attribution */}
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                                {data.userName.slice(0, 2).toUpperCase()}
                            </div>
                            <p className="text-sm text-text-main">{data.userName}</p>
                        </div>

                        {data.imageUrl ? (
                            <img
                                src={data.imageUrl}
                                alt={data.name}
                                width={data.widthPx}
                                height={data.heightPx}
                                className="w-full h-auto rounded-xl border border-border bg-surface-body"
                            />
                        ) : (
                            <div className="relative w-full bg-surface-body rounded-xl border border-border" style={{ paddingTop: '56.25%' }}>
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                                    <span className="text-sm text-text-muted">This screenshot hasn't been published yet</span>
                                    <span className="text-xs text-text-disabled">The owner needs to open it in the editor once to publish the image.</span>
                                </div>
                            </div>
                        )}

                        <h1 className="mt-4 text-lg text-text-main">{data.name}</h1>
                        {data.stale && data.imageUrl && (
                            <p role="status" className="mt-1 text-label">The owner has newer edits that aren't published yet.</p>
                        )}
                    </div>

                    <div className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
                        <div className="border border-border rounded-xl p-5 bg-surface flex flex-col gap-2">
                            <Button fullWidth onClick={() => void copyLink()}>
                                <LuCopy className="icon-sm" />
                                {linkCopied ? 'Copied!' : 'Copy link'}
                            </Button>
                            {data.imageUrl && (
                                <Button fullWidth onClick={() => void download()} disabled={downloading}>
                                    <LuDownload className="icon-sm" />
                                    {downloading ? 'Downloading…' : 'Download PNG'}
                                </Button>
                            )}
                        </div>

                        <div className="border border-primary/30 rounded-xl p-5 bg-primary/5">
                            <h3 className="text-sm font-bold text-text-highlighted mb-1">Capture and annotate free</h3>
                            <p className="text-xs text-text-muted mb-3">
                                Screenshots and screen recordings with <span className="text-primary">annotations</span> in seconds.
                            </p>
                            <Button variant="primary" onClick={() => { window.open(CHROME_EXTENSION_URL, '_blank'); }}>
                                Try Recordio
                            </Button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

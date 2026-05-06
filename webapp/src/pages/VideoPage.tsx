import { useState, useEffect, useRef } from 'react';
import MuxPlayer from '@mux/mux-player-react';
import { LogoLink } from '@shared/components/LogoLink';
import { Button, ThemeToggle } from '@shared/components';
import { TbCopy } from 'react-icons/tb';
import { CHROME_EXTENSION_URL, MARKETING_ORIGIN } from '@shared/types/bridge';
import { supabase } from '../auth/AuthManager';
import { navigate } from '../navigate';

interface VideoPageData {
    status?: 'completed' | 'pending' | 'failed';
    name: string;
    userName: string;
    muxPlaybackId?: string;
}

const POLL_INTERVAL_MS = 5000;

export function VideoPage() {
    const [data, setData] = useState<VideoPageData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [linkCopied, setLinkCopied] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const slug = window.location.pathname.split('/video/')[1]?.split('/')[0]?.split('?')[0];

    const fetchVideo = async () => {
        if (!slug) return;
        const { data: result, error: fetchError } = await supabase?.functions.invoke('shared-video-get', {
            body: { slug },
        }) ?? { data: null, error: new Error('No supabase client') };

        if (fetchError || !result || result.error) {
            setError('Video not found or has been removed');
            setLoading(false);
            stopPolling();
            return;
        }

        const pageData = result as VideoPageData;
        setData(pageData);
        setLoading(false);

        // Stop polling once we have a terminal state
        if (pageData.status !== 'pending') {
            stopPolling();
        }
    };

    const stopPolling = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    };

    useEffect(() => {
        if (!slug) {
            setError('Invalid link');
            setLoading(false);
            return;
        }

        fetchVideo();

        // Start polling — will self-stop on terminal state
        pollRef.current = setInterval(fetchVideo, POLL_INTERVAL_MS);

        return () => stopPolling();
    }, [slug]);

    const copyLink = () => {
        navigator.clipboard.writeText(window.location.href);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-text-muted">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">Loading video...</span>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                    <h1 className="text-xl font-semibold text-text-main">{error || 'Video not found'}</h1>
                    <p className="text-sm text-text-muted">
                        This video may have been removed or the link may be incorrect.
                    </p>
                    <a
                        href={MARKETING_ORIGIN}
                        className="text-sm text-primary hover:text-primary-highlighted transition-colors"
                    >
                        Go to Recordio
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-surface-body flex flex-col">
            {/* Header */}
            <header className="border-b border-border bg-surface">
                <div style={{ maxWidth: 1400 }} className="mx-auto flex items-center justify-between px-6 py-4">
                    <LogoLink />
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => { window.open(CHROME_EXTENSION_URL, '_blank'); }}
                        >
                            Record for free
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="flex-1 p-6">
                <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6">
                    {/* Left column — Video */}
                    <div className="flex-1 min-w-0 border border-border rounded-xl bg-surface p-5">
                        {/* Attribution */}
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                                {data.userName.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                                <p className="text-sm font-medium text-text-main">{data.userName}</p>
                            </div>
                        </div>

                        {/* Player or status state */}
                        {data.status === 'completed' && data.muxPlaybackId ? (
                            <MuxPlayer
                                playbackId={data.muxPlaybackId}
                                streamType="on-demand"
                                style={{ width: '100%', borderRadius: '0.75rem', overflow: 'hidden' }}
                            />
                        ) : data.status === 'failed' ? (
                            <div className="relative w-full bg-surface-body rounded-xl border border-border flex items-center justify-center" style={{ paddingTop: '56.25%' }}>
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                                    <span className="text-sm text-red-500">Failed to process video</span>
                                    <span className="text-xs text-text-disabled">Please try sharing again.</span>
                                </div>
                            </div>
                        ) : data.status === 'pending' ? (
                            <div className="relative w-full bg-surface-body rounded-xl border border-border flex items-center justify-center" style={{ paddingTop: '56.25%' }}>
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                    <span className="text-sm text-text-muted">Preparing video...</span>
                                    <span className="text-xs text-text-disabled">This usually takes a minute.</span>
                                </div>
                            </div>
                        ) : (
                            <div className="relative w-full bg-surface-body rounded-xl border border-border flex items-center justify-center" style={{ paddingTop: '56.25%' }}>
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                                    <span className="text-sm text-text-muted">Could not find video</span>
                                </div>
                            </div>
                        )}

                        {/* Title */}
                        <h1 className="mt-4 text-lg font-medium text-text-main">{data.name}</h1>
                    </div>

                    {/* Right column — Sidebar */}
                    <div className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
                        <div className="border border-border rounded-xl p-5 bg-surface">
                            <Button size="sm" fullWidth onClick={copyLink}>
                                <TbCopy className="icon-sm" />
                                {linkCopied ? 'Copied!' : 'Copy link'}
                            </Button>
                        </div>

                        {/* Recordio ad card */}
                        <div className="border border-primary/30 rounded-xl p-5 bg-primary/5">
                            <h3 className="text-sm font-semibold text-text-highlighted mb-1">Record your screen free</h3>
                            <p className="text-xs text-text-muted mb-3">
                                Create beautiful demo videos with <span className="text-primary font-medium">auto zooms</span> from screen recordings in seconds.
                            </p>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => { window.open(CHROME_EXTENSION_URL, '_blank'); }}
                            >
                                Try Recordio
                            </Button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

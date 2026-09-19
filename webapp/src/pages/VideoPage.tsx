/**
 * Public watch page — /video/{slug}. One call, shared-video-get, polled
 * every 5s until the Mux video reaches a terminal state; 403 → sign-in
 * prompt for workspace/individually-shared videos. A completed video may
 * carry a transcript (output-time caption lines) rendered beside the
 * player — clicking a line seeks it.
 *
 * Layout: full-bleed. The header pins navigation to the far left and
 * actions to the far right; the player takes everything left of a
 * flush side panel. The panel is always there — transcript or an empty
 * state — plus the "Try Recordio" promo pinned underneath for signed-out
 * viewers only; signed-in viewers instead get an Edit button when the
 * server says they can (canEdit). On wide screens the panel collapses to
 * a rail so the video can take the full width; the choice sticks per
 * browser. Narrow screens stack the panel under the video and ignore it.
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import MuxPlayer, { type MuxPlayerRefAttributes } from '@mux/mux-player-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { LuCopy, LuLock, LuPanelRightClose, LuPanelRightOpen, LuPencil } from 'react-icons/lu';
import { LogoLink } from '@shared/components/LogoLink';
import { Button, LoadingLogo } from '@shared/components';
import type { SharedVideoGetResponse } from '@shared/api';
import { CHROME_EXTENSION_URL, MARKETING_ORIGIN } from '@shared/types/bridge';
import { ThemeToggle } from '../theme/ThemeToggle';
import { invokeFunction } from '../api/client';
import { AuthModal } from '../auth/AuthModal';
import { useUserStore } from '../auth/useUserStore';
import { navigate } from '../lib/navigate';
import { editorPath } from '../lib/videoUrls';
import { NavDrawer, NavDrawerToggle } from '../components/NavDrawer';
import { useNavDrawerStore } from '../components/useNavDrawerStore';
import { VideoTranscript } from '../components/VideoTranscript';

const POLL_INTERVAL_MS = 5000;
/** Per-browser convenience only — safe to lose; see the storage try/catch */
const PANEL_COLLAPSED_KEY = 'recordio_watch_panel_collapsed';

type PageState =
    | { kind: 'loading' }
    // 403 auth_required: a workspace/individually-shared video and the
    // viewer isn't signed in (or the token expired)
    | { kind: 'auth_required' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; data: SharedVideoGetResponse };

/** 16:9 stand-in for the player while there is nothing to play. */
function PlayerPlaceholder({ children }: { children: ReactNode }) {
    return (
        <div className="aspect-video w-full bg-surface-body rounded-xl border border-border flex flex-col items-center justify-center gap-3">
            {children}
        </div>
    );
}

export function VideoPage() {
    const slug = window.location.pathname.split('/video/')[1]?.split('/')[0]?.split('?')[0];

    const [state, setState] = useState<PageState>(() =>
        slug ? { kind: 'loading' } : { kind: 'error', message: 'Invalid link' });
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    // Player position in output ms — drives the transcript highlight
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [panelCollapsed, setPanelCollapsed] = useState(() => {
        try { return localStorage.getItem(PANEL_COLLAPSED_KEY) === '1'; } catch { return false; }
    });
    const setPanel = (collapsed: boolean) => {
        setPanelCollapsed(collapsed);
        try { localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* private mode etc. */ }
    };
    const isAuthenticated = useUserStore(s => s.isAuthenticated);
    const playerRef = useRef<MuxPlayerRefAttributes | null>(null);

    // The nav slides out over the video, so stop it first
    const openNav = () => {
        playerRef.current?.pause();
        useNavDrawerStore.getState().open();
    };

    // Polls until the video reaches a terminal state. Signing in re-runs
    // it: the video may be visible to the now-authenticated viewer
    // (workspace / individual share) — the previous view stays up until
    // the answer arrives rather than flashing a spinner.
    useEffect(() => {
        if (!slug) return;
        let cancelled = false;
        let poll: ReturnType<typeof setInterval> | null = null;
        const stopPolling = () => {
            if (poll) clearInterval(poll);
            poll = null;
        };

        const load = async () => {
            const { data, error } = await invokeFunction('shared-video-get', { slug });
            if (cancelled) return;

            if (error || !data) {
                stopPolling();
                if (error instanceof FunctionsHttpError && error.context.status === 403) {
                    setState({ kind: 'auth_required' });
                } else {
                    setState({ kind: 'error', message: 'Video not found or has been removed' });
                }
                return;
            }

            setState({ kind: 'ready', data });
            if (data.status !== 'pending') stopPolling();
        };

        load();
        poll = setInterval(load, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            stopPolling();
        };
    }, [slug, isAuthenticated]);

    const copyLink = () => {
        navigator.clipboard.writeText(window.location.href);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
    };

    const seekTo = (outputMs: number) => {
        const player = playerRef.current;
        if (!player) return;
        player.currentTime = outputMs / 1000;
        setCurrentTimeMs(outputMs);
        // A click is a user gesture, so play() is allowed; swallow the
        // rare rejection (e.g. the source is still attaching)
        Promise.resolve(player.play()).catch(() => {});
    };

    if (state.kind === 'loading') {
        return (
            <div className="relative min-h-screen bg-surface">
                <LoadingLogo text="Loading video..." />
            </div>
        );
    }

    if (state.kind === 'auth_required') {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                    <LuLock size={32} className="text-text-muted" />
                    <h1 className="heading-2">Sign in to view this video</h1>
                    <p className="text-sm text-text-muted">
                        This video is only available to people it has been shared with.
                    </p>
                    <Button variant="primary" onClick={() => setIsAuthModalOpen(true)}>
                        Sign in
                    </Button>
                </div>
                <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
            </div>
        );
    }

    if (state.kind === 'error') {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                    <h1 className="heading-2">{state.message}</h1>
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

    const { data } = state;
    const captions = data.status === 'completed' ? data.captions : undefined;
    const openExtension = () => { window.open(CHROME_EXTENSION_URL, '_blank'); };

    return (
        <div className="h-screen bg-surface-body flex flex-col">
            {/* Header — nav at the far left, actions at the far right */}
            <header className="h-header shrink-0 border-b border-border bg-surface flex items-center justify-between px-4">
                {/* Signed-out viewers have no library to navigate to */}
                {isAuthenticated ? <NavDrawerToggle onOpen={openNav} /> : <LogoLink />}
                <div className="flex items-center gap-2">
                    <ThemeToggle />
                    <Button icon={LuCopy} onClick={copyLink}>
                        {linkCopied ? 'Copied!' : 'Copy link'}
                    </Button>
                    {data.canEdit && slug && (
                        <Button variant="primary" icon={LuPencil} onClick={() => navigate(editorPath(slug))}>
                            Edit
                        </Button>
                    )}
                    {!isAuthenticated && (
                        <Button variant="primary" onClick={openExtension}>
                            Record for free
                        </Button>
                    )}
                </div>
            </header>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
                {/* Video — as wide as the panel allows; on a short, wide
                    screen the width cap keeps a 16:9 player from pushing
                    below the fold (taller aspect ratios just scroll) */}
                <main className="flex-1 min-w-0 min-h-0 overflow-y-auto scrollbar-thin">
                    <div className="px-6 pt-5 pb-4">
                        <h1 className="heading-2 truncate">{data.name}</h1>
                        <p className="text-label mt-0.5">{data.userName}</p>
                    </div>
                    <div className="px-6 pb-6">
                        <div className="w-full max-w-[calc((100vh-11rem)*16/9)] mx-auto">
                            {data.status === 'completed' && data.muxPlaybackId ? (
                                <MuxPlayer
                                    ref={playerRef}
                                    playbackId={data.muxPlaybackId}
                                    streamType="on-demand"
                                    onTimeUpdate={() => setCurrentTimeMs((playerRef.current?.currentTime ?? 0) * 1000)}
                                    onSeeked={() => setCurrentTimeMs((playerRef.current?.currentTime ?? 0) * 1000)}
                                    style={{ width: '100%', borderRadius: '0.75rem', overflow: 'hidden' }}
                                />
                            ) : data.status === 'failed' ? (
                                <PlayerPlaceholder>
                                    <span className="text-sm text-destructive" role="alert">Failed to process video</span>
                                    <span className="text-xs text-text-disabled">Please try sharing again.</span>
                                </PlayerPlaceholder>
                            ) : data.status === 'pending' ? (
                                <PlayerPlaceholder>
                                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                    <span className="text-sm text-text-muted" role="status">Preparing video...</span>
                                    <span className="text-xs text-text-disabled">This usually takes a minute.</span>
                                </PlayerPlaceholder>
                            ) : (
                                <PlayerPlaceholder>
                                    <span className="text-sm text-text-muted">Could not find video</span>
                                </PlayerPlaceholder>
                            )}
                        </div>
                    </div>
                </main>

                {/* Side panel — flush right, full height; stacks under the
                    video on narrow screens, where the collapse is ignored
                    (the rail below is lg-only, so this stays reachable) */}
                <aside
                    aria-label="Video details"
                    className={`w-full lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-surface flex-col min-h-0 ${
                        panelCollapsed ? 'flex lg:hidden' : 'flex'
                    }`}
                >
                    <div className="flex items-center justify-between pl-5 pr-2 pt-2 pb-1 shrink-0">
                        <h2 className="text-sm font-bold text-text-highlighted">Transcript</h2>
                        <span className="hidden lg:block">
                            <Button
                                variant="ghost"
                                icon={LuPanelRightClose}
                                onClick={() => setPanel(true)}
                                aria-label="Hide panel"
                                title="Hide panel"
                            />
                        </span>
                    </div>

                    {captions ? (
                        <VideoTranscript
                            captions={captions}
                            currentTimeMs={currentTimeMs}
                            onSeek={seekTo}
                            className="flex-1"
                        />
                    ) : (
                        <p className="text-label px-5 py-2 flex-1">
                            {data.status === 'completed'
                                ? 'This video has no transcript.'
                                : 'The transcript appears once the video is ready.'}
                        </p>
                    )}

                    {/* Signed-out only — signed-in viewers already have the app */}
                    {!isAuthenticated && (
                        <div className="shrink-0 border-t border-border p-4">
                            <div className="border border-primary/30 rounded-xl p-4 bg-primary/5">
                                <h3 className="text-sm font-bold text-text-highlighted mb-1">Record your screen free</h3>
                                <p className="text-xs text-text-muted mb-3">
                                    Create beautiful demo videos with <span className="text-primary">auto zooms</span> from screen recordings in seconds.
                                </p>
                                <Button variant="primary" onClick={openExtension}>
                                    Try Recordio
                                </Button>
                            </div>
                        </div>
                    )}
                </aside>

                {/* Collapsed: a rail with the handle to pull the panel back out */}
                {panelCollapsed && (
                    <aside
                        aria-label="Video details (collapsed)"
                        className="hidden lg:flex w-11 shrink-0 border-l border-border bg-surface flex-col items-center pt-2"
                    >
                        <Button
                            variant="ghost"
                            icon={LuPanelRightOpen}
                            onClick={() => setPanel(false)}
                            aria-label="Show panel"
                            title="Show panel"
                        />
                    </aside>
                )}
            </div>

            <NavDrawer />
        </div>
    );
}

import { useState, useEffect, useRef } from 'react';
import { ShareService, type SharedVideo } from '../editor/services/ShareService';
import { LogoLink } from '@shared/components/LogoLink';
import { TbEyeCheck, TbClock, TbChartBar } from 'react-icons/tb';

/** Format seconds into m:ss */
function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface DailyData {
    date: string;
    views: number;
    minutesViewed: number;
}

interface DetailedAnalytics {
    views: number;
    minutesViewed: number;
    durationSeconds: number;
    daily?: DailyData[];
}

/** Simple SVG bar chart for daily views */
function ViewsChart({ daily }: { daily: DailyData[] }) {
    if (daily.length === 0) return null;

    const maxViews = Math.max(...daily.map(d => d.views), 1);
    const barWidth = Math.max(4, Math.floor(400 / daily.length) - 2);
    const chartHeight = 100;

    return (
        <div className="w-full overflow-x-auto">
            <svg
                width={daily.length * (barWidth + 2)}
                height={chartHeight + 20}
                className="text-primary"
            >
                {daily.map((d, i) => {
                    const barHeight = (d.views / maxViews) * chartHeight;
                    const x = i * (barWidth + 2);
                    const y = chartHeight - barHeight;
                    return (
                        <g key={d.date}>
                            <rect
                                x={x}
                                y={y}
                                width={barWidth}
                                height={barHeight}
                                fill="currentColor"
                                opacity={0.7}
                                rx={2}
                            >
                                <title>{`${d.date}: ${d.views} views, ${d.minutesViewed.toFixed(1)} min`}</title>
                            </rect>
                            {/* Show date label for first, last, and middle */}
                            {(i === 0 || i === daily.length - 1 || i === Math.floor(daily.length / 2)) && (
                                <text
                                    x={x + barWidth / 2}
                                    y={chartHeight + 14}
                                    fontSize={9}
                                    fill="var(--color-text-muted)"
                                    textAnchor="middle"
                                >
                                    {new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

/** Branded watch page for shared Recordio videos */
export function WatchPage() {
    const [sharedVideo, setSharedVideo] = useState<SharedVideo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
    const [analytics, setAnalytics] = useState<DetailedAnalytics | null>(null);
    const [editingTitle, setEditingTitle] = useState(false);
    const [editingDesc, setEditingDesc] = useState(false);
    const [titleValue, setTitleValue] = useState('');
    const [descValue, setDescValue] = useState('');
    const [saving, setSaving] = useState(false);
    const titleRef = useRef<HTMLInputElement>(null);
    const descRef = useRef<HTMLTextAreaElement>(null);

    // Extract share ID from path: /watch/{id}
    const shareId = window.location.pathname.split('/watch/')[1]?.split('/')[0]?.split('?')[0];

    useEffect(() => {
        if (!shareId) {
            setError('Invalid share link');
            setLoading(false);
            return;
        }

        ShareService.getSharedVideoById(shareId).then(video => {
            if (!video) {
                setError('Video not found or has been removed');
            } else {
                setSharedVideo(video);
                setTitleValue(video.project_name);
                setDescValue(video.description || '');

                // Check auth & ownership
                ShareService.getCurrentUserId().then(userId => {
                    if (userId) {
                        setIsAuthenticated(true);
                        if (userId === video.user_id) {
                            setIsOwner(true);
                            // Fetch detailed analytics
                            ShareService.getDetailedVideoAnalytics(video.cf_video_uid).then(data => {
                                if (data) setAnalytics(data);
                            });
                        }
                    }
                });
            }
            setLoading(false);
        }).catch(() => {
            setError('Failed to load video');
            setLoading(false);
        });
    }, [shareId]);

    const saveTitle = async () => {
        if (!sharedVideo || !titleValue.trim()) return;
        setSaving(true);
        const ok = await ShareService.updateSharedVideoMeta(sharedVideo.id, { project_name: titleValue.trim() });
        if (ok) {
            setSharedVideo({ ...sharedVideo, project_name: titleValue.trim() });
        }
        setEditingTitle(false);
        setSaving(false);
    };

    const saveDescription = async () => {
        if (!sharedVideo) return;
        setSaving(true);
        const ok = await ShareService.updateSharedVideoMeta(sharedVideo.id, { description: descValue.trim() });
        if (ok) {
            setSharedVideo({ ...sharedVideo, description: descValue.trim() });
        }
        setEditingDesc(false);
        setSaving(false);
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

    if (error || !sharedVideo) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                    <div className="text-4xl">🎬</div>
                    <h1 className="text-xl font-semibold text-text-main">{error || 'Video not found'}</h1>
                    <p className="text-sm text-text-muted">
                        This video may have been removed or the link may be incorrect.
                    </p>
                    <a
                        href="https://recordio.cc"
                        className="text-sm text-primary hover:text-primary-highlighted transition-colors"
                    >
                        ← Go to Recordio
                    </a>
                </div>
            </div>
        );
    }

    // Cloudflare Stream embed URL
    const cfEmbedUrl = `https://customer-${getCfCustomerSubdomain()}.cloudflarestream.com/${sharedVideo.cf_video_uid}/iframe?primaryColor=%236366f1`;

    return (
        <div className="min-h-screen bg-surface flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-border">
                <LogoLink
                    href={isAuthenticated ? '/' : 'https://recordio.cc'}
                    {...(!isAuthenticated ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                />
                <span className="text-xs text-text-muted">Shared Video</span>
            </header>

            {/* Video player + info */}
            <main className="flex-1 flex flex-col items-center p-6">
                <div className="w-full max-w-4xl">
                    {/* Player */}
                    <div className="relative w-full" style={{ paddingTop: '56.25%' /* 16:9 */ }}>
                        <iframe
                            src={cfEmbedUrl}
                            className="absolute inset-0 w-full h-full rounded-xl border border-border"
                            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                            allowFullScreen
                        />
                    </div>

                    {/* Title + description */}
                    <div className="mt-4">
                        {/* Title */}
                        {isOwner && editingTitle ? (
                            <input
                                ref={titleRef}
                                value={titleValue}
                                onChange={e => setTitleValue(e.target.value)}
                                onBlur={saveTitle}
                                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
                                className="w-full bg-transparent text-lg font-medium text-text-main border-b border-primary outline-none py-1"
                                autoFocus
                                disabled={saving}
                            />
                        ) : (
                            <div className="flex items-center justify-between">
                                <h1
                                    className={`text-lg font-medium text-text-main ${isOwner ? 'cursor-text hover:text-primary transition-colors' : ''}`}
                                    onClick={isOwner ? () => { setEditingTitle(true); setTimeout(() => titleRef.current?.select(), 0); } : undefined}
                                    title={isOwner ? 'Click to edit title' : undefined}
                                >
                                    {sharedVideo.project_name}
                                </h1>
                                <span className="text-xs text-text-muted shrink-0 ml-4">
                                    Shared via <a href="https://recordio.cc" className="text-primary hover:underline">Recordio</a>
                                </span>
                            </div>
                        )}

                        {/* Description */}
                        {isOwner && editingDesc ? (
                            <textarea
                                ref={descRef}
                                value={descValue}
                                onChange={e => setDescValue(e.target.value)}
                                onBlur={saveDescription}
                                onKeyDown={e => { if (e.key === 'Escape') setEditingDesc(false); }}
                                className="w-full bg-transparent text-sm text-text-main border border-border rounded-lg p-2 mt-2 outline-none focus:border-primary resize-y min-h-[60px]"
                                placeholder="Add a description..."
                                autoFocus
                                disabled={saving}
                                rows={3}
                            />
                        ) : (
                            <div
                                className={`mt-2 ${isOwner ? 'cursor-text' : ''}`}
                                onClick={isOwner ? () => { setEditingDesc(true); setTimeout(() => descRef.current?.focus(), 0); } : undefined}
                                title={isOwner ? 'Click to edit description' : undefined}
                            >
                                {sharedVideo.description ? (
                                    <p className="text-sm text-text-main whitespace-pre-wrap">{sharedVideo.description}</p>
                                ) : isOwner ? (
                                    <p className="text-sm text-text-muted italic hover:text-text-main transition-colors">
                                        Click to add a description...
                                    </p>
                                ) : null}
                            </div>
                        )}
                    </div>

                    {/* Owner-only analytics panel */}
                    {isOwner && (
                        <div className="mt-8 border border-border rounded-xl p-5 bg-state-inactive">
                            {/* "Only visible to you" banner */}
                            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
                                <TbEyeCheck size={14} className="text-primary" />
                                <span className="text-xs text-text-muted">Only visible to you · analytics may be delayed up to a few hours</span>
                            </div>

                            {analytics ? (
                                <>
                                    {/* Stats row */}
                                    <div className="flex gap-6 mb-5">
                                        <div className="flex flex-col">
                                            <span className="text-2xl font-semibold text-text-highlighted">{analytics.views}</span>
                                            <span className="text-xs text-text-muted">Total views</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-2xl font-semibold text-text-highlighted">{analytics.minutesViewed.toFixed(1)}</span>
                                            <span className="text-xs text-text-muted">Minutes watched</span>
                                        </div>
                                        {analytics.durationSeconds > 0 && (
                                            <div className="flex flex-col">
                                                <span className="text-2xl font-semibold text-text-highlighted">
                                                    {analytics.views > 0
                                                        ? formatDuration((analytics.minutesViewed * 60) / analytics.views)
                                                        : '—'
                                                    }
                                                </span>
                                                <span className="text-xs text-text-muted">
                                                    Avg watch time{analytics.durationSeconds > 0 ? ` / ${formatDuration(analytics.durationSeconds)}` : ''}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Daily views chart */}
                                    {analytics.daily && analytics.daily.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-2 mb-3">
                                                <TbChartBar size={14} className="text-text-muted" />
                                                <span className="text-xs font-medium text-text-main">Daily views (last 30 days)</span>
                                            </div>
                                            <ViewsChart daily={analytics.daily} />
                                        </div>
                                    )}

                                    {analytics.views === 0 && (
                                        <p className="text-sm text-text-muted text-center py-4">
                                            No views yet. Share the link to start tracking!
                                        </p>
                                    )}
                                </>
                            ) : (
                                <div className="flex items-center justify-center py-6 text-text-muted">
                                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                                    <span className="text-sm">Loading analytics...</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

/**
 * Get the CF customer subdomain. In production this would be set via env var.
 * Cloudflare Stream embed URLs follow the pattern:
 * https://customer-{subdomain}.cloudflarestream.com/{videoUid}/iframe
 */
function getCfCustomerSubdomain(): string {
    return import.meta.env.VITE_CF_CUSTOMER_SUBDOMAIN || 'placeholder';
}

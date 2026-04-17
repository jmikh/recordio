import { useState, useEffect, useRef } from 'react';
import { ShareService, type SharedVideo } from '../editor/services/ShareService';
import { LogoLink } from '@shared/components/LogoLink';
import { Button } from '@shared/components/Button';
import { ThemeToggle } from '@shared/components';
import { TbCopy } from 'react-icons/tb';
import { CHROME_EXTENSION_URL } from '@shared/types/bridge';



/** Get initials from a name string */
function getInitials(name: string): string {
    return name
        .split(' ')
        .map(w => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();
}

/** Branded watch page for shared Recordio videos */
export function WatchPage() {
    const [sharedVideo, setSharedVideo] = useState<SharedVideo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [linkCopied, setLinkCopied] = useState(false);

    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
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

    const copyLink = () => {
        if (!shareId) return;
        navigator.clipboard.writeText(ShareService.getShareUrl(shareId));
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
    const cfEmbedUrl = `https://customer-${getCfCustomerSubdomain()}.cloudflarestream.com/${sharedVideo.cf_video_uid}/iframe`;
    const creatorName = sharedVideo.creator_name || 'A Recordio user';
    const sharedDate = new Date(sharedVideo.created_at);

    return (
        <div className="min-h-screen bg-surface-body flex flex-col">
            {/* Header */}
            <header className="border-b border-border bg-surface">
                <div style={{ maxWidth: 1400 }} className="mx-auto flex items-center justify-between px-6 py-4">
                <LogoLink
                    href={isAuthenticated ? '/' : 'https://recordio.cc'}
                    {...(!isAuthenticated ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                />
                <div className="flex items-center gap-2">
                    <ThemeToggle />
                    {!isAuthenticated && (
                        <Button
                            size="sm"
                            onClick={() => { window.location.href = '/'; }}
                        >
                            Sign in
                        </Button>
                    )}
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => { window.open(CHROME_EXTENSION_URL, '_blank'); }}
                    >
                        Record for free →
                    </Button>
                </div>
                </div>
            </header>

            {/* Main content — two columns */}
            <main className="flex-1 p-6">
                <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6">
                    {/* Left column — Video + actions */}
                    <div className="flex-1 min-w-0 border border-border rounded-xl bg-surface p-5">
                        {/* Creator attribution */}
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                                {getInitials(creatorName)}
                            </div>
                            <div>
                                <p className="text-sm font-medium text-text-highlighted">
                                    {creatorName} shared a recording
                                </p>
                                <p className="text-xs text-text-muted">
                                    {sharedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                    {' · '}
                                    {sharedDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                                </p>
                            </div>
                        </div>

                        {/* Player */}
                        <div className="relative w-full" style={{ paddingTop: '56.25%' /* 16:9 */ }}>
                            <iframe
                                src={cfEmbedUrl}
                                className="absolute inset-0 w-full h-full rounded-xl border border-border"
                                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                                allowFullScreen
                            />
                        </div>

                        {/* Title */}
                        <div className="mt-4">
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
                                <h1
                                    className={`text-lg font-medium text-text-main ${isOwner ? 'cursor-text hover:text-primary transition-colors' : ''}`}
                                    onClick={isOwner ? () => { setEditingTitle(true); setTimeout(() => titleRef.current?.select(), 0); } : undefined}
                                    title={isOwner ? 'Click to edit title' : undefined}
                                >
                                    {sharedVideo.project_name}
                                </h1>
                            )}
                        </div>



                        {/* Description */}
                        <div className="mt-4">
                            {isOwner && editingDesc ? (
                                <textarea
                                    ref={descRef}
                                    value={descValue}
                                    onChange={e => setDescValue(e.target.value)}
                                    onBlur={saveDescription}
                                    onKeyDown={e => { if (e.key === 'Escape') setEditingDesc(false); }}
                                    className="w-full bg-transparent text-sm text-text-main border border-border rounded-lg p-2 outline-none focus:border-primary resize-y min-h-[60px]"
                                    placeholder="Add a description..."
                                    autoFocus
                                    disabled={saving}
                                    rows={3}
                                />
                            ) : (
                                <div
                                    className={`${isOwner ? 'cursor-text' : ''}`}
                                    onClick={isOwner ? () => { setEditingDesc(true); setTimeout(() => descRef.current?.focus(), 0); } : undefined}
                                    title={isOwner ? 'Click to edit description' : undefined}
                                >
                                    {sharedVideo.description ? (
                                        <p className="text-sm text-text-muted whitespace-pre-wrap">{sharedVideo.description}</p>
                                    ) : isOwner ? (
                                        <p className="text-sm text-text-muted italic hover:text-text-main transition-colors">
                                            Click to add a description...
                                        </p>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right column — Sidebar */}
                    <div className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
                        {/* Details card */}
                        <div className="border border-border rounded-xl p-5 bg-surface">
                            <h2 className="text-[11px] font-semibold tracking-wider text-text-muted uppercase mb-4">Details</h2>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-text-muted">Shared</span>
                                    <span className="text-text-highlighted">
                                        {sharedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                </div>
                                {sharedVideo.version > 1 && (
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-text-muted">Version</span>
                                        <span className="text-text-highlighted">v{sharedVideo.version}</span>
                                    </div>
                                )}
                            </div>
                            <Button size="sm" fullWidth onClick={copyLink} className="mt-4">
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
                                Try Recordio →
                            </Button>
                        </div>
                    </div>
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

import { useState, useEffect } from 'react';
import { ShareService, type SharedVideo } from '../editor/services/ShareService';

/** Branded watch page for shared Recordio videos */
export function WatchPage() {
    const [sharedVideo, setSharedVideo] = useState<SharedVideo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
            }
            setLoading(false);
        }).catch(() => {
            setError('Failed to load video');
            setLoading(false);
        });
    }, [shareId]);

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
            {/* Minimal header */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-border">
                <a href="https://recordio.cc" className="flex items-center gap-2 text-text-main hover:text-primary transition-colors">
                    <span className="text-lg font-semibold">Recordio</span>
                </a>
                <span className="text-xs text-text-muted">Shared Video</span>
            </header>

            {/* Video player */}
            <main className="flex-1 flex flex-col items-center justify-center p-6">
                <div className="w-full max-w-4xl">
                    <div className="relative w-full" style={{ paddingTop: '56.25%' /* 16:9 */ }}>
                        <iframe
                            src={cfEmbedUrl}
                            className="absolute inset-0 w-full h-full rounded-xl border border-border"
                            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                            allowFullScreen
                        />
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                        <h1 className="text-lg font-medium text-text-main">{sharedVideo.project_name}</h1>
                        <span className="text-xs text-text-muted">
                            Shared via <a href="https://recordio.cc" className="text-primary hover:underline">Recordio</a>
                        </span>
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

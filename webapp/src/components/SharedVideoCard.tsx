import { useState } from 'react';
import { TbCopy, TbTrash, TbExternalLink } from 'react-icons/tb';
import type { SharedVideo } from '../editor/services/ShareService';
import { ShareService } from '../editor/services/ShareService';
import { useToast } from '../editor/components/Toast';

interface SharedVideoCardProps {
    video: SharedVideo;
    onUnshare: (video: SharedVideo) => void;
}

export const SharedVideoCard = ({ video, onUnshare }: SharedVideoCardProps) => {
    const [isUnsharing, setIsUnsharing] = useState(false);
    const { addToast } = useToast();

    const shareUrl = ShareService.getShareUrl(video.id);

    const copyLink = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(shareUrl);
        addToast({ type: 'success', title: 'Link Copied', message: shareUrl });
    };

    const openLink = (e: React.MouseEvent) => {
        e.stopPropagation();
        window.open(shareUrl, '_blank');
    };

    return (
        <div
            className="group relative flex flex-col rounded-xl cursor-pointer transition-all border overflow-hidden p-4 aspect-[4/3] gap-3 bg-state-inactive border-border hover:border-border-hover hover:bg-state-hover hover:scale-[1.01] hover:shadow-lg"
            onClick={openLink}
        >
            {/* Unshare Confirmation Overlay */}
            {isUnsharing && (
                <div
                    className="absolute inset-0 z-20 bg-black/85 flex flex-col items-center justify-center text-center p-4 animate-in fade-in duration-200"
                    onClick={(e) => e.stopPropagation()}
                >
                    <p className="text-sm text-text-highlighted mb-1">Remove shared link?</p>
                    <p className="text-xs text-text-muted mb-3">This will permanently delete the shared video</p>
                    <div className="flex space-x-3">
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsUnsharing(false); }}
                            className="px-3 py-1.5 text-xs text-text-main hover:text-text-highlighted bg-surface-raised hover:bg-surface-overlay rounded-md transition-colors border border-border"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onUnshare(video); }}
                            className="px-3 py-1.5 text-xs text-white bg-destructive hover:bg-destructive/90 rounded-md shadow-sm transition-colors"
                        >
                            Unshare
                        </button>
                    </div>
                </div>
            )}

            {/* Video Preview Placeholder */}
            <div className="bg-background rounded-lg overflow-hidden flex-1 w-full border border-border relative shadow-inner flex items-center justify-center">
                <div className="text-text-muted/50">
                    <svg className="w-12 h-12 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                </div>
                {/* Version badge */}
                {video.version > 1 && (
                    <div className="absolute bottom-2 right-2 bg-surface-body/90 backdrop-blur-sm text-text-highlighted text-[10px] px-1.5 py-0.5 rounded">
                        v{video.version}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="w-full min-w-0">
                <h3 className="font-normal truncate text-text-highlighted text-sm">{video.project_name}</h3>
                <div className="flex items-center text-xs text-text-main space-x-2 mt-1">
                    <span>{new Date(video.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
            </div>

            {/* Action buttons (hover) */}
            {!isUnsharing && (
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-2 group-hover:translate-y-0 z-10">
                    <button
                        onClick={copyLink}
                        title="Copy link"
                        className="p-1.5 rounded-md bg-surface-body/90 backdrop-blur-sm text-text-main hover:text-primary transition-colors border border-border"
                    >
                        <TbCopy size={14} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsUnsharing(true); }}
                        title="Unshare"
                        className="p-1.5 rounded-md bg-surface-body/90 backdrop-blur-sm text-text-main hover:text-destructive transition-colors border border-border"
                    >
                        <TbTrash size={14} />
                    </button>
                </div>
            )}
        </div>
    );
};

import { useState, useRef, useEffect } from 'react';
import { TbEye, TbCopy, TbExternalLink, TbInfoCircle } from 'react-icons/tb';
import type { SharedVideo, VideoAnalytics } from '../editor/services/ShareService';
import { timeAgo } from '../utils/timeAgo';
import { ShareService } from '../editor/services/ShareService';
import { useToast } from '../editor/components/Toast';
import { Tooltip } from '@shared/components/Tooltip';
import { CardCheckbox } from './CardCheckbox';

interface SharedVideoCardProps {
    video: SharedVideo;
    localProjectExists: boolean;
    analytics?: VideoAnalytics;
    selectMode?: boolean;
    selected?: boolean;
    onSelect?: () => void;
    onRename?: (newName: string) => void;
}

export const SharedVideoCard = ({ video, localProjectExists, analytics, selectMode = false, selected = false, onSelect, onRename }: SharedVideoCardProps) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(video.project_name);
    const inputRef = useRef<HTMLInputElement>(null);
    const { addToast } = useToast();

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const handleEditClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditName(video.project_name);
        setIsEditing(true);
    };

    const commitRename = () => {
        const trimmed = editName.trim();
        setIsEditing(false);
        if (trimmed && trimmed !== video.project_name) {
            onRename?.(trimmed);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitRename();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditName(video.project_name);
        }
    };

    const shareUrl = ShareService.getShareUrl(video.id);
    const thumbnailUrl = ShareService.getThumbnailUrl(video.cf_video_uid);
    const subdomain = import.meta.env.VITE_CF_CUSTOMER_SUBDOMAIN || 'placeholder';
    const embedUrl = `https://customer-${subdomain}.cloudflarestream.com/${video.cf_video_uid}/iframe?autoplay=true&controls=true`;

    const copyLink = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(shareUrl);
        addToast({ type: 'success', title: 'Link Copied', message: shareUrl });
    };

    const openWatchPage = (e: React.MouseEvent) => {
        e.stopPropagation();
        window.open(shareUrl, '_blank');
    };

    const openProject = (e: React.MouseEvent) => {
        e.stopPropagation();
        window.location.href = `/editor?projectId=${video.project_id}`;
    };

    const handlePlayClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPlaying(true);
    };

    const handleClick = () => {
        if (selectMode && onSelect) {
            onSelect();
        }
    };

    return (
        <div
            id="published-video-card"
            onClick={handleClick}
            className={`
                group relative flex flex-col rounded-xl transition-all border overflow-hidden p-4 gap-3 bg-surface-raised
                ${selectMode && selected
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-border hover:border-border-hover hover:scale-[1.01] hover:shadow-lg'
                }
                ${selectMode ? 'cursor-pointer' : ''}
            `}
        >
            {onSelect && (
                <CardCheckbox selectMode={selectMode} selected={selected} onSelect={onSelect} />
            )}

            {/* Video Preview */}
            <div className="bg-background rounded-lg overflow-hidden w-full aspect-video border border-border relative shadow-inner flex items-center justify-center">
                {isPlaying ? (
                    <iframe
                        src={embedUrl}
                        className="absolute inset-0 w-full h-full"
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                        style={{ border: 'none' }}
                    />
                ) : (
                    <>
                        <img
                            src={thumbnailUrl}
                            alt={video.project_name}
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        {/* Translucent play button */}
                        <button
                            onClick={handlePlayClick}
                            className="absolute inset-0 flex items-center justify-center z-[1] cursor-pointer"
                        >
                            <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center group-hover:bg-black/70 group-hover:scale-110 transition-all duration-200">
                                <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            </div>
                        </button>
                    </>
                )}
                {/* Version badge */}
                {!isPlaying && video.version > 1 && (
                    <div className="absolute bottom-2 right-2 bg-surface-body/90 backdrop-blur-sm text-text-highlighted text-[10px] px-1.5 py-0.5 rounded z-10">
                        v{video.version}
                    </div>
                )}
            </div>

            {/* Title + quick stats */}
            <div className="w-full min-w-0">
                <div className="flex items-center justify-between">
                    {isEditing ? (
                        <input
                            ref={inputRef}
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={handleKeyDown}
                            onClick={e => e.stopPropagation()}
                            className="font-normal text-sm text-text-highlighted bg-transparent border-b border-primary outline-none w-full mr-2"
                        />
                    ) : (
                        <h3
                            className={`font-normal truncate text-text-highlighted text-sm ${!selectMode && onRename ? 'cursor-text hover:text-primary transition-colors' : ''}`}
                            onClick={!selectMode && onRename ? handleEditClick : undefined}
                        >
                            {video.project_name}
                        </h3>
                    )}
                    <span className="text-xs text-text-muted shrink-0 ml-2">{timeAgo(video.updated_at)}</span>
                </div>
                <div className="flex items-center mt-1 gap-1">
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                        {analytics && analytics.views > 0 && (
                            <span className="flex items-center gap-1">
                                <TbEye size={12} />
                                {analytics.views}
                            </span>
                        )}
                        {localProjectExists ? (
                            <button
                                onClick={openProject}
                                title="Open project in editor"
                                className="text-xs text-text-muted hover:text-primary transition-colors cursor-pointer"
                            >
                                Open In Editor
                            </button>
                        ) : (
                            <span className="flex items-center gap-1 text-xs text-text-disabled">
                                No Project
                                <Tooltip text="The project was deleted from your computer or this video was recorded on a different device.">
                                    <TbInfoCircle size={13} className="text-text-disabled cursor-help" />
                                </Tooltip>
                            </span>
                        )}
                    </div>
                    <div className="flex-1" />
                    <Tooltip text="Copy share link">
                        <button onClick={copyLink} className="interactive-icon">
                            <TbCopy size={14} />
                        </button>
                    </Tooltip>
                    <Tooltip text="Open watch page">
                        <button onClick={openWatchPage} className="interactive-icon">
                            <TbExternalLink size={14} />
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
};

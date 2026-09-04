import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LuRotateCcw, LuEllipsis, LuPencil, LuTrash } from 'react-icons/lu';
import { TbShare2 } from 'react-icons/tb';
import { MdOutlineAutoDelete } from 'react-icons/md';
import { CardCheckbox } from './CardCheckbox';
import { CopyLinkButton } from '@shared/components';
import { timeAgo } from './timeAgo';
import { videoUrl } from '../../lib/videoUrls';
import type { SharePolicy } from '@shared/api';

/** Minimal project info needed for the card — works with both Project and ProjectListItem */
export interface ProjectCardData {
    id: string;
    name: string;
    thumbnail?: string | null;
    createdAt: Date | string;
    /** Duration in milliseconds (from output windows) */
    durationMs?: number | null;
    /** Permanent share slug (share-access model: every project has one) */
    shareSlug?: string | null;
    /** Visibility — the copy-link button only shows for workspace/public */
    sharePolicy?: SharePolicy | null;
    /** Granted to the viewer individually (not via workspace) — shows a tag */
    sharedWithMe?: boolean;
    /** ISO date when the project was soft-deleted (null = active) */
    deletedAt?: string | null;
    /** Last updated timestamp */
    updatedAt?: Date | string | null;
}

interface ProjectCardProps {
    project: ProjectCardData;
    isActive?: boolean;
    variant?: 'sidebar' | 'grid';
    onOpen: (project: ProjectCardData) => void;
    selectMode?: boolean;
    selected?: boolean;
    onSelect?: () => void;
    onRestore?: () => void;
    onRename?: (id: string, newName: string) => void;
    onDelete?: (id: string) => void;
    /** Opens share settings — pass only for projects the viewer owns */
    onShare?: (id: string) => void;
    showUpdatedAt?: boolean;
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0 && s === 0) return '0s';
    const parts = [];
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${s}s`);
    return parts.join(' ');
}

function daysUntil(dateStr: string): number {
    const now = Date.now();
    const target = new Date(dateStr).getTime();
    return Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
}

export const ProjectCard = ({
    project,
    isActive = false,
    variant = 'sidebar',
    onOpen,
    selectMode = false,
    selected = false,
    onSelect,
    onRestore,
    onRename,
    onDelete,
    onShare,
    showUpdatedAt = false,
}: ProjectCardProps) => {
    const isGrid = variant === 'grid';
    const isTrashed = !!project.deletedAt;

    const purgedays = project.deletedAt ? daysUntil(new Date(new Date(project.deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()) : null;
    // Every project has a slug now — the link is only meaningfully
    // shareable when the policy grants someone access to it
    const isSharedOut = project.sharePolicy === 'public' || project.sharePolicy === 'workspace';
    const shareUrl = isSharedOut && project.shareSlug ? videoUrl(project.shareSlug) : null;

    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(project.name);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    const handleClick = () => {
        if (isRenaming) return;
        if (selectMode && onSelect) {
            onSelect();
        } else {
            onOpen(project);
        }
    };

    const openMenu = (e: React.MouseEvent) => {
        e.stopPropagation();
        const button = menuButtonRef.current;
        if (button) {
            const rect = button.getBoundingClientRect();
            setMenuPosition({ top: rect.bottom + 4, left: rect.right - 160 });
        }
        setMenuOpen(true);
    };

    const closeMenu = () => {
        setMenuOpen(false);
    };

    useEffect(() => {
        if (!menuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                closeMenu();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen]);

    useEffect(() => {
        if (isRenaming && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [isRenaming]);

    const handleRename = () => {
        closeMenu();
        setRenameValue(project.name);
        setIsRenaming(true);
    };

    const commitRename = () => {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== project.name) {
            onRename?.(project.id, trimmed);
        }
        setIsRenaming(false);
    };

    const hasMenu = !isTrashed && (onShare || onRename || onDelete);

    return (
        <div
            id="project-card"
            onClick={handleClick}
            className={`
                group relative flex bg-surface-raised flex-col rounded-xl cursor-pointer transition-all border overflow-hidden
                ${isGrid ? 'p-4 aspect-4/3 gap-3' : 'p-3'}
                ${selectMode && selected
                    ? 'border-primary ring-2 ring-primary/30'
                    : isActive
                        ? 'border-border-primary scale-[1.02]'
                        : 'border-border hover:border-border-hover hover:scale-[1.01] hover:shadow-lg'
                }
            `}
        >
            {onSelect && (
                <CardCheckbox selectMode={selectMode} selected={selected} onSelect={onSelect} />
            )}

            {/* Three-dot menu button — top right, visible on hover */}
            {hasMenu && !selectMode && (
                <button
                    ref={menuButtonRef}
                    type="button"
                    onClick={openMenu}
                    className="absolute top-2 right-2 z-10 hidden group-hover:flex items-center justify-center w-7 h-7 rounded-md bg-surface-body/80 backdrop-blur-sm text-text-muted hover:text-text-main hover:bg-surface-body transition-colors cursor-pointer"
                >
                    <LuEllipsis className="w-4 h-4" />
                </button>
            )}

            {/* Thumbnail */}
            <div className={`
                bg-background rounded-lg overflow-hidden shrink-0 border border-border relative shadow-inner
                ${isGrid ? 'flex-1 w-full mb-0' : 'w-full aspect-video mb-3'}
            `}>
                {project.thumbnail ? (
                    <img src={project.thumbnail} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-main/50 bg-surface/50">
                        <svg className={`${isGrid ? 'w-12 h-12' : 'w-8 h-8'} opacity-50`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </div>
                )}

                {/* Restore overlay for trashed projects — always pressable;
                    the free-tier press opens the upgrade modal upstream */}
                {isTrashed && onRestore && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRestore(); }}
                        className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer"
                    >
                        <LuRotateCcw className="w-4 h-4 text-white" />
                        <span className="text-white text-sm">Restore</span>
                    </button>
                )}

                {/* Duration Badge */}
                <div className="absolute bottom-2 right-2 bg-surface-body/90 backdrop-blur-sm text-text-highlighted text-badge px-1.5 py-0.5 rounded">
                    {formatDuration(project.durationMs ?? 0)}
                </div>
            </div>

            {/* Info */}
            <div className="w-full min-w-0 shrink-0">
                <div className="flex items-center justify-between">
                    {isRenaming ? (
                        <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={e => {
                                if (e.key === 'Enter') commitRename();
                                if (e.key === 'Escape') setIsRenaming(false);
                            }}
                            onClick={e => e.stopPropagation()}
                            className="text-text-highlighted text-sm min-w-0 mr-2 w-full bg-surface border border-primary rounded px-1 py-0 outline-none"
                        />
                    ) : (
                        <h3 className="truncate text-text-highlighted text-sm min-w-0 mr-2">
                            {project.name}
                        </h3>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                        {!isTrashed && (
                            <>
                                {shareUrl ? (
                                    <CopyLinkButton url={shareUrl} title="Copy published link" />
                                ) : (
                                    <span className="text-2xs text-text-muted">Private</span>
                                )}
                                {isActive && <span className="chosen-dot"></span>}
                            </>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-text-muted">
                        {showUpdatedAt && project.updatedAt
                            ? `Updated ${timeAgo(project.updatedAt)}`
                            : `Created ${timeAgo(project.createdAt)}`
                        }
                    </span>
                    {project.sharedWithMe && (
                        <span className="text-badge text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            Shared with you
                        </span>
                    )}
                    {isTrashed && purgedays !== null && (
                        <span className="flex items-center gap-1 text-xs text-destructive/70 ml-auto">
                            <MdOutlineAutoDelete className="w-3.5 h-3.5" />
                            {purgedays} {purgedays === 1 ? 'day' : 'days'}
                        </span>
                    )}
                </div>
            </div>

            {/* Context Menu Portal */}
            {menuOpen && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[9999] bg-surface-raised border border-border rounded-lg shadow-float py-1 px-1 min-w-[160px]"
                    style={{ top: menuPosition.top, left: menuPosition.left }}
                >
                    {onShare && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onShare(project.id); closeMenu(); }}
                            className="w-full text-left px-3 py-2 text-sm text-text-main hover:bg-state-hover rounded-md flex items-center gap-2 cursor-pointer"
                        >
                            <TbShare2 className="w-3.5 h-3.5" />
                            Share
                        </button>
                    )}
                    {onRename && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleRename(); }}
                            className="w-full text-left px-3 py-2 text-sm text-text-main hover:bg-state-hover rounded-md flex items-center gap-2 cursor-pointer"
                        >
                            <LuPencil className="w-3.5 h-3.5" />
                            Rename
                        </button>
                    )}
                    {onDelete && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDelete(project.id); closeMenu(); }}
                            className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-state-hover rounded-md flex items-center gap-2 cursor-pointer"
                        >
                            <LuTrash className="w-3.5 h-3.5" />
                            Delete
                        </button>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
};

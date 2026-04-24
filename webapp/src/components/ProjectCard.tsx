import { useState, useRef, useEffect } from 'react';
import { TbLink } from 'react-icons/tb';
import { CardCheckbox } from './CardCheckbox';
import { timeAgo } from '../utils/timeAgo';

/** Minimal project info needed for the card — works with both Project and ProjectListItem */
export interface ProjectCardData {
    id: string;
    name: string;
    thumbnail?: string | null;
    createdAt: Date | string;
    /** Duration string override (e.g. "2m 30s"). If not provided, computed from timeline. */
    durationLabel?: string;
    /** Full timeline — used to compute duration if durationLabel not provided */
    timeline?: { outputWindows?: Array<{ startMs: number; endMs: number }> };
}

interface ProjectCardProps {
    project: ProjectCardData;
    isActive?: boolean;
    variant?: 'sidebar' | 'grid';
    onOpen: (project: ProjectCardData) => void;
    selectMode?: boolean;
    selected?: boolean;
    onSelect?: () => void;
    isShared?: boolean;
    /** Whether this project only exists in the cloud (not cached locally) */
    cloudOnly?: boolean;
    /** Download progress (0–1) when downloading from cloud, null when not downloading */
    downloadProgress?: number | null;
    onRename?: (newName: string) => void;
}

export const ProjectCard = ({
    project,
    isActive = false,
    variant = 'sidebar',
    onOpen,
    selectMode = false,
    selected = false,
    onSelect,
    isShared = false,
    cloudOnly = false,
    downloadProgress = null,
    onRename
}: ProjectCardProps) => {
    const isGrid = variant === 'grid';
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(project.name);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const handleClick = () => {
        if (isEditing) return;
        if (selectMode && onSelect) {
            onSelect();
        } else {
            onOpen(project);
        }
    };

    const handleEditClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditName(project.name);
        setIsEditing(true);
    };

    const commitRename = () => {
        const trimmed = editName.trim();
        setIsEditing(false);
        if (trimmed && trimmed !== project.name) {
            onRename?.(trimmed);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitRename();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditName(project.name);
        }
    };

    return (
        <div
            id="project-card"
            onClick={handleClick}
            className={`
                group relative flex bg-surface-raised flex-col rounded-xl cursor-pointer transition-all border overflow-hidden
                ${isGrid ? 'p-4 aspect-[4/3] gap-3' : 'p-3'}
                ${selectMode && selected
                    ? 'border-primary ring-2 ring-primary/30'
                    : isActive
                        ? 'border-border-primary scale-[1.02]'
                        : 'border-border hover:border-border-hover  hover:scale-[1.01] hover:shadow-lg'
                }
            `}
        >
            {onSelect && (
                <CardCheckbox selectMode={selectMode} selected={selected} onSelect={onSelect} />
            )}

            {/* Thumbnail */}
            <div className={`
                bg-background rounded-lg overflow-hidden flex-shrink-0 border border-border relative shadow-inner
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

                {/* Duration Badge */}
                <div className="absolute bottom-2 right-2 bg-surface-body/90 backdrop-blur-sm text-text-highlighted text-[10px] px-1.5 py-0.5 rounded">
                    {project.durationLabel ?? (() => {
                        const windows = project.timeline?.outputWindows || [];
                        const ms = windows.reduce((acc, w) => acc + (w.endMs - w.startMs), 0);
                        const seconds = Math.floor(ms / 1000);
                        const m = Math.floor(seconds / 60);
                        const s = seconds % 60;

                        if (m === 0 && s === 0) return '0s';

                        const parts = [];
                        if (m > 0) parts.push(`${m}m`);
                        if (s > 0) parts.push(`${s}s`);
                        return parts.join(' ');
                    })()}
                </div>
                {/* Cloud-only indicator */}
                {cloudOnly && downloadProgress === null && (
                    <div className="absolute top-2 left-2 bg-surface-body/90 backdrop-blur-sm text-text-muted text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                        </svg>
                        Cloud
                    </div>
                )}
                {/* Download progress overlay */}
                {downloadProgress !== null && (
                    <div className="absolute inset-0 bg-surface-body/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-10">
                        <svg className="w-6 h-6 text-primary animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        <div className="w-3/4 h-1.5 bg-border rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${Math.round(downloadProgress * 100)}%` }} />
                        </div>
                        <span className="text-text-muted text-[10px]">Downloading {Math.round(downloadProgress * 100)}%</span>
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="w-full min-w-0 flex-shrink-0">
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
                        <div className="flex items-center gap-1 min-w-0 mr-2">
                            <h3
                                className={`font-normal truncate text-text-highlighted text-sm ${!selectMode && onRename ? 'cursor-text hover:text-primary transition-colors' : ''}`}
                                onClick={!selectMode && onRename ? handleEditClick : undefined}
                            >
                                {project.name}
                            </h3>
                        </div>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                        {isShared && (
                            <TbLink className="icon-sm text-primary" title="Published" />
                        )}
                        <span className="text-xs text-text-muted">{timeAgo(project.createdAt)}</span>
                        {isActive && <span className="chosen-dot"></span>}
                    </div>
                </div>
            </div>
        </div>
    );
};

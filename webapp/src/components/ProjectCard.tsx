import { useState, useRef, useEffect } from 'react';
import { TbLink, TbPencil } from 'react-icons/tb';
import type { Project } from '../types';
import { CardCheckbox } from './CardCheckbox';

function timeAgo(date: Date | string): string {
    const now = Date.now();
    const then = new Date(date).getTime();
    const seconds = Math.floor((now - then) / 1000);

    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

interface ProjectCardProps {
    project: Project;
    isActive?: boolean;
    variant?: 'sidebar' | 'grid';
    onOpen: (project: Project) => void;
    selectMode?: boolean;
    selected?: boolean;
    onSelect?: () => void;
    isShared?: boolean;
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
                    {(() => {
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
                            <h3 className="font-normal truncate text-text-highlighted text-sm">
                                {project.name}
                            </h3>
                            {!selectMode && onRename && (
                                <button
                                    onClick={handleEditClick}
                                    className="opacity-0 group-hover:opacity-100 transition-all duration-150 text-text-muted hover:text-text-main hover:scale-125 shrink-0 cursor-pointer"
                                    title="Rename"
                                >
                                    <TbPencil size={13} />
                                </button>
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                        {isShared && (
                            <TbLink size={13} className="text-primary" title="Published" />
                        )}
                        <span className="text-xs text-text-muted">{timeAgo(project.createdAt)}</span>
                        {isActive && <span className="chosen-dot"></span>}
                    </div>
                </div>
            </div>
        </div>
    );
};

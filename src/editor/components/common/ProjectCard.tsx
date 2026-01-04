import { useState } from 'react';
import type { Project } from '../../../core/types';

interface ProjectCardProps {
    project: Project;
    isActive?: boolean;
    variant?: 'sidebar' | 'grid';
    onOpen: (project: Project) => void;
    onRename: (project: Project, newName: string) => Promise<void>;
    onDelete: (project: Project) => Promise<void>;
}

export const ProjectCard = ({
    project,
    isActive = false,
    variant = 'sidebar',
    onOpen,
    onRename,
    onDelete
}: ProjectCardProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(project.name);

    const handleRenameSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        await onRename(project, editName);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleRenameSubmit();
        if (e.key === 'Escape') {
            setEditName(project.name);
            setIsEditing(false);
        }
    };

    const startRename = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditName(project.name);
        setIsEditing(true);
    };

    const isGrid = variant === 'grid';

    return (
        <div
            onClick={() => onOpen(project)}
            className={`
                group relative flex flex-col rounded-xl cursor-pointer transition-all border
                ${isGrid ? 'p-4 aspect-[4/3] gap-3' : 'p-3'}
                ${isActive
                    ? 'bg-indigo-900/30 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)] scale-[1.02]'
                    : 'bg-gray-800 border-gray-700 hover:border-gray-500 hover:scale-[1.01] hover:shadow-lg'
                }
            `}
        >
            {/* Thumbnail */}
            <div className={`
                bg-gray-900 rounded-lg overflow-hidden flex-shrink-0 border border-gray-700/50 relative shadow-inner
                ${isGrid ? 'flex-1 w-full mb-0' : 'w-full aspect-video mb-3'}
            `}>
                {project.thumbnail ? (
                    <img src={project.thumbnail} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 bg-gray-900/50">
                        <svg className={`${isGrid ? 'w-12 h-12' : 'w-8 h-8'} opacity-50`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </div>
                )}

                {/* Duration Badge */}
                <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
                    {(() => {
                        const ms = project.timeline?.durationMs || 0;
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
                {isEditing ? (
                    <div className="flex items-center mt-1" onClick={e => e.stopPropagation()}>
                        <input
                            type="text"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="bg-gray-900 text-white text-sm px-2 py-1.5 rounded-md border border-indigo-500 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            autoFocus
                            onKeyDown={handleKeyDown}
                        />
                        <button
                            onClick={() => handleRenameSubmit()}
                            className="ml-2 p-1 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/30 rounded"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col">
                        <div className="flex justify-between items-start">
                            <h3 className={`font-semibold truncate pr-2 ${isActive ? 'text-white' : 'text-gray-200'} ${isGrid ? 'text-base' : 'text-sm'}`}>
                                {project.name}
                            </h3>
                            {isActive && <span className="flex h-2 w-2 rounded-full bg-green-500 flex-shrink-0 mt-1.5 shadow-[0_0_5px_rgba(34,197,94,0.5)]"></span>}
                        </div>
                        <div className="flex items-center text-xs text-gray-500 space-x-2 mt-1">
                            <span>{new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Actions (Hover) */}
            {!isEditing && (
                <div className="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-2 group-hover:translate-y-0 z-10">
                    <div className="flex bg-gray-900/90 backdrop-blur-md rounded-lg shadow-lg border border-gray-700/50 p-1">
                        <button
                            onClick={startRename}
                            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md transition-colors"
                            title="Rename"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                        </button>
                        <div className="w-px bg-gray-700 mx-0.5 my-1"></div>
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(project); }}
                            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-900/30 rounded-md transition-colors"
                            title="Delete"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

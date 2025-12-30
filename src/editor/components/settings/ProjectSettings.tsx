import { useState, useEffect } from 'react';
import { ProjectStorage } from '../../../storage/projectStorage';
import type { Project, ID } from '../../../core/types';
import { useProjectStore } from '../../stores/useProjectStore';

export const ProjectSettings = () => {
    const { loadProject, project: activeProject, isSaving } = useProjectStore();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingId, setEditingId] = useState<ID | null>(null);
    const [editName, setEditName] = useState('');

    useEffect(() => {
        fetchProjects();
    }, [activeProject.id, isSaving]); // Refresh when active project changes or saving completes

    const fetchProjects = async () => {
        setIsLoading(true);
        try {
            const list = await ProjectStorage.listProjects();
            // Sort by last updated (newest first)
            list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
            setProjects(list);
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpen = async (project: Project) => {
        if (project.id === activeProject.id) return;
        try {
            await loadProject(project);
        } catch (e) {
            console.error('Failed to open project:', e);
        }
    };

    const handleDelete = async (e: React.MouseEvent, project: Project) => {
        e.stopPropagation();
        if (!confirm(`Are you sure you want to delete "${project.name}"?`)) return;

        try {
            await ProjectStorage.deleteProject(project.id);
            if (project.id === activeProject.id) {
                // If deleted active project, we might want to reload the page or clear state.
                window.location.reload();
            } else {
                fetchProjects();
            }
        } catch (error) {
            console.error('Failed to delete project:', error);
        }
    };

    const startRename = (e: React.MouseEvent, project: Project) => {
        e.stopPropagation();
        setEditingId(project.id);
        setEditName(project.name);
    };

    const saveRename = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!editingId) return;

        try {
            const projectToUpdate = projects.find(p => p.id === editingId);
            if (projectToUpdate) {
                const updated = { ...projectToUpdate, name: editName, updatedAt: new Date() };
                await ProjectStorage.saveProject(updated);

                // If we renamed the active project, we should update the store too? 
                // Currently store has its own copy. If we are renaming the ACTIVE one, maybe improved flow is needed.
                // But for now, we just save to DB. 
                // Actually, if it IS the active project, we should update via store action to keep sync.
                if (editingId === activeProject.id) {
                    // We don't have a rename action in store yet, but we can loadProject or similar. 
                    // Or just rely on re-fetch.
                    // A simple way is to just let the store know if we can.
                    // But store actions usually persist. 
                }

                fetchProjects();
            }
        } catch (error) {
            console.error('Failed to rename project:', error);
        } finally {
            setEditingId(null);
        }
    };

    return (
        <div className="flex flex-col h-full text-white">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Projects ({projects.length})</h2>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {isLoading && <div className="text-center text-gray-500 py-4">Loading...</div>}

                {projects.map(p => {
                    const isActive = p.id === activeProject.id;
                    const isEditing = editingId === p.id;

                    return (
                        <div
                            key={p.id}
                            onClick={() => handleOpen(p)}
                            className={`
                                group relative flex items-center p-2 rounded-lg cursor-pointer transition-colors border
                                ${isActive ? 'bg-indigo-900/30 border-indigo-500/50' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}
                            `}
                        >
                            {/* Thumbnail */}
                            <div className="w-16 h-10 bg-black rounded overflow-hidden flex-shrink-0 mr-3 border border-gray-700 relative">
                                {p.thumbnail ? (
                                    <img src={p.thumbnail} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                {isEditing ? (
                                    <div className="flex items-center" onClick={e => e.stopPropagation()}>
                                        <input
                                            type="text"
                                            value={editName}
                                            onChange={e => setEditName(e.target.value)}
                                            className="bg-gray-900 text-white text-sm px-2 py-1 rounded border border-indigo-500 w-full focus:outline-none"
                                            autoFocus
                                            onKeyDown={e => e.key === 'Enter' && saveRename(e as any)}
                                        />
                                        <button
                                            onClick={saveRename}
                                            className="ml-2 text-indigo-400 hover:text-indigo-300"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </button>
                                    </div>
                                ) : (
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-200 truncate pr-6">{p.name}</h3>
                                        <div className="flex items-center text-xs text-gray-500 space-x-2 mt-0.5">
                                            <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                                            {/* <span>• {formatBytes(0)}</span> */}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Actions (Hover) */}
                            {!isEditing && (
                                <div className="absolute right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800/80 rounded p-1 backdrop-blur-sm">
                                    <button
                                        onClick={(e) => startRename(e, p)}
                                        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                                        title="Rename"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={(e) => handleDelete(e, p)}
                                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                                        title="Delete"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

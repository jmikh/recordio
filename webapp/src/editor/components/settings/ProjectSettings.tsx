import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ProjectStorage } from '../../../storage/projectStorage';
import type { Project } from '../../../types';
import { useProjectStore } from '../../stores/useProjectStore';
import { ProjectCard } from '../../../components/ProjectCard';
import { TbInfoCircle, TbFolder } from 'react-icons/tb';

import { XButton, CollapsibleCard, type PreviewItem } from '@shared/components';

/** Compute total output duration in ms from a project's output windows */
const getProjectDurationMs = (p: Project): number => {
    const windows = p.timeline?.outputWindows || [];
    return windows.reduce((acc, w) => acc + (w.endMs - w.startMs), 0);
};

/** Format milliseconds as a concise duration string */
const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (h === 0 && m === 0 && s === 0) return '0s';

    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${s}s`);
    return parts.join(' ');
};

/** Format bytes as KB / MB / GB */
const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export const ProjectSettings = () => {
    const { project: activeProject, isSaving } = useProjectStore();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const [storageUsed, setStorageUsed] = useState<number | null>(null);

    // Merge live activeProject data into the projects list so the current project's
    // card reflects real-time changes (e.g., name updates) without waiting for storage refresh
    const displayProjects = useMemo(() => {
        const merged = projects.map(p =>
            p.id === activeProject.id ? { ...p, ...activeProject } : p
        );
        // Sort by most recently updated (newest first)
        merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return merged;
    }, [projects, activeProject]);

    // Metadata computed from all projects
    const totalDuration = useMemo(() => {
        return projects.reduce((acc, p) => acc + getProjectDurationMs(p), 0);
    }, [projects]);

    const otherProjectsCount = useMemo(() => {
        return projects.filter(p => p.id !== activeProject.id).length;
    }, [projects, activeProject.id]);

    useEffect(() => {
        fetchProjects();
        // Estimate IndexedDB-only storage usage
        ProjectStorage.estimateIndexedDBUsage().then(setStorageUsed).catch(console.error);
    }, [activeProject.id, isSaving]); // Refresh when active project changes or saving completes

    const fetchProjects = async () => {
        setIsLoading(true);
        try {
            const list = await ProjectStorage.listProjects();
            setProjects(list);
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpen = (project: Project) => {
        if (project.id === activeProject.id) return;
        const url = new URL(window.location.href);
        url.searchParams.set('projectId', project.id);
        window.location.href = url.toString();
    };

    const handleDelete = async (project: Project) => {
        try {
            await ProjectStorage.deleteProject(project.id);
            if (project.id === activeProject.id) {
                window.location.reload();
            } else {
                fetchProjects();
            }
        } catch (error) {
            console.error('Failed to delete project:', error);
        }
    };

    const handleDeleteAll = async () => {
        setIsDeleting(true);
        try {
            // Delete all projects EXCEPT the current one
            for (const project of projects) {
                if (project.id === activeProject.id) continue;
                await ProjectStorage.deleteProject(project.id);
            }
            setShowDeleteAllModal(false);
            setIsDeleting(false);
            fetchProjects();
        } catch (error) {
            console.error('Failed to delete projects:', error);
            setIsDeleting(false);
        }
    };


    return (
        <div className="flex flex-col gap-3 min-h-full text-white">
            {/* ── Metadata Collapsible ── */}
            <CollapsibleCard
                title="Metadata"
                icon={<TbInfoCircle size={16} />}
                defaultExpanded
                previewItems={[
                    ...(storageUsed != null ? [{ type: 'text', content: formatBytes(storageUsed) } as PreviewItem] : []),
                    { type: 'text', content: formatDuration(totalDuration) } as PreviewItem,
                ]}
            >
                <div className="flex flex-col gap-3">
                    {/* Stats */}
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-text-muted">Projects</span>
                            <span className="text-text-highlighted">{projects.length}</span>
                        </div>
                        {storageUsed != null && (
                            <div className="flex justify-between text-sm">
                                <span className="text-text-muted">Storage Used</span>
                                <span className="text-text-highlighted">{formatBytes(storageUsed)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm">
                            <span className="text-text-muted">Total Duration</span>
                            <span className="text-text-highlighted">{formatDuration(totalDuration)}</span>
                        </div>
                    </div>

                    {/* Delete All Button */}
                    {otherProjectsCount > 0 && (
                        <>
                            <button
                                onClick={() => setShowDeleteAllModal(true)}
                                className="interactive-base flex items-center justify-center gap-2 w-full text-destructive hover:text-white hover:bg-destructive/80"
                            >
                                Delete All Projects
                            </button>
                            <p className="subtext" style={{ textAlign: 'center' }}>Keeps current project</p>
                        </>
                    )}
                </div>
            </CollapsibleCard>

            {/* ── Projects Collapsible ── */}
            <CollapsibleCard
                title="Projects"
                icon={<TbFolder size={16} />}
                defaultExpanded
                previewItems={[
                    { type: 'text', content: `${projects.length} project${projects.length !== 1 ? 's' : ''}` } as PreviewItem,
                ]}
            >
                <div className="flex flex-col gap-3">
                    {/* Project List */}
                    {isLoading && <div className="text-center text-gray-500 py-4">Loading...</div>}

                    <div className="flex flex-col gap-2">
                        {displayProjects.map(p => (
                            <ProjectCard
                                key={p.id}
                                project={p}
                                isActive={p.id === activeProject.id}
                                variant="sidebar"
                                onOpen={handleOpen}
                                onDelete={p.id === activeProject.id ? undefined : handleDelete}
                            />
                        ))}
                    </div>
                </div>
            </CollapsibleCard>

            {/* Delete All Confirmation Modal */}
            {showDeleteAllModal && createPortal(
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[var(--z-index-modal)] backdrop-blur-sm p-4">
                    <div className="bg-surface-raised rounded-lg p-6 w-full max-w-[400px] border border-border">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-text-highlighted">Delete All Projects</h2>
                            <XButton
                                onClick={() => setShowDeleteAllModal(false)}
                                title="Close"
                            />
                        </div>

                        <p className="text-sm text-text-main mb-6">
                            Are you sure you want to delete <span className="text-text-highlighted font-medium">{otherProjectsCount}</span> project{otherProjectsCount !== 1 ? 's' : ''}? The current project will be kept. This action cannot be undone.
                        </p>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowDeleteAllModal(false)}
                                disabled={isDeleting}
                                className="interactive-base flex items-center justify-center gap-2"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteAll}
                                disabled={isDeleting}
                                className="px-3 py-1.5 text-xs text-white bg-destructive hover:bg-destructive/90 rounded-sm shadow-sm transition-colors disabled:opacity-50"
                            >
                                {isDeleting ? 'Deleting...' : 'Delete All'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

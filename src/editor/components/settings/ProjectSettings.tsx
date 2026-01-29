import { useState, useEffect, useMemo } from 'react';
import { ProjectStorage } from '../../../storage/projectStorage';
import type { Project } from '../../../core/types';
import { useProjectStore } from '../../stores/useProjectStore';
import { ProjectCard } from '../../../components/ui/ProjectCard';
import { Button } from '../../../components/ui/Button';
import { XButton } from '../../../components/ui/XButton';

export const ProjectSettings = () => {
    const { project: activeProject, isSaving } = useProjectStore();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Merge live activeProject data into the projects list so the current project's
    // card reflects real-time changes (e.g., name updates) without waiting for storage refresh
    const displayProjects = useMemo(() => {
        return projects.map(p =>
            p.id === activeProject.id ? { ...p, ...activeProject } : p
        );
    }, [projects, activeProject]);


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
                // If deleted active project, we might want to reload the page or clear state.
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
            // Delete all projects
            for (const project of projects) {
                await ProjectStorage.deleteProject(project.id);
            }
            // Redirect without projectId to avoid "project not found" error
            const url = new URL(window.location.href);
            url.searchParams.delete('projectId');
            window.location.href = url.toString();
        } catch (error) {
            console.error('Failed to delete all projects:', error);
            setIsDeleting(false);
        }
    };


    return (
        <div className="flex flex-col min-h-full text-white">
            {/* Delete All Button */}
            {projects.length > 0 && (
                <div className="mb-4">
                    <Button
                        onClick={() => setShowDeleteAllModal(true)}
                        className="w-full text-destructive hover:text-white hover:bg-destructive/80"
                    >
                        Delete All Projects
                    </Button>
                </div>
            )}

            <div className="flex-1 flex flex-col space-y-2">
                {isLoading && <div className="text-center text-gray-500 py-4">Loading...</div>}

                {displayProjects.map(p => (
                    <ProjectCard
                        key={p.id}
                        project={p}
                        isActive={p.id === activeProject.id}
                        variant="sidebar"
                        onOpen={handleOpen}
                        onDelete={handleDelete}
                    />
                ))}
            </div>

            {/* Delete All Confirmation Modal */}
            {showDeleteAllModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
                    <div className="bg-surface-raised rounded-lg p-6 w-full max-w-[400px] border border-border">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-text-highlighted">Delete All Projects</h2>
                            <XButton
                                onClick={() => setShowDeleteAllModal(false)}
                                title="Close"
                            />
                        </div>

                        <p className="text-sm text-text-main mb-6">
                            Are you sure you want to delete <span className="text-text-highlighted font-medium">{projects.length}</span> project{projects.length !== 1 ? 's' : ''}? This action cannot be undone.
                        </p>

                        <div className="flex gap-3 justify-end">
                            <Button
                                onClick={() => setShowDeleteAllModal(false)}
                                disabled={isDeleting}
                            >
                                Cancel
                            </Button>
                            <button
                                onClick={handleDeleteAll}
                                disabled={isDeleting}
                                className="px-3 py-1.5 text-xs text-white bg-destructive hover:bg-destructive/90 rounded-sm shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isDeleting ? 'Deleting...' : 'Delete All'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


import { useState, useEffect } from 'react';
import { ProjectStorage } from '../../../storage/projectStorage';
import type { Project } from '../../../core/types';
import { useProjectStore } from '../../stores/useProjectStore';
import { ProjectCard } from '../common/ProjectCard';

export const ProjectSettings = () => {
    const { project: activeProject, isSaving } = useProjectStore();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);

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

    const handleRename = async (project: Project, newName: string) => {
        try {
            const projectToUpdate = projects.find(p => p.id === project.id);
            if (projectToUpdate) {
                const updated = { ...projectToUpdate, name: newName, updatedAt: new Date() };
                await ProjectStorage.saveProject(updated);
                fetchProjects();
            }
        } catch (error) {
            console.error('Failed to rename project:', error);
        }
    };

    return (
        <div className="flex flex-col h-full text-white">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Projects ({projects.length})</h2>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {isLoading && <div className="text-center text-gray-500 py-4">Loading...</div>}

                {projects.map(p => (
                    <ProjectCard
                        key={p.id}
                        project={p}
                        isActive={p.id === activeProject.id}
                        variant="sidebar"
                        onOpen={handleOpen}
                        onRename={handleRename}
                        onDelete={handleDelete}
                    />
                ))}
            </div>
        </div>
    );
};


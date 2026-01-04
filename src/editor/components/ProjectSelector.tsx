import { useState, useEffect } from 'react';
import { ProjectStorage } from '../../storage/projectStorage';
import type { Project } from '../../core/types';
import { ProjectImpl } from '../../core/Project';
import { ProjectCard } from './common/ProjectCard';

interface ProjectSelectorProps {
    error?: string;
}

export const ProjectSelector = ({ error }: ProjectSelectorProps) => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        fetchProjects();
    }, []);

    const fetchProjects = async () => {
        setIsLoading(true);
        try {
            const list = await ProjectStorage.listProjects();
            // Sort by last updated (newest first)
            list.sort((a: Project, b: Project) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

            // Only show projects that are essentially non-empty or valid? 
            // For now show all.
            setProjects(list);
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpen = (project: Project) => {
        const url = new URL(window.location.href);
        url.searchParams.set('projectId', project.id);
        window.location.href = url.toString();
    };

    const handleCreateNew = async () => {
        try {
            const newProject = ProjectImpl.create('New Project');
            await ProjectStorage.saveProject(newProject);
            // Redirect to new project
            handleOpen(newProject);
        } catch (err) {
            console.error("Failed to create new project", err);
            alert("Failed to create project");
        }
    };

    const handleDelete = async (project: Project) => {
        if (!confirm(`Are you sure you want to delete "${project.name}"?`)) return;

        try {
            await ProjectStorage.deleteProject(project.id);
            fetchProjects();
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
        <div className="w-full h-screen bg-[#1e1e1e] flex items-center justify-center text-white flex-col overflow-y-auto">
            <div className="w-full max-w-4xl p-8 flex flex-col gap-6">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">Recordo Projects</h1>
                        <p className="text-gray-400 mt-1">Select a project to continue editing</p>
                    </div>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="bg-red-900/30 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg flex items-center gap-3">
                        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{error}</span>
                    </div>
                )}

                {/* Loading State */}
                {isLoading && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-gray-800 h-48 rounded-xl"></div>
                        ))}
                    </div>
                )}

                {/* Project Grid */}
                {!isLoading && (
                    <>
                        {projects.length === 0 ? (
                            <div className="text-center py-12 text-gray-500 border border-dashed border-gray-700 rounded-xl">
                                <p className="text-lg">No projects found.</p>
                                <button onClick={handleCreateNew} className="text-indigo-400 hover:text-indigo-300 mt-2 underline">Create one now</button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {projects.map(p => (
                                    <ProjectCard
                                        key={p.id}
                                        project={p}
                                        variant="grid"
                                        onOpen={handleOpen}
                                        onRename={handleRename}
                                        onDelete={handleDelete}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

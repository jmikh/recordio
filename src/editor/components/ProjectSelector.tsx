import { useState, useEffect } from 'react';
import { ProjectStorage } from '../../storage/projectStorage';
import type { Project } from '../../core/types';

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



    const handleDelete = async (project: Project) => {
        try {
            await ProjectStorage.deleteProject(project.id);
            fetchProjects();
        } catch (error) {
            console.error('Failed to delete project:', error);
        }
    };


    return (
        <div className="w-full h-screen bg-[#1e1e1e] flex flex-col overflow-hidden text-white">
            {/* Header - Fixed */}
            <div className="w-full flex justify-center shrink-0">
                <div className="w-full max-w-4xl p-8 pb-4 flex flex-col gap-6">
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
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto w-full">
                <div className="flex justify-center">
                    <div className="w-full max-w-4xl p-8 pt-2">
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
                                        <p className="text-lg mb-2">No projects found.</p>
                                        <p className="text-gray-400">
                                            To create a new project, start a recording via the Recordo extension.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {projects.map(p => (
                                            <ProjectCard
                                                key={p.id}
                                                project={p}
                                                variant="grid"
                                                onOpen={handleOpen}
                                                onDelete={handleDelete}
                                            />
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

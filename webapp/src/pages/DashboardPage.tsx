import { useState, useEffect } from 'react';
import { ProjectStorage } from '../storage/projectStorage';
import type { Project } from '../types';
import { ProjectCard } from '../components/ProjectCard';
import { LogoLink } from '@shared/components';

export function DashboardPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        try {
            const allProjects = await ProjectStorage.listProjects();
            // Sort by updatedAt descending
            allProjects.sort((a: Project, b: Project) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
            setProjects(allProjects);
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpen = (projectId: string) => {
        window.location.href = `/editor?projectId=${projectId}`;
    };

    const handleDelete = async (projectId: string) => {
        if (!confirm('Are you sure you want to delete this project?')) return;

        try {
            await ProjectStorage.deleteProject(projectId);
            setProjects(prev => prev.filter(p => p.id !== projectId));
        } catch (error) {
            console.error('Failed to delete project:', error);
        }
    };

    return (
        <div className="min-h-screen bg-surface-base text-text-main">
            {/* Header */}
            <header className="border-b border-border px-6 py-4 flex items-center justify-between">
                <LogoLink />
                <div className="text-text-muted text-sm">
                    {projects.length} project{projects.length !== 1 ? 's' : ''}
                </div>
            </header>

            {/* Content */}
            <main className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-text-muted">Loading projects...</div>
                    </div>
                ) : projects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-center">
                        <div className="text-text-muted mb-2">No projects yet</div>
                        <div className="text-text-muted text-sm">
                            Record something with the extension to get started
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {projects.map(project => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                onOpen={() => handleOpen(project.id)}
                                onDelete={() => handleDelete(project.id)}
                            />
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

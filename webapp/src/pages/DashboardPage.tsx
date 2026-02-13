import { useState, useEffect } from 'react';
import { ProjectStorage } from '../storage/projectStorage';
import type { Project } from '../types';
import { ProjectCard } from '../components/ProjectCard';
import { LogoLink, DefaultButton } from '@shared/components';
import { BiSupport } from 'react-icons/bi';
import { MdDarkMode, MdLightMode } from 'react-icons/md';
import { useUserStore } from '../editor/stores/useUserStore';

export function DashboardPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const { theme, setTheme } = useUserStore();

    useEffect(() => {
        // Check for error message in URL
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error) {
            setErrorMessage(error);
            // Clear the error from URL without reload
            window.history.replaceState({}, '', window.location.pathname);
        }

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
        <div className="min-h-screen bg-surface-body text-text-main">
            {/* Header */}
            <header className="border-b border-border">
                <div style={{ maxWidth: 1400 }} className="mx-auto px-6 py-4 flex items-center justify-between">
                    <LogoLink />
                    <div className="flex items-center gap-3">
                        <div className="text-text-muted text-sm">
                            {projects.length} project{projects.length !== 1 ? 's' : ''}
                        </div>
                        <a href="mailto:support@recordio.cc" title="Contact Support" target="_blank" rel="noopener noreferrer">
                            <DefaultButton>
                                <BiSupport size={18} />
                            </DefaultButton>
                        </a>
                        <DefaultButton
                            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        >
                            {theme === 'dark' ? <MdLightMode size={18} /> : <MdDarkMode size={18} />}
                        </DefaultButton>
                    </div>
                </div>
            </header>

            <div style={{ maxWidth: 1400 }} className="mx-auto">
                {/* Error Message */}
                {errorMessage && (
                    <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex items-center gap-3">
                        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{errorMessage}</span>
                        <button
                            onClick={() => setErrorMessage(null)}
                            className="ml-auto text-red-400 hover:text-red-300"
                        >
                            ✕
                        </button>
                    </div>
                )}

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
        </div>
    );
}

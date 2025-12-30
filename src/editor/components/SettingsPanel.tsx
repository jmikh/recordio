import { useState } from 'react';
import { BackgroundSettings } from './settings/BackgroundSettings';
import { ProjectSettings } from './settings/ProjectSettings';
import { ZoomSettings } from './settings/ZoomSettings';

type Tab = 'project' | 'zoom' | 'background';

const IconProject = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
);

const IconZoom = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" />
        <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
);

const IconBackground = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
    </svg>
);

export const SettingsPanel = () => {
    const [activeTab, setActiveTab] = useState<Tab>('background');

    return (
        <div className="flex h-full border-r border-[#333] bg-[#252526]">
            {/* Sidebar Navigation */}
            <div className="w-12 flex flex-col items-center py-4 gap-4 border-r border-[#333] bg-[#1e1e1e]">
                <button
                    onClick={() => setActiveTab('project')}
                    title="Project Settings"
                    className={`p-2 rounded hover:bg-[#333] text-gray-400 hover:text-white transition-colors ${activeTab === 'project' ? 'bg-[#333] text-white' : ''}`}
                >
                    <IconProject />
                </button>
                <button
                    onClick={() => setActiveTab('zoom')}
                    title="Zoom Settings"
                    className={`p-2 rounded hover:bg-[#333] text-gray-400 hover:text-white transition-colors ${activeTab === 'zoom' ? 'bg-[#333] text-white' : ''}`}
                >
                    <IconZoom />
                </button>
                <button
                    onClick={() => setActiveTab('background')}
                    title="Background Settings"
                    className={`p-2 rounded hover:bg-[#333] text-gray-400 hover:text-white transition-colors ${activeTab === 'background' ? 'bg-[#333] text-white' : ''}`}
                >
                    <IconBackground />
                </button>
            </div>

            {/* Content Area */}
            <div className="w-64 flex flex-col">
                <div className="h-10 border-b border-[#333] flex items-center px-4 font-bold text-gray-300 text-sm uppercase tracking-wider">
                    {activeTab}
                </div>
                <div className="p-4 flex-1 overflow-y-auto text-gray-300">
                    {activeTab === 'project' && <ProjectSettings />}
                    {activeTab === 'zoom' && <ZoomSettings />}
                    {activeTab === 'background' && <BackgroundSettings />}
                </div>
            </div>
        </div>
    );
};

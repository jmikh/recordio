import { useState } from 'react';
import { BackgroundSettings } from './BackgroundSettings';
import { ProjectSettings } from './ProjectSettings';
import { ScreenSettings } from './ScreenSettings';
import { ZoomSettings } from './ZoomSettings';
import { CameraSettings } from './CameraSettings';
import { SettingsButton } from './SettingsButton';

type Tab = 'project' | 'screen' | 'zoom' | 'background' | 'camera';

const IconProject = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
);

const IconScreen = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
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

const IconCamera = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
    </svg>
);

export const SettingsPanel = () => {
    const [activeTab, setActiveTab] = useState<Tab>('background');

    return (
        <div className="flex h-full border-r border-border bg-surface-elevated">
            {/* Sidebar Navigation */}
            <div className="w-46 flex flex-col items-center py-6 px-4 gap-4 border-r border-border bg-surface">
                <SettingsButton
                    label="Projects"
                    icon={<IconProject />}
                    isActive={activeTab === 'project'}
                    onClick={() => setActiveTab('project')}
                />
                <SettingsButton
                    label="Screen"
                    icon={<IconScreen />}
                    isActive={activeTab === 'screen'}
                    onClick={() => setActiveTab('screen')}
                />
                <SettingsButton
                    label="Effects"
                    icon={<IconZoom />}
                    isActive={activeTab === 'zoom'}
                    onClick={() => setActiveTab('zoom')}
                />
                <SettingsButton
                    label="Background"
                    icon={<IconBackground />}
                    isActive={activeTab === 'background'}
                    onClick={() => setActiveTab('background')}
                />
                <SettingsButton
                    label="Webcam"
                    icon={<IconCamera />}
                    isActive={activeTab === 'camera'}
                    onClick={() => setActiveTab('camera')}
                />
            </div>

            {/* Content Area */}
            <div className="w-72 flex flex-col">
                <div className="h-12 border-b border-border flex items-center px-6 font-bold text-text-main text-sm uppercase tracking-wider bg-surface/50 backdrop-blur-sm">
                    {activeTab === 'zoom' ? 'Zoom Effects' : activeTab}
                </div>
                <div className="p-6 flex-1 overflow-y-auto text-text-muted custom-scrollbar">
                    {activeTab === 'project' && <ProjectSettings />}
                    {activeTab === 'screen' && <ScreenSettings />}
                    {activeTab === 'zoom' && <ZoomSettings />}
                    {activeTab === 'background' && <BackgroundSettings />}
                    {activeTab === 'camera' && <CameraSettings />}
                </div>
            </div>
        </div>
    );
};

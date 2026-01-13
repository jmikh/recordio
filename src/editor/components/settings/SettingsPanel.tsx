import { useState } from 'react';
import { BackgroundSettings } from './BackgroundSettings';
import { ProjectSettings } from './ProjectSettings';
import { ScreenSettings } from './ScreenSettings';
import { ZoomSettings } from './ZoomSettings';
import { CameraSettings } from './CameraSettings';
import { CaptionsSettings } from './CaptionsSettings';
import { SettingsButton } from './SettingsButton';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';

type Tab = 'project' | 'screen' | 'zoom' | 'background' | 'camera' | 'captions';

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
        <circle cx="12" cy="10" r="8" />
        <circle cx="12" cy="10" r="3" />
        <path d="M7 22h10" />
        <path d="M12 22v-4" />
    </svg>
);

const IconCaptions = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="15" width="20" height="4" rx="1" />
        <rect x="2" y="5" width="18" height="4" rx="1" />
    </svg>
);


import { Scrollbar } from '../common/Scrollbar';

export const SettingsPanel = () => {
    const [activeTab, setActiveTab] = useState<Tab>('screen');
    const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);

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
                    label="Background"
                    icon={<IconBackground />}
                    isActive={activeTab === 'background'}
                    onClick={() => setActiveTab('background')}
                />
                <SettingsButton
                    label="Screen"
                    icon={<IconScreen />}
                    isActive={activeTab === 'screen'}
                    onClick={() => setActiveTab('screen')}
                />
                <SettingsButton
                    label="Webcam"
                    icon={<IconCamera />}
                    isActive={activeTab === 'camera'}
                    onClick={() => setActiveTab('camera')}
                />
                <SettingsButton
                    label="Effects"
                    icon={<IconZoom />}
                    isActive={activeTab === 'zoom'}
                    onClick={() => setActiveTab('zoom')}
                />
                <SettingsButton
                    label="Captions"
                    icon={<IconCaptions />}
                    isActive={activeTab === 'captions'}
                    onClick={() => setActiveTab('captions')}
                />
            </div>

            {/* Content Area */}
            <div className="w-72 flex flex-row relative h-full">
                <div
                    ref={setScrollContainer}
                    className="p-6 flex-1 overflow-y-auto text-text-muted custom-scrollbar scrollbar-hide"
                >
                    {activeTab === 'project' && <ProjectSettings />}
                    {activeTab === 'background' && <BackgroundSettings />}
                    {activeTab === 'screen' && <ScreenSettings />}
                    {activeTab === 'camera' && <CameraSettings />}
                    {activeTab === 'zoom' && <ZoomSettings />}
                    {activeTab === 'captions' && <CaptionsSettings />}
                </div>
                <Scrollbar
                    container={scrollContainer}
                    orientation="vertical"
                    dependency={activeTab} // Reset/re-calc when tab changes
                />
            </div>

            {/* Preload Device Frames */}
            <div className="hidden">
                {DEVICE_FRAMES.map(frame => (
                    <img key={frame.id} src={frame.thumbnailUrl} alt="" />
                ))}
            </div>
        </div>
    );
};

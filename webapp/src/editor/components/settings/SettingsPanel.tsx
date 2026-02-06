import { useState, useMemo, useRef, useEffect } from 'react';
import { BackgroundSettings } from './BackgroundSettings';
import { ProjectSettings } from './ProjectSettings';
import { ScreenSettings } from './ScreenSettings';
import { EffectsSettings } from './EffectsSettings';
import { CameraSettings } from './CameraSettings';
import { CaptionsSettings } from './CaptionsSettings';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';
import { Scrollbar } from '@shared/components';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { TbDeviceDesktop, TbZoomIn, TbBackground, TbCamera, TbArticle, TbFolder } from 'react-icons/tb';
import { FaChevronRight } from 'react-icons/fa';

type Tab = 'project' | 'screen' | 'zoom' | 'background' | 'camera' | 'captions';

// Reusable button for settings panel actions (e.g., "Crop Screen", "Edit Camera")
interface SettingsPanelButtonProps {
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
    label?: string;
    className?: string;
    variant?: 'default' | 'primary';
}

export const SettingsPanelButton: React.FC<SettingsPanelButtonProps> = ({
    icon, isActive, onClick, label, className = '', variant = 'default'
}) => {
    const isPrimary = variant === 'primary';

    return (
        <button
            onClick={onClick}
            className={`
                group flex items-center gap-4 py-3 px-4 border-none rounded-lg cursor-pointer transition-colors duration-200
                ${isPrimary
                    ? isActive
                        ? 'bg-primary text-white'
                        : 'bg-primary/80 text-white hover:bg-primary'
                    : isActive
                        ? 'bg-primary/15 text-primary'
                        : 'bg-state-inactive text-text-muted hover:bg-state-hover hover:text-text-main'}
                ${className}
            `}
        >
            <span className="flex">{icon}</span>
            {label && <span className="text-base font-medium">{label}</span>}
            {isActive && <FaChevronRight size={12} className={isPrimary ? 'text-white ml-auto' : 'text-primary ml-auto'} />}
        </button>
    );
};

export const SettingsPanel = () => {
    const [activeTab, setActiveTab] = useState<Tab>('screen');
    const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
    const [accentTop, setAccentTop] = useState(0);
    const navRef = useRef<HTMLElement>(null);

    const project = useProjectStore(s => s.project);
    const canvasMode = useUIStore(s => s.canvasMode);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const hasCameraSource = !!project.cameraSource;
    const hasMicrophone = project.cameraSource?.has_microphone || project.screenSource?.has_microphone;

    // Exit camera edit mode when switching away from camera tab
    const handleTabChange = (tab: Tab) => {
        if (canvasMode === CanvasMode.CameraEdit && tab !== 'camera') {
            // Leaving camera tab while in camera edit mode - exit
            setCanvasMode(CanvasMode.Preview);
        }
        setActiveTab(tab);
    };

    const navItems = useMemo(() => {
        const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
            { id: 'project', label: 'Projects', icon: <TbFolder size={20} /> },
            { id: 'background', label: 'Background', icon: <TbBackground size={20} /> },
            { id: 'screen', label: 'Screen', icon: <TbDeviceDesktop size={20} /> },
        ];
        if (hasCameraSource) {
            items.push({ id: 'camera', label: 'Webcam', icon: <TbCamera size={20} /> });
        }
        items.push({ id: 'zoom', label: 'Effects', icon: <TbZoomIn size={20} /> });
        if (hasMicrophone) {
            items.push({ id: 'captions', label: 'Captions', icon: <TbArticle size={20} /> });
        }
        return items;
    }, [hasCameraSource, hasMicrophone]);

    // Calculate accent bar position when active tab changes
    useEffect(() => {
        if (!navRef.current) return;
        const activeButton = navRef.current.querySelector(`[data-tab="${activeTab}"]`) as HTMLElement;
        if (activeButton) {
            setAccentTop(activeButton.offsetTop + (activeButton.offsetHeight - 28) / 2); // 28px = accent height (h-7)
        }
    }, [activeTab, navItems]);

    return (
        <div className="flex h-full border-r border-border bg-surface" style={{ boxShadow: 'var(--shadow-panel)' }}>
            {/* Sidebar Navigation */}
            <nav ref={navRef} className="relative w-44 flex flex-col gap-0.5 py-6 px-3 border-r border-border">
                {/* Sliding accent bar */}
                <div
                    className="absolute left-3 w-[3px] h-7 bg-primary transition-all duration-200 ease-out"
                    style={{ top: accentTop }}
                />

                {navItems.map((item) => {
                    const isActive = activeTab === item.id;
                    return (
                        <button
                            key={item.id}
                            data-tab={item.id}
                            onClick={() => handleTabChange(item.id)}
                            className="group flex items-center gap-4 py-3 px-4 bg-transparent border-none rounded-lg cursor-pointer transition-colors duration-200"
                        >
                            <span className={`flex transition-colors ${isActive ? 'text-primary' : 'text-text-muted group-hover:text-text-main'}`}>
                                {item.icon}
                            </span>
                            <span className={`text-sm font-medium transition-colors ${isActive ? 'text-text-highlighted' : 'text-text-muted group-hover:text-text-main'}`}>
                                {item.label}
                            </span>
                        </button>
                    );
                })}
            </nav>

            {/* Content Area */}
            <div className="w-72 flex flex-row relative h-full bg-surface-raised">
                <div
                    ref={setScrollContainer}
                    className="p-4 flex-1 overflow-y-auto text-text-main custom-scrollbar scrollbar-hide"
                >
                    {activeTab === 'project' && <ProjectSettings />}
                    {activeTab === 'background' && <BackgroundSettings />}
                    {activeTab === 'screen' && <ScreenSettings />}
                    {activeTab === 'camera' && <CameraSettings />}
                    {activeTab === 'zoom' && <EffectsSettings />}
                    {activeTab === 'captions' && <CaptionsSettings />}
                </div>
                <Scrollbar
                    container={scrollContainer}
                    orientation="vertical"
                    dependency={activeTab}
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

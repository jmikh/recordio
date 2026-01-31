import { useState } from 'react';
import { BackgroundSettings } from './BackgroundSettings';
import { ProjectSettings } from './ProjectSettings';
import { ScreenSettings } from './ScreenSettings';
import { EffectsSettings } from './EffectsSettings';
import { CameraSettings } from './CameraSettings';
import { CaptionsSettings } from './CaptionsSettings';
import { SettingsButton } from './SettingsButton';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';

type Tab = 'project' | 'screen' | 'zoom' | 'background' | 'camera' | 'captions';




import { Scrollbar } from '../../../components/ui/Scrollbar';
import { useProjectStore } from '../../stores/useProjectStore';
import { TbDeviceDesktop, TbZoomIn, TbBackground, TbCamera, TbArticle, TbFolder } from 'react-icons/tb';

export const SettingsPanel = () => {
    const [activeTab, setActiveTab] = useState<Tab>('screen');
    const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);

    const project = useProjectStore(s => s.project);
    const hasCameraSource = !!project.cameraSource;

    // Check if any source has microphone for captions
    let hasMicrophone = false;
    if (project.cameraSource?.has_microphone) {
        hasMicrophone = true;
    }
    if (!hasMicrophone && project.screenSource?.has_microphone) {
        hasMicrophone = true;
    }

    return (
        <div className="flex h-full border-r border-border bg-surface">
            {/* Sidebar Navigation */}
            <div className="w-46 flex flex-col items-center py-6 px-4 gap-4">
                <SettingsButton
                    label="Projects"
                    icon={<TbFolder size={20} />}
                    isActive={activeTab === 'project'}
                    onClick={() => setActiveTab('project')}
                />
                <SettingsButton
                    label="Background"
                    icon={<TbBackground size={20} />}
                    isActive={activeTab === 'background'}
                    onClick={() => setActiveTab('background')}
                />
                <SettingsButton
                    label="Screen"
                    icon={<TbDeviceDesktop size={20} />}
                    isActive={activeTab === 'screen'}
                    onClick={() => setActiveTab('screen')}
                />
                {hasCameraSource && (
                    <SettingsButton
                        label="Webcam"
                        icon={<TbCamera size={20} />}
                        isActive={activeTab === 'camera'}
                        onClick={() => setActiveTab('camera')}
                    />
                )}
                <SettingsButton
                    label="Effects"
                    icon={<TbZoomIn size={20} />}
                    isActive={activeTab === 'zoom'}
                    onClick={() => setActiveTab('zoom')}
                />
                {hasMicrophone && (
                    <SettingsButton
                        label="Captions"
                        icon={<TbArticle size={20} />}
                        isActive={activeTab === 'captions'}
                        onClick={() => setActiveTab('captions')}
                    />
                )}
            </div>

            {/* Content Area */}
            <div className="w-72 flex flex-row relative h-full bg-surface-raised">
                <div
                    ref={setScrollContainer}
                    className="p-6 flex-1 overflow-y-auto text-text-main custom-scrollbar scrollbar-hide"
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

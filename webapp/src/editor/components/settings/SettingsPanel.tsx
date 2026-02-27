import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BackgroundSettings } from './BackgroundSettings';
import { ProjectSettings } from './ProjectSettings';
import { ScreenSettings } from './ScreenSettings';
import { EffectsSettings } from './EffectsSettings';
import { CameraSettings } from './CameraSettings';
import { CaptionsSettings } from './CaptionsSettings';
import { AudioSettingsPanel } from './AudioSettings';
import { ExportSettings } from './ExportSettings';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';
import { Scrollbar } from '@shared/components';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import type { SettingsPanelTab } from '../../stores/useUIStore';
import { ClipInspector } from './ClipInspector';
import { SpotlightInspector } from './SpotlightInspector';
import { ZoomInspector } from './ZoomInspector';
import { CameraLayoutInspector } from './CameraLayoutInspector';
import { TbDeviceDesktop, TbBackground, TbCamera, TbArticle, TbFolder, TbMusic, TbClick, TbDownload } from 'react-icons/tb';
import { FaChevronRight } from 'react-icons/fa';



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
    const activeTab = useUIStore(s => s.settingsPanelActiveTab);
    const setActiveTab = useUIStore(s => s.setSettingsPanelActiveTab);
    const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
    const [accentTop, setAccentTop] = useState(0);
    const navRef = useRef<HTMLElement>(null);

    // Tooltip state for disabled tabs
    const [hoveredDisabledTab, setHoveredDisabledTab] = useState<string | null>(null);
    const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });

    const project = useProjectStore(s => s.project);
    const deselectAllSegments = useUIStore(s => s.deselectAllSegments);
    const hasCameraSource = !!project.cameraSource;
    const hasMicrophone = !!project.microphoneSource;

    const handleTabChange = (tab: SettingsPanelTab) => {
        deselectAllSegments();
        setActiveTab(tab);
    };

    const navItems = useMemo(() => {
        const items: { id: SettingsPanelTab; label: string; icon: React.ReactNode; disabled?: boolean; disabledTooltip?: string }[] = [
            { id: 'project', label: 'Projects', icon: <TbFolder size={20} /> },
            { id: 'background', label: 'Background', icon: <TbBackground size={20} /> },
            { id: 'screen', label: 'Screen', icon: <TbDeviceDesktop size={20} /> },
            { id: 'effects', label: 'Effects', icon: <TbClick size={20} /> },
            {
                id: 'camera',
                label: 'Webcam',
                icon: <TbCamera size={20} />,
                disabled: !hasCameraSource,
                disabledTooltip: 'No webcam detected'
            },
            {
                id: 'captions',
                label: 'Captions',
                icon: <TbArticle size={20} />,
            },
            {
                id: 'audio',
                label: 'Audio',
                icon: <TbMusic size={20} />,
            },
            {
                id: 'export' as const,
                label: 'Export',
                icon: <TbDownload size={20} />,
            },
        ];
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

    // Check if any timeline item is selected
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const selectedWindowId = useUIStore(s => s.selectedWindowId);
    const selectedCameraLayoutId = useUIStore(s => s.selectedCameraLayoutId);
    const hasSelection = !!(selectedZoomId || selectedSpotlightId || selectedWindowId || selectedCameraLayoutId);

    const zoomSegments = useProjectStore(s => s.project.timeline.zoomSegments);
    const spotlightSegments = useProjectStore(s => s.project.timeline.spotlightSegments);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    const cameraLayoutSegments = useProjectStore(s => s.project.timeline.cameraLayoutSegments);

    const selectedZoom = selectedZoomId ? zoomSegments.find(z => z.id === selectedZoomId) : null;
    const selectedSpotlight = selectedSpotlightId ? spotlightSegments.find(s => s.id === selectedSpotlightId) : null;
    const selectedWindow = selectedWindowId ? outputWindows.find(w => w.id === selectedWindowId) : null;
    const selectedCameraLayout = selectedCameraLayoutId ? (cameraLayoutSegments || []).find(s => s.id === selectedCameraLayoutId) : null;

    return (
        <div id="settings-panel" className="flex h-full border-r border-border bg-surface" style={{ boxShadow: 'var(--shadow-panel)' }}>
            {/* Sidebar Navigation */}
            <nav id="settings-nav" ref={navRef} className="relative w-44 flex flex-col gap-0.5 py-6 px-3 border-r border-border">
                {/* Sliding accent bar — hidden when inspector is active */}
                {!hasSelection && (
                    <div
                        className="absolute left-3 w-[3px] h-7 bg-primary transition-all duration-200 ease-out"
                        style={{ top: accentTop }}
                    />
                )}

                {navItems.map((item) => {
                    const isActive = activeTab === item.id;
                    const isDisabled = item.disabled;

                    const showActive = isActive && !hasSelection;

                    return (
                        <button
                            key={item.id}
                            data-tab={item.id}
                            onClick={() => !isDisabled && handleTabChange(item.id)}
                            onMouseEnter={(e) => {
                                if (isDisabled && item.disabledTooltip) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setTooltipPosition({
                                        left: rect.right + 8,
                                        top: rect.top + rect.height / 2
                                    });
                                    setHoveredDisabledTab(item.id);
                                }
                            }}
                            onMouseLeave={() => setHoveredDisabledTab(null)}
                            className={`group flex items-center gap-4 py-3 px-4 bg-transparent border-none rounded-lg transition-colors duration-200 ${isDisabled
                                ? 'opacity-50'
                                : 'cursor-pointer'
                                }`}
                        >
                            <span className={`flex transition-colors ${isDisabled
                                ? 'text-text-disabled'
                                : showActive
                                    ? 'text-primary'
                                    : 'text-text-muted group-hover:text-text-main'
                                }`}>
                                {item.icon}
                            </span>
                            <span className={`text-sm font-medium transition-colors ${isDisabled
                                ? 'text-text-disabled'
                                : showActive
                                    ? 'text-text-highlighted'
                                    : 'text-text-muted group-hover:text-text-main'
                                }`}>
                                {item.label}
                            </span>
                        </button>
                    );
                })}
            </nav>

            {/* Content Area */}
            <div id="settings-content" className="w-72 flex flex-row relative h-full bg-surface-raised">
                <div
                    ref={setScrollContainer}
                    className="p-4 flex-1 overflow-y-auto text-text-main custom-scrollbar scrollbar-hide"
                >
                    {hasSelection ? (
                        <>
                            {selectedZoom && <ZoomInspector segment={selectedZoom} />}
                            {selectedSpotlight && <SpotlightInspector segment={selectedSpotlight} />}
                            {selectedWindow && <ClipInspector window={selectedWindow} />}
                            {selectedCameraLayout && <CameraLayoutInspector segment={selectedCameraLayout} />}
                        </>
                    ) : (
                        <>
                            {activeTab === 'project' && <ProjectSettings />}
                            {activeTab === 'background' && <BackgroundSettings />}
                            {activeTab === 'screen' && <ScreenSettings />}
                            {activeTab === 'camera' && <CameraSettings />}
                            {activeTab === 'effects' && <EffectsSettings />}
                            {activeTab === 'captions' && <CaptionsSettings />}
                            {activeTab === 'audio' && <AudioSettingsPanel />}
                            {activeTab === 'export' && <ExportSettings />}
                        </>
                    )}
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

            {/* Disabled tab tooltip - rendered via portal */}
            {hoveredDisabledTab && createPortal(
                <div
                    className="fixed z-[999999] bg-surface-overlay border border-border rounded-md shadow-float px-3 py-2 text-xs text-text-main whitespace-nowrap"
                    style={{
                        left: tooltipPosition.left,
                        top: tooltipPosition.top,
                        transform: 'translateY(-50%)'
                    }}
                >
                    {navItems.find(item => item.id === hoveredDisabledTab)?.disabledTooltip}
                </div>,
                document.body
            )}
        </div>
    );
};

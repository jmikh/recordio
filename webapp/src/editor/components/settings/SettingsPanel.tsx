import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { BackgroundSettings } from './BackgroundSettings';
import { ScreenSettings } from './ScreenSettings';
import { EffectsSettings } from './EffectsSettings';
import { MotionSettings } from './MotionSettings';
import { CameraSettings } from './CameraSettings';
import { CaptionsSettings } from './CaptionsSettings';
import { AudioSettingsPanel } from './AudioSettings';
import { DEVICE_FRAMES } from '@shared/utils/deviceFrames';
import { Button, LogoLink, Scrollbar, SidebarNav, SidebarNavItem } from '@shared/components';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useUserStore } from '../../../auth/useUserStore';
import { CloudProjectService } from '../../../storage/cloudProjectService';
import { useSyncStatusStore } from '../../../storage/syncStatusStore';
import { navigate } from '../../../lib/navigate';
import type { SettingsPanelTab } from '../../stores/useUIStore';
import { ClipInspector } from './ClipInspector';
import { SpotlightInspector } from './SpotlightInspector';
import { ZoomInspector } from './ZoomInspector';
import { CameraMoveInspector } from './CameraMoveInspector';
import { OverlayInspector } from './OverlayInspector';
import { LuChevronRight } from 'react-icons/lu';
import { SETTINGS_NAV_ITEMS } from './settingsNavItems';



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
            {label && <span className="text-base">{label}</span>}
            {isActive && <LuChevronRight className={`icon-sm ${isPrimary ? 'text-white ml-auto' : 'text-primary ml-auto'}`} />}
        </button>
    );
};

export const SettingsPanel = () => {
    const activeTab = useUIStore(s => s.settingsPanelActiveTab);
    const setActiveTab = useUIStore(s => s.setSettingsPanelActiveTab);
    const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);

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
        const items: { id: SettingsPanelTab; label: string; icon: React.ComponentType<{ className?: string }>; disabled?: boolean; disabledTooltip?: string }[] =
            SETTINGS_NAV_ITEMS.map(item => item.id === 'camera'
                ? { ...item, disabled: !hasCameraSource, disabledTooltip: 'No camera detected' }
                : item);
        return items;
    }, [hasCameraSource, hasMicrophone]);

    // Check if any timeline item is selected
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const selectedWindowId = useUIStore(s => s.selectedWindowId);
    const selectedCameraMoveId = useUIStore(s => s.selectedCameraMoveId);
    const selectedOverlaySegmentId = useUIStore(s => s.selectedOverlaySegmentId);
    const hasSelection = !!(selectedZoomId || selectedSpotlightId || selectedWindowId || selectedCameraMoveId || selectedOverlaySegmentId);

    const zoomSegments = useProjectStore(s => s.project.timeline.zoomSegments);
    const spotlightSegments = useProjectStore(s => s.project.timeline.spotlightSegments);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    const cameraMoveSegments = useProjectStore(s => s.project.timeline.cameraMoveSegments);

    const selectedZoom = selectedZoomId ? zoomSegments.find(z => z.id === selectedZoomId) : null;
    const selectedSpotlight = selectedSpotlightId ? spotlightSegments.find(s => s.id === selectedSpotlightId) : null;
    const selectedWindow = selectedWindowId ? outputWindows.find(w => w.id === selectedWindowId) : null;
    const selectedCameraMove = selectedCameraMoveId ? (cameraMoveSegments || []).find(s => s.id === selectedCameraMoveId) : null;

    const overlaySegments = useProjectStore(s => s.project.timeline.overlaySegments);
    const selectedOverlaySegment = selectedOverlaySegmentId ? (overlaySegments || []).find(b => b.id === selectedOverlaySegmentId) : null;

    // Save before leaving, mirroring the old header logo behavior
    const handleGoToDashboard = async () => {
        const { userId } = useUserStore.getState();
        if (userId) {
            const { project: proj, userEvents } = useProjectStore.getState();
            const fullProject = { ...proj, userEvents };
            await CloudProjectService.saveProject(fullProject, userId);

            if (useSyncStatusStore.getState().conflict) {
                useSyncStatusStore.getState().setPendingNavigation('/');
                return;
            }
        }
        navigate('/');
    };

    return (
        <div id="settings-panel" className="flex h-full">
            {/* Logo + navigation — one bordered side panel column */}
            <div className="w-44 flex flex-col bg-surface border-r border-border">
                {/* Logo — same placement as the dashboard sidebar */}
                <div className="px-3 pt-3">
                    <Button
                        variant="ghost"
                        onClick={handleGoToDashboard}
                        aria-label="Back to Dashboard"
                        title="Back to Dashboard"
                        className="w-fit"
                    >
                        <LogoLink imgClassName="h-6" />
                    </Button>
                </div>
                <SidebarNav id="settings-nav" className="flex-1 min-h-0 py-6">
                    {navItems.map((item) => {
                        const isDisabled = item.disabled;
                        const showActive = activeTab === item.id && !hasSelection;

                        return (
                            <SidebarNavItem
                                key={item.id}
                                label={item.label}
                                icon={item.icon}
                                active={showActive}
                                disabled={isDisabled}
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
                            />
                        );
                    })}
                </SidebarNav>
            </div>

            {/* Content Area — transparent, runs the full height */}
            <div id="settings-content" className="w-80 flex flex-row relative h-full bg-surface-body">
                <div
                    ref={setScrollContainer}
                    className="p-2 flex-1 overflow-y-auto text-text-main custom-scrollbar scrollbar-hide"
                >
                    {hasSelection ? (
                        <>
                            {selectedZoom && <ZoomInspector segment={selectedZoom} />}
                            {selectedSpotlight && <SpotlightInspector segment={selectedSpotlight} />}
                            {selectedWindow && <ClipInspector window={selectedWindow} />}
                            {selectedCameraMove && <CameraMoveInspector segment={selectedCameraMove} />}
                            {selectedOverlaySegment && <OverlayInspector block={selectedOverlaySegment} />}
                        </>
                    ) : (
                        <>

                            {activeTab === 'background' && <BackgroundSettings />}
                            {activeTab === 'screen' && <ScreenSettings />}
                            {activeTab === 'camera' && <CameraSettings />}
                            {activeTab === 'effects' && <EffectsSettings />}
                            {activeTab === 'motion' && <MotionSettings />}
                            {activeTab === 'captions' && <CaptionsSettings />}
                            {activeTab === 'audio' && <AudioSettingsPanel />}
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
                    className="fixed z-[999999] bg-surface-raised border border-border rounded-md shadow-float px-3 py-2 text-xs text-text-main whitespace-nowrap"
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

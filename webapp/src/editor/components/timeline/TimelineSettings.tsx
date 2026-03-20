import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MdOutlineSettingsInputComponent } from 'react-icons/md';
import { useUIStore } from '../../stores/useUIStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { Checkbox, Toggle } from '@shared/components';
import type { DisplaySettings } from '../../../types/timeline';

interface TrackConfig {
    showKey: keyof DisplaySettings;
    label: string;
    requiresCamera?: boolean;
    /** Selector to read the enabled state from ProjectStore */
    getEnabled: (s: any) => boolean;
    /** Action to toggle enabled state */
    toggle: () => void;
}

function buildTrackConfigs(): TrackConfig[] {
    return [
        {
            showKey: 'showZoom',
            label: 'Zoom',
            getEnabled: (s) => s.project.settings.zoom.enabled ?? true,
            toggle: () => useProjectStore.getState().toggleZoomEnabled(),
        },
        {
            showKey: 'showSpotlight',
            label: 'Spotlight',
            getEnabled: (s) => s.project.settings.spotlight.enabled ?? true,
            toggle: () => useProjectStore.getState().toggleSpotlightEnabled(),
        },
        {
            showKey: 'showCaptions',
            label: 'Captions',
            getEnabled: (s) => s.project.settings.captions.enabled ?? true,
            toggle: () => {
                const state = useProjectStore.getState();
                const captions = state.project.settings.captions;
                state.updateSettings({ captions: { ...captions, enabled: !(captions.enabled ?? true) } });
            },
        },
        {
            showKey: 'showCameraMove',
            label: 'Camera',
            requiresCamera: true,
            getEnabled: (s) => s.project.settings.cameraMove?.enabled ?? true,
            toggle: () => useProjectStore.getState().toggleCameraMoveEnabled(),
        },
        {
            showKey: 'showOverlay',
            label: 'Overlay',
            getEnabled: (s) => s.project.settings.overlay?.enabled ?? true,
            toggle: () => useProjectStore.getState().toggleOverlayEnabled(),
        },
    ];
}

interface TimelineSettingsProps {
    height: number;
}

export function TimelineSettings({ height }: TimelineSettingsProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const triggerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const displaySettings = useProjectStore(s => s.project.timeline.displaySettings);
    const setTrackShow = useUIStore(s => s.setTrackShow);
    const toggleTracksCollapsed = useUIStore(s => s.toggleTracksCollapsed);
    const hasCameraSource = useProjectStore(s => !!s.project.cameraSource);

    // Read enabled states from ProjectStore
    const zoomEnabled = useProjectStore(s => s.project.settings.zoom.enabled ?? true);
    const spotlightEnabled = useProjectStore(s => s.project.settings.spotlight.enabled ?? true);
    const captionsEnabled = useProjectStore(s => s.project.settings.captions.enabled ?? true);
    const cameraMoveEnabled = useProjectStore(s => s.project.settings.cameraMove?.enabled ?? true);
    const overlayEnabled = useProjectStore(s => s.project.settings.overlay?.enabled ?? true);

    const trackConfigs = useMemo(() => buildTrackConfigs(), []);

    const tracks = useMemo(() =>
        trackConfigs.filter(t => !t.requiresCamera || hasCameraSource),
        [hasCameraSource, trackConfigs]
    );

    const enabledMap: Record<string, boolean> = {
        showZoom: zoomEnabled,
        showSpotlight: spotlightEnabled,
        showCaptions: captionsEnabled,
        showCameraMove: cameraMoveEnabled,
        showOverlay: overlayEnabled,
    };

    // Calculate menu position when opening
    useEffect(() => {
        if (!isOpen || !triggerRef.current) return;

        const rect = triggerRef.current.getBoundingClientRect();
        setMenuStyle({
            position: 'fixed',
            bottom: window.innerHeight - rect.top + 4,
            left: rect.left + 8,
            minWidth: 220,
            zIndex: 9999,
        });
    }, [isOpen]);

    // Handle click outside to close
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                triggerRef.current && !triggerRef.current.contains(target) &&
                menuRef.current && !menuRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const popoverContent = (
        <div
            ref={menuRef}
            className="bg-surface-raised border border-border rounded-lg shadow-float py-3 px-4"
            style={menuStyle}
        >
            {/* Header */}
            <div className="text-sm font-medium text-text-highlighted mb-2">Timeline Settings</div>

            {/* Column headers */}
            <div className="flex items-center gap-2 mb-1">
                <span className="flex-1"></span>
                <span className="w-10 text-center text-xs text-text-disabled">Show</span>
                <span className="w-10 text-center text-xs text-text-disabled">Apply</span>
            </div>

            {/* Track rows */}
            <div className="flex flex-col">
                {tracks.map(({ showKey, label, toggle }) => {
                    const isVisible = displaySettings[showKey] as boolean;
                    const isEnabled = enabledMap[showKey] ?? true;

                    return (
                        <div
                            key={showKey}
                            className="flex items-center gap-2 py-1.5"
                        >
                            <span className={`flex-1 text-sm ${isEnabled ? 'text-text-muted' : 'text-text-disabled'}`}>
                                {label}
                            </span>
                            <div className="w-10 flex justify-center">
                                <Checkbox
                                    checked={isVisible}
                                    onChange={() => setTrackShow(showKey, !isVisible)}
                                />
                            </div>
                            <div className="w-10 flex justify-center">
                                <Checkbox
                                    checked={isEnabled}
                                    onChange={() => toggle()}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Helper text */}
            <div className="mt-2 flex flex-col gap-0.5 subtext">
                <span><span className="font-medium">Show</span> — display track in timeline</span>
                <span><span className="font-medium">Apply</span> — apply effects during playback</span>
            </div>

            {/* Divider */}
            <div className="border-t border-border my-2.5" />

            {/* Collapse toggle */}
            <Toggle
                label="Collapse Tracks"
                value={displaySettings.collapsed}
                onChange={() => toggleTracksCollapsed()}
            />
        </div>
    );

    return (
        <div ref={triggerRef} className="relative w-full" style={{ height }}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center justify-center w-full h-full text-text-muted hover:text-text-highlighted hover:scale-115 transition-all cursor-pointer select-none"
                title="Track settings"
            >
                <MdOutlineSettingsInputComponent size={18} />
            </button>

            {/* Portal-rendered popover */}
            {isOpen && createPortal(popoverContent, document.body)}
        </div>
    );
}

import { useState } from 'react';
import { SidebarNav, SidebarNavItem, Scrollbar } from '@shared/components';
import { DEVICE_FRAMES } from '@shared/utils/deviceFrames';
import { BackgroundSettings } from '../../../editor/components/settings/BackgroundSettings';
import { ScreenSettings } from '../../../editor/components/settings/ScreenSettings';
import { EffectsSettings } from '../../../editor/components/settings/EffectsSettings';
import { CameraSettings } from '../../../editor/components/settings/CameraSettings';
import { CaptionsSettings } from '../../../editor/components/settings/CaptionsSettings';
import { MotionSettings } from '../../../editor/components/settings/MotionSettings';
import { SETTINGS_NAV_ITEMS } from '../../../editor/components/settings/settingsNavItems';
import type { SettingsPanelTab } from '../../../editor/stores/useUIStore';

/** The editor's tabs minus Audio (music/volume are picked per recording). */
const DEFAULTS_NAV_ITEMS = SETTINGS_NAV_ITEMS.filter(item => item.id !== 'audio');

/**
 * The settings half of the Personal Settings card: the editor's own
 * settings panels (they read/write the project store, which holds the
 * defaults template — plans/user-default-project-settings §3.6) behind
 * the same nav, minus the logo/back button and the timeline inspectors.
 */
export function DefaultsSettingsPanel() {
    const [activeTab, setActiveTab] = useState<SettingsPanelTab>('background');
    const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);

    return (
        <div id="defaults-settings-panel" className="flex h-full shrink-0">
            <div className="w-44 flex flex-col bg-surface border-r border-border">
                <SidebarNav id="defaults-settings-nav" className="flex-1 min-h-0 py-4">
                    {DEFAULTS_NAV_ITEMS.map(item => (
                        <SidebarNavItem
                            key={item.id}
                            label={item.label}
                            icon={item.icon}
                            active={activeTab === item.id}
                            onClick={() => setActiveTab(item.id)}
                        />
                    ))}
                </SidebarNav>
            </div>

            <div id="defaults-settings-content" className="w-80 flex flex-row relative h-full bg-surface-body border-r border-border">
                <div
                    ref={setScrollContainer}
                    className="p-2 flex-1 overflow-y-auto text-text-main custom-scrollbar scrollbar-hide"
                >
                    {activeTab === 'background' && <BackgroundSettings />}
                    {activeTab === 'screen' && <ScreenSettings />}
                    {activeTab === 'camera' && <CameraSettings />}
                    {activeTab === 'effects' && <EffectsSettings />}
                    {activeTab === 'captions' && <CaptionsSettings />}
                    {activeTab === 'motion' && <MotionSettings />}
                </div>
                <Scrollbar
                    container={scrollContainer}
                    orientation="vertical"
                    dependency={activeTab}
                />
            </div>

            {/* Preload device frames (same as the editor panel) */}
            <div className="hidden" aria-hidden="true">
                {DEVICE_FRAMES.map(frame => (
                    <img key={frame.id} src={frame.thumbnailUrl} alt="" />
                ))}
            </div>
        </div>
    );
}

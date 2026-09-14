import type { ComponentType } from 'react';
import { LuCamera, LuCaptions, LuMonitor, LuMousePointerClick, LuMusic, LuSparkles, LuWallpaper } from 'react-icons/lu';
import type { SettingsPanelTab } from '../../stores/useUIStore';

export interface SettingsNavItem<T extends string = SettingsPanelTab> {
    id: T;
    label: string;
    icon: ComponentType<{ className?: string }>;
}

/**
 * The editor's settings tabs in display order — shared with the Personal
 * Settings page (plans/user-default-project-settings) so labels and icons
 * stay in sync. The editor adds its own disabled state for Camera.
 */
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
    { id: 'background', label: 'Background', icon: LuWallpaper },
    { id: 'screen', label: 'Screen', icon: LuMonitor },
    { id: 'effects', label: 'Effects', icon: LuMousePointerClick },
    { id: 'motion', label: 'Motion', icon: LuSparkles },
    { id: 'camera', label: 'Camera', icon: LuCamera },
    { id: 'captions', label: 'Captions', icon: LuCaptions },
    { id: 'audio', label: 'Audio', icon: LuMusic },
];

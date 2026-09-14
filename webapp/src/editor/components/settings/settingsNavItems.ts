import type { ComponentType } from 'react';
import { TbDeviceDesktop, TbBackground, TbArticle, TbMusic, TbClick } from 'react-icons/tb';
import { PiWebcamBold } from 'react-icons/pi';
import { LuSparkles } from 'react-icons/lu';
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
    { id: 'background', label: 'Background', icon: TbBackground },
    { id: 'screen', label: 'Screen', icon: TbDeviceDesktop },
    { id: 'effects', label: 'Effects', icon: TbClick },
    { id: 'motion', label: 'Motion', icon: LuSparkles },
    { id: 'camera', label: 'Camera', icon: PiWebcamBold },
    { id: 'captions', label: 'Captions', icon: TbArticle },
    { id: 'audio', label: 'Audio', icon: TbMusic },
];

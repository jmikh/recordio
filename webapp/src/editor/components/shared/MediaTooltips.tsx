import React from 'react';
import { InfoTooltip, type TooltipPlacement } from '@shared/components';
import { CDN_ORIGIN } from '@shared/types/bridge';

interface MediaTooltipProps {
    /** Tooltip placement relative to trigger */
    placement?: TooltipPlacement;
    /** Custom trigger element (defaults to "ⓘ" icon) */
    trigger?: React.ReactNode;
}

/** Scale-on-zoom tooltip with demo video */
export const AutoShrinkTooltip: React.FC<MediaTooltipProps> = ({ placement, trigger }) => (
    <InfoTooltip
        description="Automatically scales down the camera while the screen is zoomed in."
        videoSrc={`${CDN_ORIGIN}/demos/autoshrink-demo.mp4`}
        placement={placement}
        trigger={trigger}
    />
);

/** Camera layout tooltip with demo video */
export const CameraMoveTooltip: React.FC<MediaTooltipProps> = ({ placement, trigger }) => (
    <InfoTooltip
        description={"Change the camera layout for any section of the video.\nGreat for full-screen intros, outros, and transitions."}
        videoSrc={`${CDN_ORIGIN}/demos/camera-layout-demo.mp4`}
        placement={placement}
        trigger={trigger}
    />
);

/** Hotkey overlay tooltip with demo image */
export const HotkeyTooltip: React.FC<MediaTooltipProps> = ({ placement, trigger }) => (
    <InfoTooltip
        description="Shows keyboard shortcuts as an overlay during playback."
        imageSrc="/assets/tooltips/hotkey.png"
        size="small"
        placement={placement}
        trigger={trigger}
    />
);

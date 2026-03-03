import React from 'react';
import { InfoTooltip, type TooltipPlacement } from '@shared/components';

interface MediaTooltipProps {
    /** Tooltip placement relative to trigger */
    placement?: TooltipPlacement;
    /** Custom trigger element (defaults to "ⓘ" icon) */
    trigger?: React.ReactNode;
}

/** Spotlight tooltip with demo video */
export const SpotlightTooltip: React.FC<MediaTooltipProps> = ({ placement, trigger }) => (
    <InfoTooltip
        description={"Shine the spotlight on what matters by enlarging it and dimming the rest.\nLooks best on cards, popovers and clearly defined areas."}
        videoSrc="https://cdn.recordio.cc/demos/spotlight-demo.mp4"
        placement={placement}
        trigger={trigger}
    />
);

/** Auto-shrink tooltip with demo video */
export const AutoShrinkTooltip: React.FC<MediaTooltipProps> = ({ placement, trigger }) => (
    <InfoTooltip
        description="Automatically shrinks the camera when screen zoom is active."
        videoSrc="https://cdn.recordio.cc/demos/autoshrink-demo.mp4"
        placement={placement}
        trigger={trigger}
    />
);

/** Camera layout tooltip with demo video */
export const CameraMoveTooltip: React.FC<MediaTooltipProps> = ({ placement, trigger }) => (
    <InfoTooltip
        description={"Change the camera layout for any section of the video.\nGreat for full-screen intros, outros, and transitions."}
        videoSrc="https://cdn.recordio.cc/demos/camera-layout-demo.mp4"
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

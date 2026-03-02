import React from 'react';
import { InfoTooltip, type TooltipPlacement } from '@shared/components';
import { LegendTooltip, LegendItem } from '../timeline/shared/LegendTooltip';
import { legendItem } from '../timeline/spotlight/SpotlightTrackStyles';

interface MediaTooltipProps {
    /** Tooltip placement relative to trigger */
    placement?: TooltipPlacement;
    /** Custom trigger element (defaults to "ⓘ" icon) */
    trigger?: React.ReactNode;
}

/** Spotlight tooltip with demo video and legend items */
export const SpotlightTooltip: React.FC<MediaTooltipProps> = ({ placement, trigger }) => (
    <LegendTooltip
        videoSrc="https://cdn.recordio.cc/demos/spotlight-demo.mp4"
        description={"Shine the spotlight on what matters by enlarging it and dimming the rest.\nLooks best on clearly defined areas."}
        placement={placement}
        trigger={trigger}
    >
        <LegendItem
            indicator={
                <div
                    className={legendItem.fadeIn.className}
                    style={legendItem.fadeIn.style}
                />
            }
            label="Fade in"
        />
        <LegendItem
            indicator={
                <div
                    className={legendItem.hold.className}
                    style={legendItem.hold.style}
                />
            }
            label="Hold"
        />
        <LegendItem
            indicator={
                <div
                    className={legendItem.fadeOut.className}
                    style={legendItem.fadeOut.style}
                />
            }
            label="Fade out"
        />
    </LegendTooltip>
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

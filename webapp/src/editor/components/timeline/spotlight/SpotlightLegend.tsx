import React from 'react';
import { LegendTooltip, LegendItem } from '../shared/LegendTooltip';
import { legendItem } from './SpotlightTrackStyles';

/**
 * SpotlightLegend displays an info icon that shows a tooltip explaining
 * the spotlight track visual elements.
 */
export const SpotlightLegend: React.FC = () => {
    return (
        <LegendTooltip
            videoSrc="https://cdn.recordio.cc/demos/spotlight-demo.mp4"
            description={"Shine the spotlight on what matters by enlarging it and dimming the rest.\nLooks best on clearly defined areas."}
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
};
